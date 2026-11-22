import uuid

from django.contrib.auth.models import AbstractUser, UserManager
from django.db import models

from .validators import username_validators

ONE_GB = 1024**3


class User(AbstractUser):
    """Custom user: UUID id (ADR-20), unique email, URL-safe username, storage quota (ADR-21)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = models.CharField(max_length=30, unique=True, validators=username_validators)
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=60, blank=True)
    avatar_key = models.CharField(max_length=255, blank=True)
    storage_used_bytes = models.BigIntegerField(default=0)
    storage_quota_bytes = models.BigIntegerField(default=ONE_GB)

    objects = UserManager()

    def save(self, *args, **kwargs):
        self.username = self.username.lower()
        self.email = self.email.lower()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.username
