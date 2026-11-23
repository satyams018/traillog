"""API tests for trips (needs PostGIS)."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import User
from core import storage
from trips.models import Trip

from .gpx_factory import gpx_xml, make_points

pytestmark = pytest.mark.django_db


@pytest.fixture
def user():
    return User.objects.create_user(username="asha", email="asha@example.com", password="pw-12345!")


@pytest.fixture
def other():
    return User.objects.create_user(username="ravi", email="ravi@example.com", password="pw-12345!")


@pytest.fixture
def client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def create_trip(client, title="Hampta Pass"):
    res = client.post("/api/trips", {"title": title}, format="json")
    assert res.status_code == 201, res.data
    return res.data


def upload(client, trip_id, data, name="track.gpx"):
    f = SimpleUploadedFile(name, data, content_type="application/gpx+xml")
    return client.post(f"/api/trips/{trip_id}/gpx", {"file": f}, format="multipart")


def test_requires_login():
    res = APIClient().get("/api/trips")
    assert res.status_code == 403
    assert res.data["error"]["code"] == "not_authenticated"


def test_create_trip_defaults_and_unique_slug(client):
    first = create_trip(client)
    second = create_trip(client)
    assert first["slug"] == "hampta-pass"
    assert second["slug"] == "hampta-pass-2"
    assert first["visibility"] == "private"
    assert first["status"] == "draft"
    assert len(first["share_token"]) == 22


def test_blank_title_rejected(client):
    res = client.post("/api/trips", {"title": "   "}, format="json")
    assert res.status_code == 400
    assert "title" in res.data["error"]["fields"]


def test_list_only_shows_own_trips(client, other):
    create_trip(client)
    Trip.objects.create(owner=other, title="Not mine", slug="not-mine")
    res = client.get("/api/trips")
    assert [t["title"] for t in res.data["results"]] == ["Hampta Pass"]


def test_other_users_trip_is_404(other):
    trip = Trip.objects.create(owner=other, title="Secret", slug="secret")
    c = APIClient()
    c.force_authenticate(User.objects.create_user(username="eve", email="e@x.com", password="x"))
    assert c.get(f"/api/trips/{trip.id}").status_code == 404
    assert c.patch(f"/api/trips/{trip.id}", {"title": "pwn"}, format="json").status_code == 404
    assert c.delete(f"/api/trips/{trip.id}").status_code == 404


def test_patch_validates_fields(client):
    trip = create_trip(client)
    ok = client.patch(f"/api/trips/{trip['id']}", {"visibility": "link"}, format="json")
    assert ok.status_code == 200 and ok.data["visibility"] == "link"
    bad = client.patch(f"/api/trips/{trip['id']}", {"privacy_zone_m": 5000}, format="json")
    assert bad.status_code == 400
    read_only = client.patch(f"/api/trips/{trip['id']}", {"slug": "x"}, format="json")
    assert read_only.data["slug"] == "hampta-pass"


@pytest.mark.parametrize(
    "name, data, message",
    [
        ("track.txt", gpx_xml([make_points(5)]), ".gpx extension"),
        ("track.gpx", b"hello world", "doesn't look like a GPX"),
    ],
)
def test_gpx_upload_validation(client, name, data, message):
    trip = create_trip(client)
    res = upload(client, trip["id"], data, name=name)
    assert res.status_code == 400
    assert message in res.data["error"]["fields"]["file"][0]


def test_gpx_upload_missing_file(client):
    trip = create_trip(client)
    res = client.post(f"/api/trips/{trip['id']}/gpx", {}, format="multipart")
    assert res.status_code == 400


def test_gpx_upload_processes_track(client, django_capture_on_commit_callbacks):
    trip = create_trip(client)
    pts = make_points(300, dele=2.0)
    with django_capture_on_commit_callbacks(execute=True):
        res = upload(client, trip["id"], gpx_xml([pts]))
    assert res.status_code == 202
    assert res.data["status"] == "processing"

    detail = client.get(f"/api/trips/{trip['id']}").data
    assert detail["status"] == "ready", detail["error"]
    stats = detail["stats"]
    assert stats["points_raw"] == 300
    # A perfectly straight line simplifies to its two end points.
    assert stats["points_simplified"] == 2
    assert stats["distance_m"] == pytest.approx(299 * 100.07, rel=0.01)
    assert detail["timezone"] == "Asia/Kolkata"
    assert detail["start_date"] == "2026-05-10"
    assert detail["has_track"] is True

    track = client.get(f"/api/trips/{trip['id']}/track").data
    assert track["geometry"]["type"] == "LineString"
    assert len(track["geometry"]["coordinates"][0]) == 3  # lng, lat, ele
    assert len(track["profile"]) == 300
    assert track["bbox"][1] == pytest.approx(32.24)


def test_simplify_keeps_corners(client, django_capture_on_commit_callbacks):
    trip = create_trip(client)
    north = make_points(50)
    lat_end = north[-1][0]
    east = [(lat_end, 77.18 + i * 0.001, 3000.0, None) for i in range(1, 50)]
    with django_capture_on_commit_callbacks(execute=True):
        upload(client, trip["id"], gpx_xml([north + east]))
    stats = client.get(f"/api/trips/{trip['id']}").data["stats"]
    assert stats["points_simplified"] == 3  # start, corner, end


def test_invalid_gpx_marks_trip_failed(client, django_capture_on_commit_callbacks):
    trip = create_trip(client)
    with django_capture_on_commit_callbacks(execute=True):
        upload(client, trip["id"], gpx_xml([make_points(1)]))
    detail = client.get(f"/api/trips/{trip['id']}").data
    assert detail["status"] == "failed"
    assert "at least two" in detail["error"]
    assert client.get(f"/api/trips/{trip['id']}/track").status_code == 404


def test_reupload_blocked_while_processing(client):
    trip = create_trip(client)
    Trip.objects.filter(id=trip["id"]).update(status="processing")
    res = upload(client, trip["id"], gpx_xml([make_points(5)]))
    assert res.status_code == 409


def test_delete_trip_removes_gpx(client, django_capture_on_commit_callbacks):
    trip = create_trip(client)
    with django_capture_on_commit_callbacks(execute=True):
        upload(client, trip["id"], gpx_xml([make_points(5)]))
    key = f"gpx/{trip['id']}/track.gpx"
    assert storage.get_bytes(key)
    with django_capture_on_commit_callbacks(execute=True):
        assert client.delete(f"/api/trips/{trip['id']}").status_code == 204
    with pytest.raises(KeyError):
        storage.get_bytes(key)


def test_storage_outage_returns_503(client, monkeypatch):
    from botocore.exceptions import EndpointConnectionError

    def broken(*args, **kwargs):
        raise EndpointConnectionError(endpoint_url="http://s3")

    monkeypatch.setattr(storage, "put_bytes", broken)
    trip = create_trip(client)
    res = upload(client, trip["id"], gpx_xml([make_points(5)]))
    assert res.status_code == 503
    assert res.data["error"]["code"] == "storage_unavailable"
    assert Trip.objects.get(id=trip["id"]).status == "draft"  # nothing half-saved


def test_editing_trip_does_not_change_track_version(client, django_capture_on_commit_callbacks):
    trip = create_trip(client)
    assert client.get(f"/api/trips/{trip['id']}").data["track_updated_at"] is None
    with django_capture_on_commit_callbacks(execute=True):
        upload(client, trip["id"], gpx_xml([make_points(5)]))
    before = client.get(f"/api/trips/{trip['id']}").data
    after = client.patch(f"/api/trips/{trip['id']}", {"visibility": "public"}, format="json").data
    assert before["track_updated_at"] is not None
    assert after["track_updated_at"] == before["track_updated_at"]
    assert after["updated_at"] != before["updated_at"]


def test_list_includes_small_route_preview(client, django_capture_on_commit_callbacks):
    trip = create_trip(client)
    north = make_points(200)
    lat_end = north[-1][0]
    east = [(lat_end, 77.18 + i * 0.001, 3000.0, None) for i in range(1, 200)]
    with django_capture_on_commit_callbacks(execute=True):
        upload(client, trip["id"], gpx_xml([north + east]))
    listed = client.get("/api/trips").data["results"][0]
    preview = listed["preview"]
    assert 2 <= len(preview) <= 64
    assert preview[0] == [77.18, 32.24]  # starts at the start, [lng, lat]
    assert len(preview[0]) == 2


def test_build_preview_caps_points():
    from trips.tasks import build_preview

    coords = [(77.0 + i * 1e-4, 32.0, 3000.0) for i in range(1000)]
    out = build_preview(coords, max_points=64)
    assert len(out) == 64
    assert out[0] == [77.0, 32.0] and out[-1] == [round(77.0 + 999e-4, 5), 32.0]


def test_trip_has_small_elevation_preview(client, django_capture_on_commit_callbacks):
    trip = create_trip(client)
    with django_capture_on_commit_callbacks(execute=True):
        upload(client, trip["id"], gpx_xml([make_points(n=120, dele=5.0)]))
    data = client.get(f"/api/trips/{trip['id']}").data
    eles = data["elevation_preview"]
    assert len(eles) == 48
    assert eles == sorted(eles)  # the synthetic track climbs steadily
    assert client.get("/api/trips").data["results"][0]["elevation_preview"] == eles
