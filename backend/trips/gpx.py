"""GPX parsing and trip statistics (SPEC §6.1).

Everything here is plain Python with no database access, so it can be unit-tested directly.
Simplification (Douglas–Peucker) happens in PostGIS, see `tasks.py`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

import gpxpy
import gpxpy.gpx

EARTH_RADIUS_M = 6_371_008.8  # mean Earth radius

# Tuned constants, explained in docs/decisions.md (ADR-8).
MEDIAN_WINDOW = 5  # points; removes single-point GPS spikes
HYSTERESIS_M = 5.0  # ignore elevation wiggles smaller than this
MOVING_MIN_SPEED_MS = 0.3  # ~1 km/h; slower than this counts as stopped
MOVING_MAX_GAP_S = 60  # a longer gap between points is a pause, not movement
PROFILE_MAX_SAMPLES = 2000


class GpxError(ValueError):
    """The file isn't usable. The message is safe to show to the user."""


@dataclass
class TrackPoint:
    lat: float
    lon: float
    ele: float | None
    time: datetime | None


@dataclass
class ParsedGpx:
    points: list[TrackPoint]
    # Indexes where a new segment starts (excluding 0). No distance is counted across a break.
    segment_breaks: list[int] = field(default_factory=list)
    waypoints: list[dict] = field(default_factory=list)


def parse_gpx(data: bytes, max_points: int = 200_000) -> ParsedGpx:
    """Parse GPX bytes into one ordered list of points.

    Uses <trk> segments; falls back to <rte> points when a file has no track.
    """
    try:
        gpx = gpxpy.parse(data.decode("utf-8-sig", errors="replace"))
    except (gpxpy.gpx.GPXException, ValueError) as exc:
        raise GpxError("This doesn't look like a valid GPX file.") from exc

    points: list[TrackPoint] = []
    breaks: list[int] = []

    def add_segment(raw_points) -> None:
        if points and raw_points:
            breaks.append(len(points))
        for p in raw_points:
            if not (-90 <= p.latitude <= 90 and -180 <= p.longitude <= 180):
                raise GpxError("The GPX file contains coordinates outside the valid range.")
            points.append(TrackPoint(p.latitude, p.longitude, p.elevation, p.time))
            if len(points) > max_points:
                raise GpxError(f"The track has more than {max_points:,} points.")

    for track in gpx.tracks:
        for segment in track.segments:
            add_segment(segment.points)
    if not points:
        for route in gpx.routes:
            add_segment(route.points)

    if len(points) < 2:
        raise GpxError("The GPX file needs at least two track points.")

    waypoints = [
        {"name": w.name or "", "lat": w.latitude, "lon": w.longitude, "ele": w.elevation}
        for w in gpx.waypoints
    ]
    return ParsedGpx(points=points, segment_breaks=breaks, waypoints=waypoints)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two lat/lon points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def fill_missing(values: list[float | None]) -> list[float] | None:
    """Linearly interpolate None gaps; copy the nearest value at the ends.

    Returns None when there are no values at all (e.g. a GPX with no elevation).
    """
    known = [i for i, v in enumerate(values) if v is not None]
    if not known:
        return None
    out = [0.0] * len(values)
    for i in range(known[0] + 1):
        out[i] = values[known[0]]
    for a, b in zip(known, known[1:], strict=False):
        va, vb = values[a], values[b]
        for i in range(a, b + 1):
            out[i] = va + (vb - va) * (i - a) / (b - a)
    for i in range(known[-1], len(values)):
        out[i] = values[known[-1]]
    return out


