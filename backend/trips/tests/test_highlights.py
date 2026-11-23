"""API tests for story highlights: create, photo membership, route order, reorder, delete."""

import pytest

from accounts.models import User
from trips.models import Highlight, Photo

from .gpx_factory import gpx_xml, make_points
from .photo_factory import make_jpeg
from .test_api import create_trip, upload
from .test_photo_api import CommittingClient, add_photo

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    user = User.objects.create_user(username="asha", email="asha@example.com", password="pw-1234!")
    c = CommittingClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def trip(client):
    t = create_trip(client)
    assert upload(client, t["id"], gpx_xml([make_points()])).status_code == 202
    return t


# make_points() runs north from 32.24 in steps of 0.0009° over 49 steps.
LAT0, STEP, LON = 32.24, 0.0009, 77.18


def at(fraction: float) -> tuple[float, float]:
    """A GPS position at a share of the synthetic route."""
    return (LAT0 + fraction * 49 * STEP, LON)


def photo_at(client, trip_id, fraction, name):
    return add_photo(client, trip_id, make_jpeg(gps=at(fraction)), name)


def url(trip_id, suffix=""):
    return f"/api/trips/{trip_id}/highlights{suffix}"


def test_create_highlight_with_photos(client, trip):
    a = photo_at(client, trip["id"], 0.2, "a.jpg")
    b = photo_at(client, trip["id"], 0.4, "b.jpg")
    res = client.post(
        url(trip["id"]),
        {
            "kind": "camp",
            "label": " Base camp ",
            "body": "Tents up by 4.",
            "photo_ids": [str(b.id), str(a.id)],
        },
        format="json",
    )
    assert res.status_code == 201, res.data
    assert res.data["label"] == "Base camp"
    # Photos come back in route order, and the stop sits in the middle of them.
    assert res.data["photo_ids"] == [str(a.id), str(b.id)]
    assert res.data["route_fraction"] == pytest.approx(0.3, abs=0.02)
    photos = client.get(f"/api/trips/{trip['id']}/photos").data
    assert {str(p["highlight"]) for p in photos} == {res.data["id"]}


def test_new_stops_slot_into_route_order(client, trip):
    early = photo_at(client, trip["id"], 0.1, "early.jpg")
    mid = photo_at(client, trip["id"], 0.5, "mid.jpg")
    late = photo_at(client, trip["id"], 0.9, "late.jpg")
    for label, p in (("Pass", late), ("Start", early), ("Lake", mid)):
        client.post(url(trip["id"]), {"label": label, "photo_ids": [str(p.id)]}, format="json")
    client.post(url(trip["id"]), {"label": "Thoughts"}, format="json")  # no photos: at the end
    labels = [h["label"] for h in client.get(url(trip["id"])).data]
    assert labels == ["Start", "Lake", "Pass", "Thoughts"]


def test_photo_moves_between_stops_and_survives_delete(client, trip):
    p = photo_at(client, trip["id"], 0.5, "p.jpg")
    one = client.post(url(trip["id"]), {"label": "One", "photo_ids": [str(p.id)]}, format="json")
    two = client.post(url(trip["id"]), {"label": "Two"}, format="json")
    res = client.patch(
        f"/api/highlights/{two.data['id']}", {"photo_ids": [str(p.id)]}, format="json"
    )
    assert res.data["photo_ids"] == [str(p.id)]
    listed = {h["label"]: h["photo_ids"] for h in client.get(url(trip["id"])).data}
    assert listed == {"One": [], "Two": [str(p.id)]}

    assert client.delete(f"/api/highlights/{two.data['id']}").status_code == 204
    p.refresh_from_db()
    assert p.highlight is None and Photo.objects.filter(id=p.id).exists()
    assert Highlight.objects.filter(id=one.data["id"]).exists()


def test_reorder(client, trip):
    ids = [
        client.post(url(trip["id"]), {"label": name}, format="json").data["id"]
        for name in ("A", "B", "C")
    ]
    res = client.post(url(trip["id"], "/order"), {"ids": ids[::-1]}, format="json")
    assert [h["label"] for h in res.data] == ["C", "B", "A"]
    bad = client.post(url(trip["id"], "/order"), {"ids": ids[:2]}, format="json")
    assert bad.status_code == 400


def test_validation(client, trip):
    assert client.post(url(trip["id"]), {"body": "no title"}, format="json").status_code == 400
    assert client.post(url(trip["id"]), {"label": "   "}, format="json").status_code == 400
    res = client.post(
        url(trip["id"]),
        {"label": "X", "photo_ids": ["00000000-0000-0000-0000-000000000000"]},
        format="json",
    )
    assert res.status_code == 400
    assert "photo_ids" in res.data["error"]["fields"]


def test_other_users_highlights_are_404(client, trip):
    h = client.post(url(trip["id"]), {"label": "Mine"}, format="json").data
    other = User.objects.create_user(username="other", email="o@example.com", password="x" * 12)
    client.force_authenticate(other)
    assert client.get(url(trip["id"])).status_code == 404
    assert (
        client.patch(f"/api/highlights/{h['id']}", {"label": "x"}, format="json").status_code == 404
    )
    assert client.delete(f"/api/highlights/{h['id']}").status_code == 404
