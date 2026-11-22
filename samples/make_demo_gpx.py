"""Generate a synthetic but realistic-looking 2-day trek GPX for local testing.

Not a real recording: the route wanders north-east from near Manali with GPS-like noise,
climbs to ~4,270 m, camps overnight, and descends the next morning.
Usage: uv run --python 3.12 make_demo_gpx.py > demo-trek.gpx
"""

import math
import random
from datetime import UTC, datetime, timedelta

rng = random.Random(42)
lat, lon = 32.2600, 77.2300
heading = math.radians(35)
t = datetime(2026, 5, 10, 2, 30, tzinfo=UTC)  # 08:00 IST
N_DAY = 3000
points = []
for day in range(2):
    for i in range(N_DAY):
        progress = (day * N_DAY + i) / (2 * N_DAY)
        heading += rng.gauss(0, 0.08)
        heading = 0.9 * heading + 0.1 * math.radians(35)
        step = 3.2 + rng.gauss(0, 0.6)  # metres per sample (~1.1 m/s walking, 3 s logging)
        lat += step * math.cos(heading) / 111_320
        lon += step * math.sin(heading) / (111_320 * math.cos(math.radians(lat)))
        base = 2900 + 1370 * math.sin(math.pi * min(progress / 0.5, 1) / 2) if progress < 0.5 \
            else 4270 - 1100 * (progress - 0.5) / 0.5
        ele = base + 25 * math.sin(progress * 60) + rng.gauss(0, 4)  # rolling terrain + GPS noise
        if rng.random() < 0.002:
            ele += rng.choice([-1, 1]) * 40  # occasional GPS altitude spike
        nlat, nlon = lat + rng.gauss(0, 2e-5), lon + rng.gauss(0, 2e-5)
        points.append((nlat, nlon, ele, t))
        t += timedelta(seconds=3)
        if i % 600 == 599:
            t += timedelta(minutes=8)  # short breaks
    t += timedelta(hours=14)  # overnight camp

out = ['<?xml version="1.0" encoding="UTF-8"?>',
       '<gpx version="1.1" creator="TrailLog demo" xmlns="http://www.topografix.com/GPX/1/1">',
       '<trk><name>Demo trek</name><trkseg>']
for la, lo, el, ti in points:
    out.append(f'<trkpt lat="{la:.6f}" lon="{lo:.6f}"><ele>{el:.1f}</ele>'
               f'<time>{ti.strftime("%Y-%m-%dT%H:%M:%SZ")}</time></trkpt>')
out.append("</trkseg></trk></gpx>")
print("\n".join(out))
