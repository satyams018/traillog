"""API tests for photo upload, processing, placement, visibility and quota (needs PostGIS)."""

from datetime import UTC, datetime

import pytest
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from core import storage
from trips.models import Photo, Trip

from .gpx_factory import gpx_xml, make_points
from .photo_factory import make_jpeg
from .test_api import create_trip, upload

pytestmark = pytest.mark.django_db

# make_points(): 50 points going north from 32.24, one every 10 s from 08:00 IST.
ON_ROUTE = (32.24 + 25 * 0.0009, 77.18)  # halfway


class CommittingClient(APIClient):
    """Runs each request's on_commit work (Celery jobs, file deletes) right after it, as a
    real commit would. Tests run inside one transaction, so on_commit never fires otherwise."""

    def generic(self, *args, **kwargs):
        with TestCase.captureOnCommitCallbacks(execute=True):
            return super().generic(*args, **kwargs)


@pytest.fixture
def user():
    return User.objects.create_user(username="asha", email="asha@example.com", password="pw-12345!")


@pytest.fixture
def client(user):
    c = CommittingClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def trip(client):
    t = create_trip(client)
    assert upload(client, t["id"], gpx_xml([make_points()])).status_code == 202
    return t


def presign(client, trip_id, files):
    return client.post(f"/api/trips/{trip_id}/photos/presign", files, format="json")


def add_photo(client, trip_id, data: bytes, name="IMG_1.jpg"):
    """Presign, 'PUT' the bytes the way the browser would, then complete."""
    res = presign(
        client, trip_id, [{"filename": name, "content_type": "image/jpeg", "bytes": len(data)}]
    )
    assert res.status_code == 201, res.data
    photo_id = res.data[0]["photo_id"]
    storage.put_bytes(f"uploads/{trip_id}/{photo_id}", data)
    done = client.post(f"/api/photos/{photo_id}/complete")
    assert done.status_code == 202, done.data
    return Photo.objects.get(id=photo_id)


def test_presign_reserves_rows_and_signs_urls(client, trip):
    res = presign(
        client,
        trip["id"],
        [
            {"filename": "a.jpg", "content_type": "image/jpeg", "bytes": 4_000_000},
            {"filename": "b.heic", "content_type": "image/heif", "bytes": 2_000_000},
        ],
    )
    assert res.status_code == 201
    assert [r["filename"] for r in res.data] == ["a.jpg", "b.heic"]
    assert res.data[0]["headers"] == {"Content-Type": "image/jpeg"}
    photos = Photo.objects.filter(trip_id=trip["id"]).order_by("order")
    assert [p.status for p in photos] == ["pending", "pending"]
    assert photos[1].content_type == "image/heic"
    assert photos[0].upload_key == f"uploads/{trip['id']}/{photos[0].id}"


@pytest.mark.parametrize(
    "files,field",
    [
        ([{"filename": "a.png", "content_type": "image/png", "bytes": 10}], "content_type"),
        ([{"filename": "a.jpg", "content_type": "image/jpeg", "bytes": 26 * 1024 * 1024}], "bytes"),
        ([{"filename": "a.jpg", "content_type": "image/jpeg", "bytes": 0}], "bytes"),
    ],
)
def test_presign_validates_each_file(client, trip, files, field):
    res = presign(client, trip["id"], files)
    assert res.status_code == 400
    assert field in str(res.data["error"]["fields"])


def test_presign_batch_and_trip_limits(client, trip, settings):
    one = {"filename": "a.jpg", "content_type": "image/jpeg", "bytes": 10}
    assert presign(client, trip["id"], []).status_code == 400
    assert presign(client, trip["id"], [one] * 51).status_code == 400
    settings.PHOTO_MAX_PER_TRIP = 3
    assert presign(client, trip["id"], [one] * 2).status_code == 201
    res = presign(client, trip["id"], [one] * 2)
    assert res.status_code == 400 and res.data["error"]["code"] == "too_many_photos"


def test_presign_refuses_uploads_over_quota(client, trip, user):
    user.storage_quota_bytes = 1_000_000
    user.storage_used_bytes = 900_000
    user.save()
    # 3 MB * 5% = 150 kB estimated -> over the remaining 100 kB.
    res = presign(
        client,
        trip["id"],
        [{"filename": "a.jpg", "content_type": "image/jpeg", "bytes": 3_000_000}],
    )
    assert res.status_code == 409
    assert res.data["error"]["code"] == "quota_exceeded"
    assert not Photo.objects.exists()
    # 1.5 MB fits (75 kB), but then pending uploads count too: a second one doesn't.
    small = [{"filename": "a.jpg", "content_type": "image/jpeg", "bytes": 1_500_000}]
    assert presign(client, trip["id"], small).status_code == 201
    assert presign(client, trip["id"], small).status_code == 409


