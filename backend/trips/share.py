"""Share pages: the public story API, the SPA shell with link-preview tags, and the preview
image (SPEC F10, §8, ADR-12, ADR-15)."""

import re
from functools import lru_cache

from django.conf import settings
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.html import escape
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core import storage

from .models import Trip
from .og import ensure_og_image, fingerprint, stat_line
from .public import can_view, public_payload, shared_trip


class PublicTripView(APIView):
    """GET /api/public/u/<username>/<slug>?k=<token>: everything a share page shows."""

    permission_classes = [AllowAny]
    throttle_scope = "public"

    def get(self, request, username, slug):
        trip = shared_trip(username, slug, request.query_params.get("k"), request.user)
        response = Response(public_payload(trip))
        if trip.visibility != Trip.Visibility.PUBLIC:
            response["X-Robots-Tag"] = "noindex"
        response["Cache-Control"] = "private, no-store"  # file URLs inside expire in 1 h
        return response


_DEFAULT_DESCRIPTION = re.compile(r'\s*<meta\s+name="description"[^>]*>')


@lru_cache(maxsize=1)
def _spa_shell(path: str, mtime: float) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _shell() -> str:
    path = settings.FRONTEND_INDEX
    if path.exists():
        return _spa_shell(str(path), path.stat().st_mtime)
    # No built frontend (development): a bare page so the meta tags can still be checked.
    return (
        '<!doctype html><html lang="en"><head><meta charset="UTF-8" />'
        '<title>TrailLog</title></head><body><div id="root"></div></body></html>'
    )


def _meta_tags(request, trip: Trip, token: str | None) -> str:
    owner = getattr(trip.owner, "display_name", "") or trip.owner.username
    description = trip.description.strip()[:200] or (
        f"{stat_line(trip.stats)}. A trip by {owner} on TrailLog.".replace("   ", ", ")
    )
    query = f"?k={token}&v={fingerprint(trip)}" if token else f"?v={fingerprint(trip)}"
    image = request.build_absolute_uri(f"/og/{trip.id}.png{query}")
    url = request.build_absolute_uri(request.get_full_path())
    tags = {
        "og:type": "article",
        "og:site_name": "TrailLog",
        "og:title": trip.title,
        "og:description": description,
        "og:url": url,
        "og:image": image,
        "og:image:width": "1200",
        "og:image:height": "630",
    }
    out = [f"<title>{escape(trip.title)} · TrailLog</title>"]
    out += [f'<meta property="{k}" content="{escape(v)}" />' for k, v in tags.items()]
    out += [
        '<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="description" content="{escape(description)}" />',
    ]
    if trip.visibility != Trip.Visibility.PUBLIC:
        out.append('<meta name="robots" content="noindex" />')  # Link trips stay unlisted
    return "\n    ".join(out)


def share_page(request, username, slug):
    """GET /u/<username>/<slug>: the SPA with this trip's preview tags in <head>. Crawlers
    (WhatsApp, Slack, X) read only these; people get the full app, which loads the story."""
    token = request.GET.get("k")
    html = _shell()
    try:
        trip = shared_trip(username, slug, token, request.user)
    except Http404:
        return HttpResponse(html, status=404)  # same shell: the app shows "not found"
    # The app's default <title> and description are replaced; the rest of <head> is kept.
    head = _meta_tags(request, trip, token if trip.visibility == Trip.Visibility.LINK else None)
    html = _DEFAULT_DESCRIPTION.sub("", html, count=1)
    if "<title>" in html:
        start, end = html.index("<title>"), html.index("</title>") + len("</title>")
        html = html[:start] + head + html[end:]
    else:
        html = html.replace("</head>", f"    {head}\n  </head>", 1)
    return HttpResponse(html)


def og_image(request, trip_id):
    """GET /og/<trip_id>.png?k=: 302 to a fresh signed URL of the trip's preview image."""
    trip = get_object_or_404(Trip.objects.select_related("owner", "track"), id=trip_id)
    if not can_view(trip, request.GET.get("k"), request.user):
        raise Http404
    # Set directly rather than via HttpResponseRedirect: the URL comes from our own storage,
    # and the in-memory test backend uses a memory:// scheme Django would refuse.
    response = HttpResponse(status=302)
    response["Location"] = storage.presign_get(ensure_og_image(trip))
    response["Cache-Control"] = "public, max-age=600"  # well inside the URL's 1 h expiry
    return response
