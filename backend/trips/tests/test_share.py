"""Share pages: privacy trimming, visibility/404 rules, the public payload, meta tags and the
preview image (SPEC F10, F11, §8)."""

import io

import pytest
from PIL import Image
from rest_framework.test import APIClient

from accounts.models import User
from core import storage
from trips.gpx import haversine_m
from trips.models import Trip
from trips.public import Window, trim_line

from .gpx_factory import gpx_xml, make_points
from .photo_factory import make_jpeg
from .test_api import create_trip, upload
from .test_photo_api import CommittingClient, add_photo

pytestmark = pytest.mark.django_db

# make_points(): 50 points going north from 32.24 in ~100 m steps, so the route is ~4.9 km.
LAT0, STEP, LON = 32.24, 0.0009, 77.18


@pytest.fixture
def owner():
    return User.objects.create_user(username="asha", email="asha@example.com", password="pw-1234!")


@pytest.fixture
def client(owner):
    c = CommittingClient()
    c.force_authenticate(owner)
    return c


@pytest.fixture
def anon():
    return APIClient()


@pytest.fixture
def trip(client):
    t = create_trip(client, "Hampta <Pass>")
    assert upload(client, t["id"], gpx_xml([make_points()])).status_code == 202
    return t


def share_api(trip, k=None):
    return f"/api/public/u/asha/{trip['slug']}" + (f"?k={k}" if k else "")


def set_visibility(client, trip, visibility):
    res = client.patch(f"/api/trips/{trip['id']}", {"visibility": visibility}, format="json")
    assert res.status_code == 200
    return res.data


# --- Trimming -----------------------------------------------------------------------------


def test_trim_line_cuts_the_zone_off_both_ends():
    coords = [(LON, LAT0 + i * STEP, 0.0) for i in range(50)]
    trimmed, window = trim_line(coords, 300)
    start_gap = haversine_m(coords[0][1], coords[0][0], trimmed[0][1], trimmed[0][0])
    end_gap = haversine_m(coords[-1][1], coords[-1][0], trimmed[-1][1], trimmed[-1][0])
    assert start_gap == pytest.approx(300, abs=1)
    assert end_gap == pytest.approx(300, abs=1)
    assert 0.05 < window.start < 0.07 and 0.93 < window.end < 0.95


def test_trim_line_edge_cases():
    coords = [(LON, LAT0 + i * STEP, 0.0) for i in range(5)]  # ~400 m
    assert trim_line(coords, 0)[1] == Window(0.0, 1.0)
    assert trim_line(coords, 300) is None  # shorter than both zones: show no route
    assert trim_line(coords[:1], 0) is None


def test_window_rescales_and_hides_zone_positions():
    w = Window(0.1, 0.9)
    assert w.to_public(0.5) == 0.5
    assert w.to_public(0.1) == 0.0 and w.to_public(0.9) == 1.0
    assert w.to_public(0.05) is None and w.to_public(0.95) is None and w.to_public(None) is None


# --- Visibility / 404 rules -----------------------------------------------------------------


def test_private_trip_is_404_except_for_its_owner(client, anon, trip):
    assert anon.get(share_api(trip)).status_code == 404
    assert anon.get(f"/u/asha/{trip['slug']}").status_code == 404
    assert anon.get("/api/public/u/asha/no-such-trip").status_code == 404
    assert client.get(share_api(trip)).status_code == 200  # owner preview
    stranger = User.objects.create_user(username="ravi", email="r@example.com", password="x" * 12)
    other = APIClient()
    other.force_authenticate(stranger)
    assert other.get(share_api(trip)).status_code == 404


def test_link_trip_needs_the_current_token(client, anon, trip):
    data = set_visibility(client, trip, "link")
    token = data["share_token"]
    assert anon.get(share_api(trip)).status_code == 404
    assert anon.get(share_api(trip, "wrong-token")).status_code == 404
    res = anon.get(share_api(trip, token))
    assert res.status_code == 200 and res["X-Robots-Tag"] == "noindex"

    rotated = client.post(f"/api/trips/{trip['id']}/share-token/rotate").data["share_token"]
    assert rotated != token
    assert anon.get(share_api(trip, token)).status_code == 404  # old links stop working
    assert anon.get(share_api(trip, rotated)).status_code == 200


def test_public_trip_opens_without_a_token(client, anon, trip):
    set_visibility(client, trip, "public")
    res = anon.get(share_api(trip))
    assert res.status_code == 200 and "X-Robots-Tag" not in res


# --- Payload ------------------------------------------------------------------------------


