import secrets
import uuid

from django.conf import settings
from django.contrib.gis.db import models
from django.contrib.postgres.fields import ArrayField
from django.core.validators import MaxValueValidator, MinValueValidator


def new_share_token() -> str:
    return secrets.token_urlsafe(16)  # 22 URL-safe chars (ADR-13)


class Trip(models.Model):
    class Kind(models.TextChoices):
        GPX = "gpx", "GPS track"
        TRAVEL = "travel", "Travel (no GPX)"

    class Visibility(models.TextChoices):
        PRIVATE = "private", "Private"
        LINK = "link", "Anyone with the link"
        PUBLIC = "public", "Public"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PROCESSING = "processing", "Processing"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trips"
    )
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.GPX)
    title = models.CharField(max_length=120)
    slug = models.SlugField(max_length=70)
    description = models.TextField(blank=True, max_length=5000)
    visibility = models.CharField(
        max_length=10, choices=Visibility.choices, default=Visibility.PRIVATE
    )
    share_token = models.CharField(max_length=32, default=new_share_token)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    error = models.CharField(max_length=500, blank=True)
    stats = models.JSONField(default=dict, blank=True)
    timezone = models.CharField(max_length=64, blank=True)
    camera_offset_s = models.IntegerField(default=0)
    privacy_zone_m = models.PositiveIntegerField(
        default=300, validators=[MinValueValidator(0), MaxValueValidator(2000)]
    )
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    og_version = models.PositiveIntegerField(default=0)
    comments_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["owner", "slug"], name="unique_trip_slug_per_owner")
        ]
        indexes = [models.Index(fields=["visibility"])]

    def __str__(self):
        return f"{self.owner} / {self.slug}"


class Track(models.Model):
    """The GPS track of a trip. Full geometry for stats, simplified for display (ADR-9)."""

    trip = models.OneToOneField(Trip, on_delete=models.CASCADE, related_name="track")
    gpx_key = models.CharField(max_length=255)
    geom = models.LineStringField(dim=3, srid=4326, null=True)
    # Epoch seconds per point, same order as geom; None where the GPX had no time.
    times = ArrayField(models.FloatField(null=True), default=list, blank=True)
    segment_breaks = ArrayField(models.IntegerField(), default=list, blank=True)
    simplified_geom = models.LineStringField(dim=3, srid=4326, null=True)
    profile = models.JSONField(default=list, blank=True)  # [[dist_m, ele_m, t, lng, lat], ...]
    waypoints = models.JSONField(default=list, blank=True)
    # <= 64 [lng, lat] points, small enough to ship with every trip in the list view.
    preview = models.JSONField(default=list, blank=True)
    # Privacy-trimmed versions for public pages (filled by build_public_track, ADR-10).
    public_geom = models.LineStringField(dim=3, srid=4326, null=True)
    public_profile = models.JSONField(default=list, blank=True)
    start_point = models.PointField(srid=4326, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Track for {self.trip_id}"