def test_full_upload_flow_keeps_only_exif_free_copies(client, trip, user):
    photo = add_photo(client, trip["id"], make_jpeg(gps=ON_ROUTE, when="2026:05:10 08:04:10"))
    photo.refresh_from_db()
    user.refresh_from_db()
    assert photo.status == "ready"
    assert photo.placement == "exif"
    assert photo.route_fraction == pytest.approx(25 / 49, abs=0.01)
    assert photo.taken_at == datetime(2026, 5, 10, 2, 34, 10, tzinfo=UTC)
    assert photo.time_match_error_m == pytest.approx(0, abs=5)  # 250 s in -> point 25 too
    # The original is gone; only the two WebP copies remain and count against the quota.
    assert photo.upload_key is None
    assert storage.head_size(f"uploads/{trip['id']}/{photo.id}") is None
    assert set(photo.sizes) == {"thumb", "web"}
    assert storage.get_bytes(photo.sizes["web"])[8:12] == b"WEBP"
    assert user.storage_used_bytes == photo.stored_bytes > 0

    listed = client.get(f"/api/trips/{trip['id']}/photos").data
    assert len(listed) == 1
    assert listed[0]["web_url"].endswith(photo.sizes["web"])
    assert "exif" not in listed[0]
    assert listed[0]["location"][:2] == pytest.approx([77.18, ON_ROUTE[0]])
    assert client.get(f"/api/trips/{trip['id']}").data["photo_count"] == 1


def test_complete_is_idempotent(client, trip, user):
    photo = add_photo(client, trip["id"], make_jpeg())
    used = User.objects.get(id=user.id).storage_used_bytes
    again = client.post(f"/api/photos/{photo.id}/complete")
    assert again.status_code == 200
    assert User.objects.get(id=user.id).storage_used_bytes == used


def test_invalid_file_fails_and_is_deleted(client, trip):
    photo = add_photo(client, trip["id"], b"\x89PNG\r\n\x1a\n" + b"\x00" * 64, name="x.jpg")
    photo.refresh_from_db()
    assert photo.status == "failed"
    assert "JPEG and HEIC" in photo.error
    assert storage.head_size(f"uploads/{trip['id']}/{photo.id}") is None


def test_missing_upload_fails(client, trip):
    res = presign(
        client, trip["id"], [{"filename": "a.jpg", "content_type": "image/jpeg", "bytes": 10}]
    )
    photo_id = res.data[0]["photo_id"]
    client.post(f"/api/photos/{photo_id}/complete")
    assert Photo.objects.get(id=photo_id).status == "failed"


def test_photo_without_gps_is_time_matched_and_offset_rematches(client, trip):
    # 08:04:10 IST = 250 s after the track starts -> point 25 of 50.
    timed = add_photo(client, trip["id"], make_jpeg(when="2026:05:10 08:04:10"))
    timed.refresh_from_db()
    assert timed.placement == "time"
    assert timed.location.y == pytest.approx(ON_ROUTE[0], abs=1e-5)

    # Camera clock was 2 min slow: +120 s moves the photo 12 points further north.
    res = client.patch(f"/api/trips/{trip['id']}", {"camera_offset_s": 120}, format="json")
    assert res.status_code == 200
    timed.refresh_from_db()
    assert timed.location.y == pytest.approx(32.24 + 37 * 0.0009, abs=1e-5)

    # Far outside the track's time range -> unplaced.
    client.patch(f"/api/trips/{trip['id']}", {"camera_offset_s": 6 * 3600}, format="json")
    timed.refresh_from_db()
    assert (timed.placement, timed.location) == ("unplaced", None)


def test_photos_before_gpx_are_matched_when_track_arrives(client):
    t = create_trip(client, "Photos first")
    photo = add_photo(client, t["id"], make_jpeg(when="2026:05:10 08:04:10"))
    photo.refresh_from_db()
    assert photo.placement == "unplaced"  # no track (and no time zone) yet
    upload(client, t["id"], gpx_xml([make_points()]))
    photo.refresh_from_db()
    assert photo.placement == "time"
    assert photo.route_fraction == pytest.approx(25 / 49, abs=0.01)


