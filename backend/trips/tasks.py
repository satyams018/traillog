"""Background jobs for trips (ADR-6). Each job is idempotent: re-running it overwrites results."""

import logging
import math
from functools import lru_cache
from zoneinfo import ZoneInfo

from celery import shared_task
from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry, LineString, Point
from django.db import connection

from core import storage

from .gpx import GpxError, analyse, build_profile, parse_gpx
from .models import Track, Trip

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
