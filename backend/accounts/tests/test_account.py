"""Account self-service: password reset, email verification, password change and deleting the
account (SPEC F1, ADR-37). Auth flows go through allauth's headless API, as the SPA does."""

import re
from urllib.parse import unquote

import pytest
from allauth.account.models import EmailAddress
from django.core import mail
from django.core.cache import cache

from accounts.models import User
from core import storage
from trips.models import Trip
from trips.tests.gpx_factory import gpx_xml, make_points
from trips.tests.photo_factory import make_jpeg
from trips.tests.test_api import create_trip, upload
from trips.tests.test_photo_api import CommittingClient, add_photo

pytestmark = pytest.mark.django_db

AUTH = "/_allauth/browser/v1/auth"
ACCOUNT = "/_allauth/browser/v1/account"
PASSWORD = "trek-Pass-2026"


@pytest.fixture
def client():
    """A browser-like client signed up through allauth (a real session, not force_auth)."""
    c = CommittingClient()
    body = {"email": "asha@example.com", "username": "asha", "password": PASSWORD}
    assert c.post(f"{AUTH}/signup", body, format="json").status_code == 200
    return c


def key_from_last_email(path: str) -> str:
    match = re.search(rf"{path}/([^\s/]+)", mail.outbox[-1].body)
    assert match, mail.outbox[-1].body
    return unquote(match.group(1))  # the router decodes the path the same way


def login(c, password):
    return c.post(
        f"{AUTH}/login", {"email": "asha@example.com", "password": password}, format="json"
    )


# --- Password reset -------------------------------------------------------------------------


def test_password_reset_from_the_emailed_link(client, settings):
    anon = CommittingClient()
    res = anon.post(f"{AUTH}/password/request", {"email": "asha@example.com"}, format="json")
    assert res.status_code == 200
    # The link points at the site, not at whichever host the API request came through.
    assert f"{settings.FRONTEND_URL}/account/password/reset/" in mail.outbox[-1].body
    assert mail.outbox[-1].subject.startswith("TrailLog: ")
    key = key_from_last_email("/account/password/reset")

    check = anon.get(f"{AUTH}/password/reset", HTTP_X_PASSWORD_RESET_KEY=key)
    assert check.status_code == 200

    new = "new-Trek-Pass-9"
    res = anon.post(f"{AUTH}/password/reset", {"key": key, "password": new}, format="json")
    assert res.status_code in (200, 401)  # 401 = reset done, please log in

    assert login(CommittingClient(), PASSWORD).status_code == 400
    assert login(CommittingClient(), new).status_code == 200
    # The link works once.
    again = anon.post(
        f"{AUTH}/password/reset", {"key": key, "password": "x-Other-77"}, format="json"
    )
    assert again.status_code == 400


def test_password_reset_doesnt_reveal_who_has_an_account(client):
    sent = len(mail.outbox)
    res = CommittingClient().post(
        f"{AUTH}/password/request", {"email": "nobody@example.com"}, format="json"
    )
    assert res.status_code == 200  # same answer as for a real account
    assert all("/account/password/reset/" not in m.body for m in mail.outbox[sent:])


def test_bad_reset_key_is_refused():
    res = CommittingClient().get(f"{AUTH}/password/reset", HTTP_X_PASSWORD_RESET_KEY="nope")
    assert res.status_code == 400


# --- Email verification ---------------------------------------------------------------------


def test_signup_email_link_verifies_the_address(client):
    key = key_from_last_email("/account/verify-email")
    assert not EmailAddress.objects.get(email="asha@example.com").verified
    assert client.get(f"{AUTH}/email/verify", HTTP_X_EMAIL_VERIFICATION_KEY=key).status_code == 200
    assert client.post(f"{AUTH}/email/verify", {"key": key}, format="json").status_code == 200
    assert EmailAddress.objects.get(email="asha@example.com").verified


def test_verification_email_can_be_resent_but_not_spammed(client):
    url = f"{ACCOUNT}/email"
    sent = len(mail.outbox)
    # Signup just sent one, so an immediate resend is refused (allauth's cooldown).
    assert client.put(url, {"email": "asha@example.com"}, format="json").status_code == 403
    cache.clear()  # the cooldown has passed
    assert client.put(url, {"email": "asha@example.com"}, format="json").status_code == 200
    assert len(mail.outbox) == sent + 1


# --- Change password ------------------------------------------------------------------------


def test_change_password_needs_the_current_one(client):
    url = f"{ACCOUNT}/password/change"
    wrong = {"current_password": "wrong-one-123", "new_password": "new-Trek-Pass-9"}
    assert client.post(url, wrong, format="json").status_code == 400
    ok = {"current_password": PASSWORD, "new_password": "new-Trek-Pass-9"}
    assert client.post(url, ok, format="json").status_code == 200
    assert client.get("/api/me").status_code == 200  # still logged in on this device
    assert login(CommittingClient(), "new-Trek-Pass-9").status_code == 200


# --- Display name ---------------------------------------------------------------------------


def test_display_name_is_trimmed_and_limited(client):
    res = client.patch("/api/me", {"display_name": "  Asha S  "}, format="json")
    assert res.status_code == 200 and res.data["display_name"] == "Asha S"
    res = client.patch("/api/me", {"display_name": "x" * 61}, format="json")
    assert res.status_code == 400 and "display_name" in res.data["error"]["fields"]


# --- Delete account -------------------------------------------------------------------------


def test_delete_account_removes_everything(client):
    trip = create_trip(client, "Hampta")
    assert upload(client, trip["id"], gpx_xml([make_points()])).status_code == 202
    photo = add_photo(client, trip["id"], make_jpeg())
    photo.refresh_from_db()
    keys = list(photo.sizes.values()) + [f"gpx/{trip['id']}/track.gpx"]
    assert all(storage.head_size(k) is not None for k in keys)

    res = client.delete("/api/me", {"password": PASSWORD}, format="json")
    assert res.status_code == 204
    assert not User.objects.filter(username="asha").exists()
    assert not Trip.objects.filter(id=trip["id"]).exists()
    assert all(storage.head_size(k) is None for k in keys)
    assert client.get("/api/me").status_code == 403  # logged out
    assert login(CommittingClient(), PASSWORD).status_code == 400


def test_delete_account_needs_the_password(client):
    res = client.delete("/api/me", {"password": "wrong-one-123"}, format="json")
    assert res.status_code == 400
    assert res.data["error"]["fields"]["password"] == ["That password isn't right."]
    assert client.delete("/api/me", {}, format="json").status_code == 400
    assert User.objects.filter(username="asha").exists()


def test_delete_account_is_rate_limited(client):
    codes = [
        client.delete("/api/me", {"password": "wrong-one-123"}, format="json").status_code
        for _ in range(6)
    ]
    assert codes[:5] == [400] * 5 and codes[5] == 429


def test_delete_account_needs_login():
    assert CommittingClient().delete("/api/me", {"password": "x"}, format="json").status_code == 403
