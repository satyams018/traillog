"""Builds synthetic GPX files with known geometry for tests."""

from datetime import UTC, datetime, timedelta

START = datetime(2026, 5, 10, 2, 30, tzinfo=UTC)  # 08:00 IST


def make_points(n=50, lat0=32.24, lon0=77.18, dlat=0.0009, ele0=3000.0, dele=0.0, dt_s=10):
    """n points going north; each step is ~100 m (0.0009° of latitude)."""
    return [
        (lat0 + i * dlat, lon0, ele0 + i * dele, START + timedelta(seconds=i * dt_s))
        for i in range(n)
    ]


def gpx_xml(segments, waypoints=(), as_route=False) -> bytes:
    def pt(tag, lat, lon, ele, t):
        ele_xml = f"<ele>{ele}</ele>" if ele is not None else ""
        time_xml = f"<time>{t.strftime('%Y-%m-%dT%H:%M:%SZ')}</time>" if t else ""
        return f'<{tag} lat="{lat}" lon="{lon}">{ele_xml}{time_xml}</{tag}>'

    body = ""
    if as_route:
        body = "<rte>" + "".join(pt("rtept", *p) for p in segments[0]) + "</rte>"
    else:
        segs = "".join(
            "<trkseg>" + "".join(pt("trkpt", *p) for p in seg) + "</trkseg>" for seg in segments
        )
        body = f"<trk><name>Test</name>{segs}</trk>"
    wpts = "".join(
        f'<wpt lat="{lat}" lon="{lon}"><name>{name}</name></wpt>' for name, lat, lon in waypoints
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<gpx version="1.1" creator="tests" xmlns="http://www.topografix.com/GPX/1/1">'
        f"{wpts}{body}</gpx>"
    ).encode()
