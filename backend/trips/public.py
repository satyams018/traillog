"""What a share page may show: the privacy-trimmed route and the public payload (SPEC §6.4, §8).

The privacy zone hides the first and last `privacy_zone_m` metres of the route, so a share
page doesn't reveal where someone's home or hotel is. Everything on the public page is
expressed relative to the trimmed line: route positions of photos and stops are re-scaled to
it, photos inside a zone lose their map position, and the profile starts again at 0 km.
"""

import secrets
from dataclasses import dataclass

from django.contrib.gis.geos import LineString, Point
from django.http import Http404

from core import storage

from .gpx import haversine_m
from .models import Highlight, Photo, Trip

# Stats a viewer may see. Totals don't reveal a location (§8); point counts are internal.
PUBLIC_STATS = (
    "distance_m",
    "gain_m",
    "loss_m",
    "max_ele_m",
    "min_ele_m",
    "total_s",
    "moving_s",
    "pace_s_per_km",
    "avg_moving_speed_kmh",
    "has_elevation",
    "has_time",
)


@dataclass(frozen=True)
class Window:
    """The visible part of the route, as fractions (0..1) of its full length."""

    start: float
    end: float

    def to_public(self, fraction: float | None) -> float | None:
        """A full-route fraction on the trimmed line, or None if it's inside a zone."""
        if fraction is None or fraction < self.start or fraction > self.end:
            return None
        return round((fraction - self.start) / (self.end - self.start), 5)


def _cumulative(coords) -> list[float]:
    out = [0.0]
    for a, b in zip(coords, coords[1:], strict=False):
        out.append(out[-1] + haversine_m(a[1], a[0], b[1], b[0]))
    return out


def _point_at(coords, cum, d: float):
    for i in range(1, len(coords)):
        if cum[i] >= d:
            seg = cum[i] - cum[i - 1]
            t = 0.0 if seg == 0 else (d - cum[i - 1]) / seg
            a, b = coords[i - 1], coords[i]
            return tuple(a[k] + t * (b[k] - a[k]) for k in range(len(a)))
    return tuple(coords[-1])


def trim_line(coords, zone_m: float) -> tuple[list[tuple], Window] | None:
    """Cut `zone_m` metres off each end of a [lon, lat, ele] line.

    Returns the visible coordinates and their window, or None when the route is too short to
    show anything (shorter than both zones together).
    """
    if len(coords) < 2:
        return None
    cum = _cumulative(coords)
    total = cum[-1]
    if zone_m <= 0:
        return [tuple(c) for c in coords], Window(0.0, 1.0)
    if total <= 2 * zone_m:
        return None
    start, end = zone_m, total - zone_m
    inner = [tuple(c) for c, d in zip(coords, cum, strict=True) if start < d < end]
    trimmed = [_point_at(coords, cum, start), *inner, _point_at(coords, cum, end)]
    return trimmed, Window(start / total, end / total)


def public_window(trip: Trip) -> Window | None:
    track = getattr(trip, "track", None)
    if track is None or track.simplified_geom is None:
        return None
    result = trim_line(track.simplified_geom.coords, trip.privacy_zone_m)
    return result[1] if result else None


def build_public_track(trip: Trip) -> None:
    """Store the trimmed line, profile and start point (runs when the track or zone changes)."""
    track = getattr(trip, "track", None)
    if track is None or track.simplified_geom is None:
        return
    result = trim_line(track.simplified_geom.coords, trip.privacy_zone_m)
    if result is None:
        track.public_geom, track.public_profile, track.start_point = None, [], None
    else:
        coords, window = result
        track.public_geom = LineString(coords, srid=4326)
        track.start_point = Point(coords[0][0], coords[0][1], srid=4326)
        total = track.profile[-1][0] if track.profile else 0
        lo, hi = window.start * total, window.end * total
        # Re-based to start at 0 km, and without timestamps (§8: never `times`).
        track.public_profile = [
            [round(r[0] - lo, 1), r[1], None, r[3], r[4]] for r in track.profile if lo <= r[0] <= hi
        ]
    track.save(update_fields=["public_geom", "public_profile", "start_point", "updated_at"])


# --- Access -------------------------------------------------------------------------------