def test_payload_is_trimmed_and_leaks_nothing_private(client, anon, trip):
    near_start = add_photo(client, trip["id"], make_jpeg(gps=(LAT0 + STEP, LON)), "start.jpg")
    middle = add_photo(client, trip["id"], make_jpeg(gps=(LAT0 + 25 * STEP, LON)), "mid.jpg")
    hidden = add_photo(client, trip["id"], make_jpeg(gps=(LAT0 + 30 * STEP, LON)), "hid.jpg")
    client.patch(f"/api/photos/{hidden.id}", {"is_public": False}, format="json")
    client.post(
        f"/api/trips/{trip['id']}/highlights",
        {"label": "Camp", "photo_ids": [str(middle.id), str(hidden.id)]},
        format="json",
    )
    set_visibility(client, trip, "public")

    data = anon.get(share_api(trip)).json()
    body = str(data)
    assert "asha@example.com" not in body and "exif" not in body and "points_raw" not in body

    photos = {p["id"]: p for p in data["photos"]}
    assert str(hidden.id) not in photos  # hidden from the share page
    assert photos[str(near_start.id)]["location"] is None  # inside the privacy zone
    assert photos[str(near_start.id)]["route_fraction"] is None
    assert photos[str(middle.id)]["route_fraction"] == pytest.approx(0.5, abs=0.03)
    assert (
        photos[str(middle.id)]["taken_at"].endswith(":00Z")
        or ":00+" in photos[str(middle.id)]["taken_at"]
    )

    profile = data["track"]["profile"]
    assert profile[0][0] == pytest.approx(0, abs=110)  # restarts near 0 km
    assert all(row[2] is None for row in profile)  # no timestamps
    first = data["track"]["geometry"]["coordinates"][0]
    assert haversine_m(LAT0, LON, first[1], first[0]) == pytest.approx(300, abs=5)

    (stop,) = data["highlights"]
    assert stop["photo_ids"] == [str(middle.id)]  # the hidden photo is left out


def test_changing_the_privacy_zone_rebuilds_the_public_route(client, anon, trip):
    set_visibility(client, trip, "public")
    res = client.patch(f"/api/trips/{trip['id']}", {"privacy_zone_m": 0}, format="json")
    assert res.status_code == 200
    first = anon.get(share_api(trip)).json()["track"]["geometry"]["coordinates"][0]
    assert haversine_m(LAT0, LON, first[1], first[0]) < 1
    client.patch(f"/api/trips/{trip['id']}", {"privacy_zone_m": 2000}, format="json")
    first = anon.get(share_api(trip)).json()["track"]["geometry"]["coordinates"][0]
    assert haversine_m(LAT0, LON, first[1], first[0]) == pytest.approx(2000, abs=5)
    bad = client.patch(f"/api/trips/{trip['id']}", {"privacy_zone_m": 5000}, format="json")
    assert bad.status_code == 400


# --- Share page HTML and preview image --------------------------------------------------------


def test_share_page_has_escaped_preview_tags(client, anon, trip, settings, tmp_path):
    shell = tmp_path / "index.html"
    shell.write_text(
        '<html><head><title>TrailLog</title><meta name="description" content="App" />'
        "</head><body></body></html>"
    )
    settings.FRONTEND_INDEX = shell
    set_visibility(client, trip, "public")
    html = anon.get(f"/u/asha/{trip['slug']}").content.decode()
    assert '<meta property="og:title" content="Hampta &lt;Pass&gt;" />' in html
    assert 'property="og:image" content="http://testserver/og/' in html
    assert "summary_large_image" in html and "noindex" not in html
    assert "<title>Hampta &lt;Pass&gt; · TrailLog</title>" in html
    assert html.count('name="description"') == 1 and 'content="App"' not in html

    token = set_visibility(client, trip, "link")["share_token"]
    html = anon.get(f"/u/asha/{trip['slug']}?k={token}").content.decode()
    assert 'name="robots" content="noindex"' in html and f"k={token}" in html


def test_preview_image_is_rendered_once_and_respects_visibility(client, anon, trip):
    add_photo(client, trip["id"], make_jpeg(gps=(LAT0 + 25 * STEP, LON)), "cover.jpg")
    url = f"/og/{trip['id']}.png"
    assert anon.get(url).status_code == 404  # private
    set_visibility(client, trip, "public")
    res = anon.get(url)
    assert res.status_code == 302 and res["Location"].startswith("memory://get/og/")
    key = res["Location"].removeprefix("memory://get/")
    img = Image.open(io.BytesIO(storage.get_bytes(key)))
    assert img.size == (1200, 630)
    assert anon.get(url)["Location"] == res["Location"]  # cached, same file

    Trip.objects.filter(id=trip["id"]).update(title="Renamed")
    assert anon.get(url)["Location"] != res["Location"]  # a new image for the new title
