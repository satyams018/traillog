"""Make demo JPEGs for samples/demo-trek.gpx, with EXIF that exercises every placement path.

  uv run --project backend python samples/make_demo_photos.py <out_dir>

- 8 photos with GPS + time  -> placed from photo GPS
- 3 photos with time only, camera clock 10 min slow -> matched by time (fix with +10 min)
- 1 photo with no EXIF       -> not placed; place it by hand
The images are drawn procedurally (sky, ridges, sun), so no real photos are needed.
"""

import random
import sys
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import ExifTags, Image, ImageDraw

GPX = Path(__file__).with_name("demo-trek.gpx")
NS = {"g": "http://www.topografix.com/GPX/1/1"}
IST = ZoneInfo("Asia/Kolkata")
W, H = 2400, 1600


def track_points():
    root = ET.parse(GPX).getroot()  # noqa: S314 - our own sample file
    for p in root.iterfind(".//g:trkpt", NS):
        t = datetime.strptime(p.find("g:time", NS).text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
        yield float(p.get("lat")), float(p.get("lon")), t


def landscape(seed: int) -> Image.Image:
    rnd = random.Random(seed)
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    top = (rnd.randint(70, 120), rnd.randint(140, 190), rnd.randint(200, 240))
    bottom = (rnd.randint(230, 250), rnd.randint(200, 230), rnd.randint(160, 200))
    for y in range(H):
        f = y / H
        d.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * f) for a, b in zip(top, bottom)))
    d.ellipse([W * 0.7, H * 0.12, W * 0.7 + 180, H * 0.12 + 180], fill=(255, 236, 190))
    for layer in range(4):
        base = H * (0.45 + layer * 0.13)
        shade = 150 - layer * 32
        pts = [(0, H)]
        x = 0
        while x <= W:
            pts.append((x, base - rnd.randint(0, int(260 - layer * 40))))
            x += rnd.randint(120, 260)
        pts += [(W, base), (W, H)]
        d.polygon(pts, fill=(shade // 3, shade, shade // 2 + 20))
    return img


def save(img: Image.Image, path: Path, when: datetime | None, gps=None):
    exif = Image.Exif()
    exif[ExifTags.Base.Model] = "Demo Camera"
    if when:
        sub = exif.get_ifd(ExifTags.IFD.Exif)
        sub[ExifTags.Base.DateTimeOriginal] = when.astimezone(IST).strftime("%Y:%m:%d %H:%M:%S")
    if gps:
        lat, lon = gps
        g = exif.get_ifd(ExifTags.IFD.GPSInfo)

        def dms(v):
            d = int(v)
            m = int((v - d) * 60)
            return (float(d), float(m), round((v - d - m / 60) * 3600, 4))

        g[1], g[2], g[3], g[4] = "N", dms(lat), "E", dms(lon)
    img.save(path, "JPEG", quality=88, exif=exif if (when or gps) else b"")


def main(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    pts = list(track_points())
    picks = [round(i * (len(pts) - 1) / 12) for i in range(1, 12)]
    for n, idx in enumerate(picks, start=1):
        lat, lon, t = pts[idx]
        if n <= 8:
            save(landscape(n), out / f"IMG_{n:04d}.jpg", t, gps=(lat, lon))
        else:  # time only, from a camera whose clock ran 10 minutes slow
            save(landscape(n), out / f"IMG_{n:04d}.jpg", t - timedelta(minutes=10))
    save(landscape(99), out / "IMG_0012.jpg", None)
    print(f"Wrote 12 photos to {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "demo-photos"))
