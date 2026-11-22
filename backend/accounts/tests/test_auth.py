import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db

SIGNUP = "/_allauth/browser/v1/auth/signup"
LOGIN = "/_allauth/browser/v1/auth/login"


def signup(client, **overrides):
    body = {"email": "asha@example.com", "username": "asha", "password": "trek-Pass-2026"}
    body.update(overrides)
    return client.post(SIGNUP, body, format="json")


def test_signup_logs_in_and_me_works():
    c = APIClient()
    res = signup(c)
    assert res.status_code == 200, res.json()
    me = c.get("/api/me")
    assert me.status_code == 200
    assert me.data["username"] == "asha"
    assert me.data["storage_quota_bytes"] == 1024**3


def test_username_must_be_url_safe():
    res = signup(APIClient(), username="Asha Sharma!")
    assert res.status_code == 400


def test_duplicate_email_rejected():
    signup(APIClient())
    res = signup(APIClient(), username="asha2")
    assert res.status_code == 400


def test_login_with_email():
    signup(APIClient())
    c = APIClient()
    res = c.post(LOGIN, {"email": "asha@example.com", "password": "trek-Pass-2026"}, format="json")
    assert res.status_code == 200
    assert c.get("/api/me").status_code == 200


def test_me_cannot_change_username():
    c = APIClient()
    signup(c)
    res = c.patch("/api/me", {"username": "other", "display_name": "Asha"}, format="json")
    assert res.data["username"] == "asha"
    assert res.data["display_name"] == "Asha"


def test_repeated_failed_logins_are_locked_out():
    signup(APIClient())
    c = APIClient()
    bad = {"email": "asha@example.com", "password": "wrong-password"}
    codes = [c.post(LOGIN, bad, format="json").json()["errors"][0]["code"] for _ in range(6)]
    assert codes[:5] == ["email_password_mismatch"] * 5
    assert codes[5] == "too_many_login_attempts"