def shared_trip(username: str, slug: str, token: str | None, user) -> Trip:
    """The trip a share URL points to, or 404. Private trips and wrong or missing link tokens
    look exactly like trips that don't exist (§8, ADR-13). The owner can always preview."""
    trip = (
        Trip.objects.select_related("owner", "track")
        .filter(owner__username__iexact=username, slug=slug)
        .first()
    )
    if trip is None:
        raise Http404
    if user.is_authenticated and trip.owner_id == user.id:
        return trip
    if trip.status != Trip.Status.READY:
        raise Http404
    if trip.visibility == Trip.Visibility.PUBLIC:
        return trip
    if trip.visibility == Trip.Visibility.LINK and token:
        if secrets.compare_digest(token, trip.share_token):
            return trip
    raise Http404


def can_view(trip: Trip, token: str | None, user) -> bool:
    try:
        shared_trip(trip.owner.username, trip.slug, token, user)
    except Http404:
        return False
    return True


# --- Payload ------------------------------------------------------------------------------


def public_photos(trip: Trip):
    return trip.photos.filter(status=Photo.Status.READY, is_public=True)


def cover_photo(trip: Trip) -> Photo | None:
    return public_photos(trip).order_by("order", "taken_at", "created_at").first()


def _photo(p: Photo, window: Window | None) -> dict:
    fraction = window.to_public(p.route_fraction) if window else None
    return {
        "id": str(p.id),
        "thumb_url": storage.presign_get(p.sizes["thumb"]) if p.sizes.get("thumb") else None,
        "web_url": storage.presign_get(p.sizes["web"]) if p.sizes.get("web") else None,
        "width": p.width,
        "height": p.height,
        "caption": p.caption,
        # Rounded to the minute (§8); no map position inside a privacy zone (§8).
        "taken_at": p.taken_at.replace(second=0, microsecond=0) if p.taken_at else None,
        "location": list(p.location.coords) if p.location and fraction is not None else None,
        "route_fraction": fraction,
        "highlight": str(p.highlight_id) if p.highlight_id else None,
    }


def public_payload(trip: Trip) -> dict:
    track = getattr(trip, "track", None)
    if track is not None and track.simplified_geom is not None and track.public_geom is None:
        build_public_track(trip)  # trips processed before share pages existed
    window = public_window(trip)
    photos = [_photo(p, window) for p in public_photos(trip)]
    by_id = {p["id"]: p for p in photos}

    highlights = []
    for h in Highlight.objects.filter(trip=trip).prefetch_related("photos"):
        ids = [str(p.id) for p in h.photos.all() if str(p.id) in by_id]
        at = {i: by_id[i]["route_fraction"] for i in ids}
        ids.sort(key=lambda i: (at[i] is None, at[i] or 0))  # route order, unplaced last
        placed = [at[i] for i in ids if at[i] is not None]
        highlights.append(
            {
                "id": str(h.id),
                "kind": h.kind,
                "label": h.label,
                "body": h.body,
                "order": h.order,
                "photo_ids": ids,
                "route_fraction": round(sum(placed) / len(placed), 5) if placed else None,
            }
        )

    public_track = None
    if track is not None and track.public_geom is not None:
        geom = track.public_geom
        public_track = {
            "geometry": {"type": "LineString", "coordinates": geom.coords},
            "bbox": list(geom.extent),
            "profile": track.public_profile,
            "waypoints": [],
        }

    cover = cover_photo(trip)
    return {
        "trip": {
            "id": str(trip.id),
            "title": trip.title,
            "slug": trip.slug,
            "description": trip.description,
            "visibility": trip.visibility,
            "owner": {
                "username": trip.owner.username,
                "display_name": getattr(trip.owner, "display_name", "") or trip.owner.username,
            },
            "start_date": trip.start_date,
            "end_date": trip.end_date,
            "timezone": trip.timezone,
            "stats": {k: trip.stats.get(k) for k in PUBLIC_STATS if k in trip.stats},
            "privacy_zone_m": trip.privacy_zone_m,
            "cover_url": storage.presign_get(cover.sizes["web"]) if cover else None,
        },
        "track": public_track,
        "photos": photos,
        "highlights": highlights,
    }
