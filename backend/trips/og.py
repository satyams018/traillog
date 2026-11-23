"""1200×630 link-preview image for share pages (SPEC §6.5, ADR-15).

The cover photo blurred and darkened as the background, the privacy-trimmed route drawn on
the right, and the title and key numbers on the left. No map tiles are fetched. Images are
keyed by a fingerprint of what they show, so a changed title or route gets a new file and
link-preview caches never serve a stale one.
"""

import hashlib
import io
import json
import math
import textwrap

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from core import storage

from .models import Trip
from .public import cover_photo

W, H = 1200, 630
INK = (19, 28, 46)
BRAND = (36, 73, 200)
ROUTE = (227, 58, 110)
WHITE = (255, 255, 255)
HILLY_GAIN_M = 150  # same rule as the web app's isHilly()


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.load_default(size=size)  # Pillow's bundled scalable font, no file needed


def _fmt_km(m) -> str:
    return f"{m / 1000:.1f} km" if m is not None else ""


def _fmt_dur(s) -> str:
    if s is None:
        return ""
    h, m = divmod(round(s / 60), 60)
    return f"{h}h {m:02d}m" if h else f"{m} min"


def stat_line(stats: dict) -> str:
    parts = [_fmt_km(stats.get("distance_m")), _fmt_dur(stats.get("total_s"))]
    if (stats.get("gain_m") or 0) >= HILLY_GAIN_M:
        parts.append(f"{stats['gain_m']:,} m climb")
    return "   ".join(p for p in parts if p)


def fingerprint(trip: Trip) -> str:
    """Changes whenever anything drawn on the image changes."""
    track = getattr(trip, "track", None)
    geom = track.public_geom if track is not None else None
    cover = cover_photo(trip)
    data = [
        trip.title,
        stat_line(trip.stats),
        cover.sizes.get("web") if cover else None,
        [geom.num_points, geom.coords[0], geom.coords[-1]] if geom else None,
    ]
    digest = hashlib.blake2b(json.dumps(data, default=str).encode(), digest_size=6)
    return digest.hexdigest()  # a cache key, not a security check


def og_key(trip: Trip) -> str:
    return f"og/{trip.id}-{fingerprint(trip)}.png"


def _background(trip: Trip) -> Image.Image:
    cover = cover_photo(trip)
    if cover and cover.sizes.get("web"):
        img = Image.open(io.BytesIO(storage.get_bytes(cover.sizes["web"]))).convert("RGB")
        scale = max(W / img.width, H / img.height)
        img = img.resize((math.ceil(img.width * scale), math.ceil(img.height * scale)))
        left, top = (img.width - W) // 2, (img.height - H) // 2
        img = img.crop((left, top, left + W, top + H)).filter(ImageFilter.GaussianBlur(14))
        return ImageEnhance.Brightness(img).enhance(0.45)
    # No photos yet: a deep ink-to-blue wash.
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H * 0.5
        color = tuple(round(a + (b - a) * t) for a, b in zip(INK, BRAND, strict=True))
        d.line([(0, y), (W, y)], fill=color)
    return img


def _route_points(coords, box) -> list[tuple[float, float]]:
    """Project [lon, lat] into a box, keeping the shape (longitude scaled by cos(latitude))."""
    x0, y0, x1, y1 = box
    k = math.cos(math.radians(sum(c[1] for c in coords) / len(coords)))
    xs = [c[0] * k for c in coords]
    ys = [c[1] for c in coords]
    w, h = (max(xs) - min(xs)) or 1e-9, (max(ys) - min(ys)) or 1e-9
    s = min((x1 - x0) / w, (y1 - y0) / h)
    ox = x0 + ((x1 - x0) - w * s) / 2
    oy = y0 + ((y1 - y0) - h * s) / 2
    return [(ox + (x - min(xs)) * s, oy + (max(ys) - y) * s) for x, y in zip(xs, ys, strict=True)]


def render_og_image(trip: Trip) -> bytes:
    img = _background(trip)
    d = ImageDraw.Draw(img)

    track = getattr(trip, "track", None)
    if track is not None and track.public_geom is not None:
        pts = _route_points(track.public_geom.coords, (690, 90, 1120, 540))
        d.line(pts, fill=WHITE, width=16, joint="curve")
        d.line(pts, fill=ROUTE, width=8, joint="curve")
        for (x, y), color in ((pts[0], BRAND), (pts[-1], ROUTE)):
            d.ellipse((x - 13, y - 13, x + 13, y + 13), fill=color, outline=WHITE, width=5)

    title = textwrap.wrap(trip.title, width=20)[:3]
    y = 150 if len(title) < 3 else 110
    for line in title:
        # stroke in the same colour fakes a bold weight with the built-in font
        d.text((80, y), line, font=_font(68), fill=WHITE, stroke_width=2, stroke_fill=WHITE)
        y += 84
    d.text((80, y + 24), stat_line(trip.stats), font=_font(36), fill=WHITE)

    # Brand mark: a raspberry pin dot and the name, bottom left.
    d.ellipse((80, 532, 104, 556), fill=ROUTE, outline=WHITE, width=3)
    owner = getattr(trip.owner, "display_name", "") or trip.owner.username
    d.text((118, 528), f"TrailLog  ·  a trip by {owner}", font=_font(28), fill=WHITE)

    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def ensure_og_image(trip: Trip) -> str:
    """Object key of the trip's current preview image, rendering it on first request."""
    key = og_key(trip)
    if storage.head_size(key) is None:
        storage.put_bytes(key, render_og_image(trip), "image/png")
    return key
