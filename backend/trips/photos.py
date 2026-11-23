"""Photo decoding, EXIF reading, WebP copies and route placement (SPEC §6.2, §6.3).

Everything here is a pure function over bytes / coordinates, so it's testable without
storage, Celery or the database.
"""

import io
import math
from bisect import bisect_left
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from PIL import ExifTags, Image, ImageOps, UnidentifiedImageError

from .gpx import haversine_m

THUMB_PX = 400
WEB_PX = 1600
GPS_PLAUSIBLE_M = 2000  # EXIF GPS further than this from the track is ignored
TIME_SLACK_S = 30 * 60  # photos up to 30 min before/after the track snap to its ends

HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}

_heif_registered = False


class PhotoError(Exception):
    """A user-facing reason the file can't be used."""


def sniff_type(head: bytes) -> str | None:
    """Detect JPEG / HEIC from magic bytes; the browser's declared type isn't trusted."""
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[4:8] == b"ftyp" and head[8:12] in HEIF_BRANDS:
        return "image/heic"
    return None


def _open(data: bytes, kind: str) -> Image.Image:
    global _heif_registered
    if kind == "image/heic" and not _heif_registered:
        from pillow_heif import register_heif_opener

        register_heif_opener()
        _heif_registered = True
    try:
        img = Image.open(io.BytesIO(data))
        # JPEG can decode at 1/2, 1/4 or 1/8 scale: far less memory for a 48 MP photo.
        img.draft("RGB", (WEB_PX, WEB_PX))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise PhotoError("This image couldn't be read.") from exc
    return img


def _ratio(v) -> float:
    return float(v[0]) / float(v[1]) if isinstance(v, tuple) else float(v)


def _gps(gps: dict) -> dict | None:
    try:
        lat = sum(_ratio(x) / 60**i for i, x in enumerate(gps[2]))
        lon = sum(_ratio(x) / 60**i for i, x in enumerate(gps[4]))
    except (KeyError, TypeError, ValueError, ZeroDivisionError, IndexError):
        return None
    if gps.get(1) in ("S", b"S"):
        lat = -lat
    if gps.get(3) in ("W", b"W"):
        lon = -lon
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    out = {"lat": round(lat, 7), "lon": round(lon, 7), "ele": None}
    try:
        ele = _ratio(gps[6])
        out["ele"] = round(-ele if gps.get(5) in (1, b"\x01") else ele, 1)
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        pass
    return out


def read_exif(img: Image.Image) -> dict:
    """The few EXIF fields we keep in the database (never served publicly)."""
    exif = img.getexif()
    sub = exif.get_ifd(ExifTags.IFD.Exif)
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)

    def text(v):
        if isinstance(v, bytes):
            v = v.decode(errors="ignore")
        return v.strip("\x00 ").strip() if isinstance(v, str) else None

    return {
        "datetime_raw": text(sub.get(ExifTags.Base.DateTimeOriginal))
        or text(exif.get(ExifTags.Base.DateTime)),
        "offset": text(sub.get(ExifTags.Base.OffsetTimeOriginal)),
        "gps": _gps(gps) if gps else None,
        "camera_model": text(exif.get(ExifTags.Base.Model)),
    }


@dataclass
class Derived:
    thumb: bytes
    web: bytes
    width: int
    height: int
    exif: dict


