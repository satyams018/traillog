"""Usernames appear in share URLs (/u/<username>/...), so keep them URL-safe and lowercase."""

from django.core.validators import RegexValidator

username_validators = [
    RegexValidator(
        regex=r"^[a-z0-9_-]{3,30}$",
        message="Use 3–30 lowercase letters, numbers, '-' or '_'.",
    )
]