def test_manual_placement_survives_rematching(client, trip):
    photo = add_photo(client, trip["id"], make_jpeg(when=None))
    res = client.patch(f"/api/photos/{photo.id}", {"route_fraction": 0.25}, format="json")
    assert res.status_code == 200
    assert res.data["placement"] == "manual"
    assert res.data["location"][1] == pytest.approx(32.24 + 0.25 * 49 * 0.0009, abs=1e-4)

    res = client.patch(f"/api/photos/{photo.id}", {"location": [77.181, 32.25]}, format="json")
    assert res.data["placement"] == "manual"
    assert res.data["route_fraction"] == pytest.approx(0.01 / (49 * 0.0009), abs=0.01)

    client.patch(f"/api/trips/{trip['id']}", {"camera_offset_s": 60}, format="json")
    photo.refresh_from_db()
    assert photo.placement == "manual"
    assert photo.location.x == pytest.approx(77.181)

    res = client.patch(f"/api/photos/{photo.id}", {"location": None}, format="json")
    assert res.data["placement"] == "unplaced"


def test_patch_validation(client, trip):
    photo = add_photo(client, trip["id"], make_jpeg())
    assert (
        client.patch(f"/api/photos/{photo.id}", {"location": [200, 0]}, format="json").status_code
        == 400
    )
    assert (
        client.patch(f"/api/photos/{photo.id}", {"route_fraction": 1.5}, format="json").status_code
        == 400
    )
    res = client.patch(
        f"/api/photos/{photo.id}", {"caption": "Camp 2", "is_public": False}, format="json"
    )
    assert (res.data["caption"], res.data["is_public"]) == ("Camp 2", False)


def test_bulk_show_hide(client, trip):
    a = add_photo(client, trip["id"], make_jpeg(), "a.jpg")
    b = add_photo(client, trip["id"], make_jpeg(), "b.jpg")
    url = f"/api/trips/{trip['id']}/photos/bulk"
    res = client.post(url, {"photo_ids": "all", "is_public": False}, format="json")
    assert res.data == {"updated": 2}
    assert not Photo.objects.filter(is_public=True).exists()
    res = client.post(url, {"photo_ids": [str(a.id)], "is_public": True}, format="json")
    assert res.data == {"updated": 1}
    assert set(Photo.objects.filter(is_public=True).values_list("id", flat=True)) == {a.id}
    assert (
        client.post(url, {"photo_ids": "some", "is_public": True}, format="json").status_code == 400
    )
    assert b.id


def test_delete_photo_frees_quota_and_files(client, trip, user):
    photo = add_photo(client, trip["id"], make_jpeg())
    photo.refresh_from_db()
    assert client.delete(f"/api/photos/{photo.id}").status_code == 204
    user.refresh_from_db()
    assert user.storage_used_bytes == 0
    assert all(storage.head_size(k) is None for k in photo.sizes.values())


def test_delete_trip_frees_quota_and_files(client, trip, user):
    photo = add_photo(client, trip["id"], make_jpeg())
    photo.refresh_from_db()
    assert client.delete(f"/api/trips/{trip['id']}").status_code == 204
    user.refresh_from_db()
    assert user.storage_used_bytes == 0
    assert storage.head_size(photo.sizes["thumb"]) is None
    assert storage.head_size(f"gpx/{trip['id']}/track.gpx") is None


def test_other_users_photos_are_404(client, trip):
    photo = add_photo(client, trip["id"], make_jpeg())
    eve = CommittingClient()
    eve.force_authenticate(User.objects.create_user(username="eve", email="e@x.com", password="x"))
    assert eve.patch(f"/api/photos/{photo.id}", {"caption": "x"}, format="json").status_code == 404
    assert eve.delete(f"/api/photos/{photo.id}").status_code == 404
    assert eve.post(f"/api/photos/{photo.id}/complete").status_code == 404
    assert eve.get(f"/api/trips/{trip['id']}/photos").status_code == 404
    one = [{"filename": "a.jpg", "content_type": "image/jpeg", "bytes": 10}]
    assert presign(eve, trip["id"], one).status_code == 404
    assert (
        eve.post(
            f"/api/trips/{trip['id']}/photos/bulk",
            {"photo_ids": "all", "is_public": False},
            format="json",
        ).status_code
        == 404
    )
    assert Trip.objects.filter(id=trip["id"]).exists()


def test_trip_cover_is_first_visible_photo(client, trip):
    assert client.get(f"/api/trips/{trip['id']}").data["cover_url"] is None
    a = add_photo(client, trip["id"], make_jpeg(), "a.jpg")
    b = add_photo(client, trip["id"], make_jpeg(), "b.jpg")
    a.refresh_from_db()
    b.refresh_from_db()
    listed = client.get("/api/trips").data["results"][0]["cover_url"]
    assert listed == storage.presign_get(a.sizes["web"])
    # A hidden photo only becomes the cover when nothing visible is left.
    client.patch(f"/api/photos/{a.id}", {"is_public": False}, format="json")
    assert client.get(f"/api/trips/{trip['id']}").data["cover_url"] == storage.presign_get(
        b.sizes["web"]
    )