def make_copies(data: bytes) -> Derived:
    """Decode, rotate upright, and re-encode as WebP. Re-encoding from raw pixels without
    passing exif/xmp/icc drops all metadata, so the copies carry no location (F11)."""
    kind = sniff_type(data[:16])
    if kind is None:
        raise PhotoError("Only JPEG and HEIC photos are supported.")
    img = _open(data, kind)
    exif = read_exif(img)
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.info.clear()

    def encode(size: int, quality: int) -> bytes:
        copy = img.copy()
        copy.thumbnail((size, size), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        copy.save(buf, "WEBP", quality=quality, method=4, exif=b"", xmp=b"", icc_profile=None)
        return buf.getvalue()

    web = encode(WEB_PX, 78)
    thumb = encode(THUMB_PX, 72)
    width, height = img.size
    scale = min(1.0, WEB_PX / max(width, height))
    return Derived(thumb, web, round(width * scale), round(height * scale), exif)


# --- Time ---------------------------------------------------------------------------------


def exif_time_utc(exif: dict, trip_tz: str, camera_offset_s: int) -> datetime | None:
    """EXIF local time -> UTC. Use OffsetTimeOriginal if the camera wrote one, otherwise
    assume the camera clock was set to the trip's local time zone (ADR-7)."""
    raw = exif.get("datetime_raw")
    if not raw:
        return None
    try:
        naive = datetime.strptime(raw[:19], "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None
    offset = exif.get("offset")
    local = None
    if offset:
        try:
            local = datetime.strptime(f"{raw[:19]} {offset}", "%Y:%m:%d %H:%M:%S %z")
        except ValueError:
            local = None
    if local is None:
        try:
            tz = ZoneInfo(trip_tz) if trip_tz else UTC
        except ZoneInfoNotFoundError:
            tz = UTC
        local = naive.replace(tzinfo=tz)
    return local.astimezone(UTC) + timedelta(seconds=camera_offset_s)


# --- Geometry -----------------------------------------------------------------------------


def locate_on_line(coords, lon: float, lat: float) -> tuple[float, float]:
    """Nearest point on a [lon, lat, ...] polyline -> (distance_m, fraction 0..1 by length).

    Uses a local flat projection around the photo, which is accurate to well under a metre
    over the few kilometres that matter here.
    """
    if len(coords) < 2:
        return math.inf, 0.0
    kx = 111_320.0 * math.cos(math.radians(lat))
    ky = 110_540.0
    pts = [((c[0] - lon) * kx, (c[1] - lat) * ky) for c in coords]

    seg_len = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    total = sum(seg_len) or 1.0
    best_d2, best_along, along = math.inf, 0.0, 0.0
    for i, length in enumerate(seg_len):
        (ax, ay), (bx, by) = pts[i], pts[i + 1]
        t = 0.0
        if length > 0:
            t = max(0.0, min(1.0, -(ax * (bx - ax) + ay * (by - ay)) / (length * length)))
        px, py = ax + t * (bx - ax), ay + t * (by - ay)
        d2 = px * px + py * py
        if d2 < best_d2:
            best_d2, best_along = d2, along + t * length
        along += length
    return math.sqrt(best_d2), best_along / total


def point_at_fraction(coords, fraction: float) -> tuple[float, float, float]:
    """Inverse of locate_on_line: the (lon, lat, ele) at a fraction of the line's length."""
    fraction = max(0.0, min(1.0, fraction))
    seg = [
        haversine_m(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0])
        for i in range(len(coords) - 1)
    ]
    target = fraction * sum(seg)
    for i, length in enumerate(seg):
        if target <= length or i == len(seg) - 1:
            t = 0.0 if length == 0 else min(1.0, target / length)
            a, b = coords[i], coords[i + 1]
            return tuple(a[k] + t * (b[k] - a[k]) for k in range(3))  # type: ignore[return-value]
        target -= length
    return tuple(coords[-1][:3])  # type: ignore[return-value]


def position_at_time(coords, times: list, when: float) -> tuple[float, float, float] | None:
    """Interpolate the track position at epoch time `when` (binary search, ADR-7).

    `times` lines up with `coords` and may contain None. Returns None when `when` is more
    than TIME_SLACK_S outside the track's time range; within the slack, snaps to the end.
    """
    timed = sorted((t, i) for i, t in enumerate(times) if t is not None)
    if not timed:
        return None
    ts = [t for t, _ in timed]
    if when < ts[0] - TIME_SLACK_S or when > ts[-1] + TIME_SLACK_S:
        return None
    k = bisect_left(ts, when)
    if k == 0:
        return tuple(coords[timed[0][1]][:3])  # type: ignore[return-value]
    if k >= len(ts):
        return tuple(coords[timed[-1][1]][:3])  # type: ignore[return-value]
    (t0, i0), (t1, i1) = timed[k - 1], timed[k]
    f = 0.0 if t1 == t0 else (when - t0) / (t1 - t0)
    a, b = coords[i0], coords[i1]
    return tuple(a[j] + f * (b[j] - a[j]) for j in range(3))  # type: ignore[return-value]


@dataclass
class Placement:
    placement: str  # exif | time | unplaced
    lon_lat_ele: tuple[float, float, float] | None
    route_fraction: float | None
    taken_at: datetime | None
    time_match_error_m: float | None


def place(exif: dict, *, trip_tz: str, camera_offset_s: int, track) -> Placement:
    """EXIF GPS first, then time matching, else unplaced (SPEC §6.3).

    `track` is None or an object with `.coords` (full track), `.times` and `.simple`
    (simplified line used for route_fraction, matching what the map draws).
    """
    taken = exif_time_utc(exif, trip_tz, camera_offset_s)
    gps = exif.get("gps")

    timed_pos = None
    if track is not None and taken is not None:
        timed_pos = position_at_time(track.coords, track.times, taken.timestamp())

    def fraction(lon, lat):
        return locate_on_line(track.simple, lon, lat)[1] if track is not None else None

    if gps:
        near = track is None or locate_on_line(track.simple, gps["lon"], gps["lat"])[0] <= (
            GPS_PLAUSIBLE_M
        )
        if near:
            ele = gps["ele"]
            if ele is None and track is not None:
                ele = point_at_fraction(track.simple, fraction(gps["lon"], gps["lat"]))[2]
            error = None
            if timed_pos is not None:
                error = round(haversine_m(gps["lat"], gps["lon"], timed_pos[1], timed_pos[0]), 1)
            return Placement(
                "exif",
                (gps["lon"], gps["lat"], ele or 0.0),
                fraction(gps["lon"], gps["lat"]),
                taken,
                error,
            )

    if timed_pos is not None:
        return Placement("time", timed_pos, fraction(timed_pos[0], timed_pos[1]), taken, None)
    return Placement("unplaced", None, None, taken, None)
