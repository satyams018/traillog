"""Unit tests for photo decoding, EXIF time handling and route placement (no DB)."""

import io
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from PIL import Image

from trips.photos import (
    PhotoError,
    exif_time_utc,
    locate_on_line,
    make_copies,
    place,
    point_at_fraction,
    position_at_time,
    sniff_type,
)

from .photo_factory import make_jpeg

# A straight line going north: 11 points ~100 m apart, one every 60 s from 02:30 UTC.
T0 = datetime(2026, 5, 10, 2, 30, tzinfo=UTC).timestamp()
COORDS = [(77.18, 32.24 + i * 0.0009, 3000.0 + i * 10) for i in range(11)]
TIMES = [T0 + i * 60 for i in range(11)]
TRACK = SimpleNamespace(coords=COORDS, times=TIMES, simple=COORDS)


def test_sniff_type():
    assert sniff_type(make_jpeg()[:16]) == "image/jpeg"
    assert sniff_type(b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00") == "image/heic"
    assert sniff_type(b"\x89PNG\r\n\x1a\n" + b"\x00" * 8) is None


def test_copies_are_webp_without_metadata_and_upright():
    data = make_jpeg(gps=(32.25, 77.18), orientation=6, size=(320, 200))
    out = make_copies(data)
    assert out.exif["gps"] == {"lat": 32.25, "lon": 77.18, "ele": None}
    assert out.exif["camera_model"] == "Test Cam"
    for blob in (out.web, out.thumb):
        img = Image.open(io.BytesIO(blob))
        assert img.format == "WEBP"
        assert not img.getexif()  # no EXIF, so no GPS leaks into served files (F11)
        assert b"Exif" not in blob and b"XMP" not in blob
    # Orientation 6 = rotated 90°, so the stored copy is portrait.
    assert (out.width, out.height) == (200, 320)


def test_large_photo_is_scaled_to_web_size():
    out = make_copies(make_jpeg(size=(4000, 3000)))
    assert (out.width, out.height) == (1600, 1200)
    assert max(Image.open(io.BytesIO(out.thumb)).size) == 400


def test_southern_western_gps_is_negative():
    out = make_copies(make_jpeg(gps=(-13.16, -72.54)))
    assert out.exif["gps"]["lat"] == pytest.approx(-13.16, abs=1e-5)
    assert out.exif["gps"]["lon"] == pytest.approx(-72.54, abs=1e-5)


def test_non_image_rejected():
    with pytest.raises(PhotoError):
        make_copies(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
    with pytest.raises(PhotoError):
        make_copies(b"\xff\xd8\xff" + b"garbage" * 10)


@pytest.mark.parametrize(
    "exif,tz,offset_s,expected",
    [
        # Offset written by the camera wins over the trip time zone.
        ({"datetime_raw": "2026:05:10 08:00:00", "offset": "+05:30"}, "UTC", 0, "02:30"),
        # No offset: camera clock assumed to be on trip local time (IST).
        ({"datetime_raw": "2026:05:10 08:00:00"}, "Asia/Kolkata", 0, "02:30"),
        # DST: Berlin is UTC+2 in summer and UTC+1 in winter.
        ({"datetime_raw": "2026:07:01 12:00:00"}, "Europe/Berlin", 0, "10:00"),
        ({"datetime_raw": "2026:01:15 12:00:00"}, "Europe/Berlin", 0, "11:00"),
        # Camera clock 1 h slow -> +3600 s correction.
        ({"datetime_raw": "2026:05:10 07:00:00"}, "Asia/Kolkata", 3600, "02:30"),
        # Unknown time zone falls back to UTC.
        ({"datetime_raw": "2026:05:10 02:30:00"}, "Not/AZone", 0, "02:30"),
    ],
)
def test_exif_time_to_utc(exif, tz, offset_s, expected):
    assert exif_time_utc(exif, tz, offset_s).strftime("%H:%M") == expected


def test_exif_time_missing_or_broken():
    assert exif_time_utc({}, "UTC", 0) is None
    assert exif_time_utc({"datetime_raw": "0000:00:00 00:00:00"}, "UTC", 0) is None


def test_locate_on_line_and_back():
    dist, frac = locate_on_line(COORDS, 77.18, 32.24 + 5 * 0.0009)
    assert dist == pytest.approx(0, abs=0.5)
    assert frac == pytest.approx(0.5, abs=1e-6)
    # 100 m east of the line, level with the 3rd point.
    dist, frac = locate_on_line(COORDS, 77.18 + 100 / (111_320 * 0.8458), 32.24 + 2 * 0.0009)
    assert dist == pytest.approx(100, rel=0.02)
    assert frac == pytest.approx(0.2, abs=1e-3)
    lon, lat, ele = point_at_fraction(COORDS, 0.5)
    assert (lon, lat, ele) == pytest.approx((77.18, 32.24 + 5 * 0.0009, 3050.0), abs=1e-4)


def test_position_at_time_interpolates_and_respects_slack():
    lon, lat, ele = position_at_time(COORDS, TIMES, T0 + 90)  # between points 1 and 2
    assert lat == pytest.approx(32.24 + 1.5 * 0.0009)
    assert ele == pytest.approx(3015.0)
    assert position_at_time(COORDS, TIMES, T0 - 20 * 60)[1] == COORDS[0][1]  # snaps to start
    assert position_at_time(COORDS, TIMES, T0 - 31 * 60) is None
    assert position_at_time(COORDS, TIMES, TIMES[-1] + 31 * 60) is None
    # Points without a time are skipped.
    gappy = [None, *TIMES[1:]]
    assert position_at_time(COORDS, gappy, T0 + 90)[1] == pytest.approx(32.24 + 1.5 * 0.0009)
    assert position_at_time(COORDS, [None] * 11, T0) is None


def test_place_prefers_plausible_gps_and_records_match_error():
    exif = {
        "datetime_raw": "2026:05:10 08:03:00",
        "gps": {"lat": 32.2427, "lon": 77.18, "ele": None},
    }
    p = place(exif, trip_tz="Asia/Kolkata", camera_offset_s=0, track=TRACK)
    assert p.placement == "exif"
    assert p.route_fraction == pytest.approx(0.3, abs=0.01)
    assert p.lon_lat_ele[2] == pytest.approx(3030, abs=1)  # elevation taken from the route
    assert p.time_match_error_m == pytest.approx(0, abs=2)  # time says point 3 too


def test_place_ignores_far_gps_and_matches_by_time():
    exif = {"datetime_raw": "2026:05:10 08:05:00", "gps": {"lat": 10.0, "lon": 10.0, "ele": None}}
    p = place(exif, trip_tz="Asia/Kolkata", camera_offset_s=0, track=TRACK)
    assert p.placement == "time"
    assert p.route_fraction == pytest.approx(0.5, abs=1e-3)


def test_place_unplaced_without_time_or_track():
    assert place({}, trip_tz="UTC", camera_offset_s=0, track=TRACK).placement == "unplaced"
    late = {"datetime_raw": "2026:05:10 20:00:00"}
    assert place(late, trip_tz="Asia/Kolkata", camera_offset_s=0, track=TRACK).placement == (
        "unplaced"
    )
    gps_only = {"gps": {"lat": 1.0, "lon": 2.0, "ele": 5.0}}
    p = place(gps_only, trip_tz="", camera_offset_s=0, track=None)
    assert (p.placement, p.route_fraction, p.lon_lat_ele) == ("exif", None, (2.0, 1.0, 5.0))
