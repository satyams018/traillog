"""Background jobs for trips (ADR-6). Each job is idempotent: re-running it overwrites results."""

import logging
import math
from functools import lru_cache
from zoneinfo import ZoneInfo

from celery import shared_task
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import GEOSGeometry, LineString, Point
from django.db import connection, transaction
from django.db.models import F
from django.db.models.functions import Greatest

from core import storage

from .gpx import GpxError, analyse, build_profile, parse_gpx
from .models import Photo, Track, Trip
from .photos import PhotoError, make_copies, place, sniff_type
from .public import build_public_track

log = logging.getLogger(__name__)

SIMPLIFY_TOLERANCE_M = 5.0
PREVIEW_MAX_POINTS = 64


def build_preview(coords, max_points: int = PREVIEW_MAX_POINTS) -> list[list[float]]:
    """Evenly sample the simplified line down to a small 2D outline for trip cards."""
    n = len(coords)
    if n <= max_points:
        idx = range(n)
    else:
        idx = sorted({round(i * (n - 1) / (max_points - 1)) for i in range(max_points)})
    return [[round(coords[i][0], 5), round(coords[i][1], 5)] for i in idx]


@lru_cache(maxsize=1)
def _tz_finder():
    from timezonefinder import TimezoneFinder

    return TimezoneFinder()


def timezone_for(lat: float, lon: float) -> str:
    return _tz_finder().timezone_at(lng=lon, lat=lat) or "UTC"


def simplify_in_postgis(line: LineString, mid_lat: float) -> GEOSGeometry:
    """Douglas–Peucker in Web Mercator so the tolerance is in metres (ADR-9).

    Mercator stretches distances by 1/cos(latitude), so the tolerance is scaled to stay
    ~5 m on the ground.
    """
    tolerance = SIMPLIFY_TOLERANCE_M / max(math.cos(math.radians(mid_lat)), 0.01)
    with connection.cursor() as cur:
        cur.execute(
            "SELECT ST_AsEWKB(ST_Transform(ST_SimplifyPreserveTopology("
            "ST_Transform(ST_GeomFromEWKB(%s), 3857), %s), 4326))",
            [bytes(line.ewkb), tolerance],
        )
        (wkb,) = cur.fetchone()
    return GEOSGeometry(memoryview(wkb))  # WKB must be a buffer, not bytes


def _fail(trip_id, message: str) -> None:
    Trip.objects.filter(id=trip_id).update(status=Trip.Status.FAILED, error=message[:500])


@shared_task(bind=True, max_retries=2, default_retry_delay=10, acks_late=True)
def process_gpx(self, trip_id: str) -> None:
    try:
        trip = Trip.objects.select_related("track").get(id=trip_id)
    except Trip.DoesNotExist:
        return  # deleted while queued
    track: Track = trip.track

    try:
        data = storage.get_bytes(track.gpx_key)
        parsed = parse_gpx(data, max_points=settings.GPX_MAX_POINTS)
        analysis = analyse(parsed)
    except GpxError as exc:
        _fail(trip_id, str(exc))
        return
    except Exception as exc:  # storage hiccup etc. -> retry, then fail
        log.exception("process_gpx failed for %s", trip_id)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc) from exc
        _fail(trip_id, "Processing failed. Please try uploading again.")
        return

    pts = parsed.points
    eles = analysis.smoothed_ele or [0.0] * len(pts)
    line = LineString([(p.lon, p.lat, e) for p, e in zip(pts, eles, strict=True)], srid=4326)
    mid_lat = (min(p.lat for p in pts) + max(p.lat for p in pts)) / 2
    simplified = simplify_in_postgis(line, mid_lat)
    simplified.srid = 4326

    tz_name = timezone_for(pts[0].lat, pts[0].lon)
    tz = ZoneInfo(tz_name)
    times = [p.time for p in pts if p.time]

    stats = analysis.stats | {"points_simplified": simplified.num_points}

    track.geom = line
    track.times = [p.time.timestamp() if p.time else None for p in pts]
    track.segment_breaks = parsed.segment_breaks
    track.simplified_geom = simplified
    track.profile = build_profile(parsed, analysis)
    track.waypoints = parsed.waypoints
    track.preview = build_preview(simplified.coords)
    # Raw start for now; build_public_track will replace it with the privacy-trimmed start.
    track.start_point = Point(pts[0].lon, pts[0].lat, srid=4326)
    track.save()

    trip.stats = stats
    trip.timezone = tz_name
    trip.start_date = min(times).astimezone(tz).date() if times else None
    trip.end_date = max(times).astimezone(tz).date() if times else None
    trip.status = Trip.Status.READY
    trip.error = ""
    trip.save(update_fields=["stats", "timezone", "start_date", "end_date", "status", "error"])
    log.info(
        "process_gpx %s: %d points -> %d simplified",
        trip_id,
        stats["points_raw"],
        stats["points_simplified"],
    )
    # Photos uploaded before (or with) this track can now be matched to it.
    match_photos(trip_id)
    trip.track = track
    build_public_track(trip)


# --- Photos -------------------------------------------------------------------------------


