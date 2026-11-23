"""Export samples/demo-trek.gpx as the small track the landing page shows on its live map.

  uv run --project backend python samples/make_landing_track.py

Uses the same parsing and profile code as the backend, thinned to 240 points so the file
stays small (~20 kB). Writes frontend/src/assets/sample-trek.json in the /track API shape,
plus the stats the hero card prints.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from trips.gpx import analyse, build_profile, parse_gpx  # noqa: E402

SAMPLES = 240


def main() -> None:
    parsed = parse_gpx((ROOT / "samples" / "demo-trek.gpx").read_bytes())
    analysis = analyse(parsed)
    profile = build_profile(parsed, analysis, max_samples=SAMPLES)
    coords = [[r[3], r[4], r[1] or 0] for r in profile]
    lngs, lats = [c[0] for c in coords], [c[1] for c in coords]
    stats = analysis.stats
    out = {
        "geometry": {"type": "LineString", "coordinates": coords},
        "bbox": [min(lngs), min(lats), max(lngs), max(lats)],
        "profile": profile,
        "waypoints": [],
        "stats": {k: stats.get(k) for k in ("distance_m", "gain_m", "max_ele_m", "total_s")},
    }
    dest = ROOT / "frontend" / "src" / "assets" / "sample-trek.json"
    dest.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {len(profile)} points to {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
