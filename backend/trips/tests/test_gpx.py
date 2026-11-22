"""Unit tests for the pure GPX maths (no database)."""

import random

import pytest

from trips.gpx import (
    GpxError,
    analyse,
    build_profile,
    fill_missing,
    gain_loss_hysteresis,
    gain_loss_raw,
    haversine_m,
    median_filter,
    parse_gpx,
)

from .gpx_factory import gpx_xml, make_points


def test_haversine_one_degree_latitude():
    assert haversine_m(0, 0, 1, 0) == pytest.approx(111_195, rel=1e-3)


def test_haversine_zero():
    assert haversine_m(32.2, 77.1, 32.2, 77.1) == 0


def test_parse_track_points_and_waypoints():
    parsed = parse_gpx(gpx_xml([make_points(10)], waypoints=[("Camp", 32.25, 77.18)]))
    assert len(parsed.points) == 10
    assert parsed.segment_breaks == []
    assert parsed.waypoints[0]["name"] == "Camp"


def test_route_fallback_when_no_track():
    parsed = parse_gpx(gpx_xml([make_points(5)], as_route=True))
    assert len(parsed.points) == 5


@pytest.mark.parametrize(
    "data, message",
    [
        (b"not xml at all", "valid GPX"),
        (gpx_xml([make_points(1)]), "at least two"),
        (gpx_xml([[(95.0, 77.0, 1.0, None), (32.0, 77.0, 1.0, None)]]), "outside the valid range"),
    ],
)
def test_parse_rejects_bad_files(data, message):
    with pytest.raises(GpxError, match=message):
        parse_gpx(data)


def test_parse_enforces_point_limit():
    with pytest.raises(GpxError, match="more than"):
        parse_gpx(gpx_xml([make_points(20)]), max_points=10)


def test_distance_ignores_gap_between_segments():
    seg1 = make_points(11)  # 10 steps * ~100 m
    seg2 = make_points(11, lat0=40.0)  # far away; jump must not count
    stats = analyse(parse_gpx(gpx_xml([seg1, seg2]))).stats
    assert stats["segments"] == 2
    assert stats["distance_m"] == pytest.approx(2 * 10 * 100.07, rel=0.01)


def test_fill_missing_interpolates_and_extends():
    assert fill_missing([None, 10.0, None, 30.0, None]) == [10.0, 10.0, 20.0, 30.0, 30.0]
    assert fill_missing([None, None]) is None


def test_median_filter_removes_spike():
    assert median_filter([10, 10, 500, 10, 10]) == [10, 10, 10, 10, 10]


def test_hysteresis_ignores_noise_on_flat_ground():
    rng = random.Random(1)
    noisy = [3000 + rng.uniform(-2, 2) for _ in range(500)]
    gain, loss = gain_loss_hysteresis(noisy)
    raw_gain, _ = gain_loss_raw(noisy)
    assert gain == 0 and loss == 0
    assert raw_gain > 300  # why raw sums overstate gain (ADR-8)


def test_hysteresis_keeps_real_climb():
    rng = random.Random(2)
    climb = [3000 + i + rng.uniform(-2, 2) for i in range(0, 1000, 2)]  # +~1000 m
    gain, _ = gain_loss_hysteresis(median_filter(climb))
    assert gain == pytest.approx(1000, abs=30)


def test_stats_for_steady_climb():
    pts = make_points(101, dele=5.0, dt_s=60)  # 100 steps of ~100 m, +5 m each, 1 min apart
    stats = analyse(parse_gpx(gpx_xml([pts]))).stats
    assert stats["distance_m"] == pytest.approx(10_007, rel=0.01)
    assert stats["gain_m"] == pytest.approx(500, abs=10)
    assert stats["loss_m"] == 0
    assert stats["max_ele_m"] == 3500
    assert stats["total_s"] == 6000
    assert stats["moving_s"] == 6000
    assert stats["pace_s_per_km"] == pytest.approx(600, abs=5)  # 10 min/km


def test_moving_time_excludes_a_long_stop():
    pts = make_points(11, dt_s=60)
    last_lat, lon, ele, t = pts[-1]
    from datetime import timedelta

    # Stand still for 10 minutes (one point per minute at the same place).
    stop = [(last_lat, lon, ele, t + timedelta(minutes=m)) for m in range(1, 11)]
    stats = analyse(parse_gpx(gpx_xml([pts + stop]))).stats
    assert stats["total_s"] == 1200
    assert stats["moving_s"] == 600


def test_track_without_elevation_or_time():
    pts = [(lat, lon, None, None) for lat, lon, _, _ in make_points(5)]
    stats = analyse(parse_gpx(gpx_xml([pts]))).stats
    assert stats["has_elevation"] is False
    assert stats["gain_m"] is None
    assert stats["has_time"] is False
    assert stats["moving_s"] is None


def test_profile_is_downsampled_and_keeps_last_point():
    parsed = parse_gpx(gpx_xml([make_points(5001)]))
    analysis = analyse(parsed)
    profile = build_profile(parsed, analysis, max_samples=2000)
    assert len(profile) <= 2000
    assert profile[0][0] == 0
    assert profile[-1][0] == pytest.approx(analysis.stats["distance_m"], abs=0.1)
    dist, ele, t, lng, lat = profile[-1]
    assert (lng, lat) == (77.18, round(32.24 + 5000 * 0.0009, 6))