class _TrackForMatching:
    """Plain lists for photos.place(): full track for time matching, simplified line for
    route_fraction (that's the line the map and flythrough use)."""

    def __init__(self, track: Track):
        self.coords = track.geom.coords
        self.times = list(track.times)
        self.simple = track.simplified_geom.coords


def _matching_track(trip: Trip):
    track = getattr(trip, "track", None)
    if track is None or track.geom is None or track.simplified_geom is None:
        return None
    return _TrackForMatching(track)


def apply_placement(photo: Photo, trip: Trip, track) -> None:
    result = place(
        photo.exif, trip_tz=trip.timezone, camera_offset_s=trip.camera_offset_s, track=track
    )
    photo.taken_at = result.taken_at
    photo.placement = result.placement
    photo.route_fraction = result.route_fraction
    photo.time_match_error_m = result.time_match_error_m
    photo.location = Point(*result.lon_lat_ele, srid=4326) if result.lon_lat_ele else None


def _quota_add(user_id, delta: int) -> None:
    get_user_model().objects.filter(id=user_id).update(
        storage_used_bytes=Greatest(F("storage_used_bytes") + delta, 0)
    )


def _fail_photo(photo: Photo, message: str) -> None:
    if photo.upload_key:
        storage.delete(photo.upload_key)
    Photo.objects.filter(id=photo.id, status=Photo.Status.PENDING).update(
        status=Photo.Status.FAILED, error=message[:300], upload_key=None
    )


@shared_task(bind=True, max_retries=2, default_retry_delay=10, acks_late=True)
def process_photo(self, photo_id: str) -> None:
    """Check the upload, keep EXIF fields, make WebP copies, delete the original, place it."""
    photo = Photo.objects.select_related("trip__track").filter(id=photo_id).first()
    if photo is None or photo.status != Photo.Status.PENDING or not photo.upload_key:
        return  # deleted, or already processed by an earlier delivery of this job

    try:
        size = storage.head_size(photo.upload_key)
        if size is None:
            _fail_photo(photo, "The upload didn't finish. Please try again.")
            return
        if size > settings.PHOTO_MAX_BYTES:
            _fail_photo(photo, "Photos must be 25 MB or smaller.")
            return
        data = storage.get_bytes(photo.upload_key)
        if sniff_type(data[:16]) is None:
            _fail_photo(photo, "Only JPEG and HEIC photos are supported.")
            return
        derived = make_copies(data)
        del data
        base = f"derived/{photo.trip_id}/{photo.id}"
        sizes = {"thumb": f"{base}/thumb.webp", "web": f"{base}/web.webp"}
        storage.put_bytes(sizes["thumb"], derived.thumb, content_type="image/webp")
        storage.put_bytes(sizes["web"], derived.web, content_type="image/webp")
    except PhotoError as exc:
        _fail_photo(photo, str(exc))
        return
    except Exception as exc:  # storage hiccup -> retry, then fail
        log.exception("process_photo failed for %s", photo_id)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc) from exc
        _fail_photo(photo, "Processing failed. Please upload this photo again.")
        return

    upload_key = photo.upload_key
    photo.exif = derived.exif
    photo.sizes = sizes
    photo.width, photo.height = derived.width, derived.height
    photo.original_bytes = size
    photo.stored_bytes = len(derived.thumb) + len(derived.web)
    photo.upload_key = None
    photo.status = Photo.Status.READY
    photo.error = ""
    apply_placement(photo, photo.trip, _matching_track(photo.trip))

    with transaction.atomic():
        # Claim the row: only one delivery of this job may count the bytes against the quota.
        claimed = Photo.objects.filter(id=photo.id, status=Photo.Status.PENDING).update(
            **{
                f: getattr(photo, f)
                for f in [
                    "exif",
                    "sizes",
                    "width",
                    "height",
                    "original_bytes",
                    "stored_bytes",
                    "upload_key",
                    "status",
                    "error",
                    "taken_at",
                    "placement",
                    "route_fraction",
                    "time_match_error_m",
                    "location",
                ]
            }
        )
        if claimed:
            _quota_add(photo.uploaded_by_id, photo.stored_bytes)
    if claimed:
        storage.delete(upload_key)  # originals stay with the user (ADR-21)
    else:  # another delivery won the race (or the photo was deleted): drop our copies
        for key in sizes.values():
            storage.delete(key)


@shared_task
def match_photos(trip_id: str) -> int:
    """Re-place every ready photo that wasn't placed by hand. Cheap: no files are read,
    only the EXIF fields saved in the database. Returns how many photos were updated."""
    trip = Trip.objects.select_related("track").filter(id=trip_id).first()
    if trip is None:
        return 0
    track = _matching_track(trip)
    photos = list(
        trip.photos.filter(status=Photo.Status.READY).exclude(placement=Photo.Placement.MANUAL)
    )
    for photo in photos:
        apply_placement(photo, trip, track)
    Photo.objects.bulk_update(
        photos,
        ["taken_at", "placement", "route_fraction", "time_match_error_m", "location"],
        batch_size=200,
    )
    return len(photos)


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def delete_objects(self, keys: list[str]) -> None:
    """Delete storage objects after their rows are gone (trip or photo deletion)."""
    failed = []
    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            log.exception("Deleting %s failed", key)
            failed.append(key)
    if failed and self.request.retries < self.max_retries:
        raise self.retry(args=[failed])