def median_filter(values: list[float], window: int = MEDIAN_WINDOW) -> list[float]:
    """Sliding median. Near the ends the window shrinks symmetrically (so the first and last
    points keep their own value instead of being pulled towards one side)."""
    half = window // 2
    n = len(values)
    out = []
    for i in range(n):
        k = min(half, i, n - 1 - i)
        chunk = sorted(values[i - k : i + k + 1])
        out.append(chunk[len(chunk) // 2])
    return out


def gain_loss_hysteresis(values: list[float], threshold: float = HYSTERESIS_M):
    """Count climbing/descending only after elevation moves `threshold` m from the last
    reference point. This ignores GPS noise that a raw sum would add up (ADR-8)."""
    if not values:
        return 0.0, 0.0
    gain = loss = 0.0
    ref = values[0]
    for v in values[1:]:
        if v - ref >= threshold:
            gain += v - ref
            ref = v
        elif ref - v >= threshold:
            loss += ref - v
            ref = v
    return gain, loss


def gain_loss_raw(values: list[float]):
    gain = sum(max(0.0, b - a) for a, b in zip(values, values[1:], strict=False))
    loss = sum(max(0.0, a - b) for a, b in zip(values, values[1:], strict=False))
    return gain, loss


@dataclass
class TrackAnalysis:
    stats: dict
    cumulative_m: list[float]
    smoothed_ele: list[float] | None


def analyse(parsed: ParsedGpx) -> TrackAnalysis:
    """Compute distance, elevation and time stats for a parsed track."""
    pts = parsed.points
    breaks = set(parsed.segment_breaks)

    cumulative = [0.0]
    moving_s = 0.0
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]
        step = 0.0 if i in breaks else haversine_m(a.lat, a.lon, b.lat, b.lon)
        cumulative.append(cumulative[-1] + step)
        if i in breaks or a.time is None or b.time is None:
            continue
        dt = (b.time - a.time).total_seconds()
        if 0 < dt <= MOVING_MAX_GAP_S and step / dt >= MOVING_MIN_SPEED_MS:
            moving_s += dt

    distance_m = cumulative[-1]
    filled = fill_missing([p.ele for p in pts])
    smoothed = median_filter(filled) if filled else None

    times = [p.time for p in pts if p.time is not None]
    total_s = (max(times) - min(times)).total_seconds() if len(times) >= 2 else None
    has_time = total_s is not None and total_s > 0

    stats: dict = {
        "distance_m": round(distance_m, 1),
        "points_raw": len(pts),
        "segments": len(parsed.segment_breaks) + 1,
        "has_elevation": smoothed is not None,
        "has_time": has_time,
        "gain_m": None,
        "loss_m": None,
        "raw_gain_m": None,
        "max_ele_m": None,
        "min_ele_m": None,
        "total_s": round(total_s) if has_time else None,
        "moving_s": round(moving_s) if has_time else None,
        "pace_s_per_km": None,
        "avg_moving_speed_kmh": None,
    }
    if smoothed:
        gain, loss = gain_loss_hysteresis(smoothed)
        raw_gain, _ = gain_loss_raw(filled)
        stats.update(
            gain_m=round(gain),
            loss_m=round(loss),
            raw_gain_m=round(raw_gain),
            max_ele_m=round(max(smoothed)),
            min_ele_m=round(min(smoothed)),
        )
    if has_time and moving_s > 0 and distance_m > 0:
        stats["pace_s_per_km"] = round(moving_s / (distance_m / 1000))
        stats["avg_moving_speed_kmh"] = round((distance_m / 1000) / (moving_s / 3600), 2)

    return TrackAnalysis(stats=stats, cumulative_m=cumulative, smoothed_ele=smoothed)


def build_profile(
    parsed: ParsedGpx, analysis: TrackAnalysis, max_samples: int = PROFILE_MAX_SAMPLES
) -> list[list]:
    """Downsample to <= max_samples rows of [dist_m, ele_m, epoch_s, lng, lat] for the chart.

    lng/lat are included so the chart and map can sync without extra geometry maths.
    """
    n = len(parsed.points)
    step = max(1, math.ceil(n / max_samples))
    idx = list(range(0, n, step))
    if idx[-1] != n - 1:
        idx[-1] = n - 1  # always keep the last point, without exceeding max_samples
    rows = []
    for i in idx:
        p = parsed.points[i]
        ele = analysis.smoothed_ele[i] if analysis.smoothed_ele else None
        rows.append(
            [
                round(analysis.cumulative_m[i], 1),
                round(ele, 1) if ele is not None else None,
                p.time.timestamp() if p.time else None,
                round(p.lon, 6),
                round(p.lat, 6),
            ]
        )
    return rows
