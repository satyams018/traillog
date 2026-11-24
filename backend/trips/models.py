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

    @property
    def object_keys(self) -> list[str]:
        """Storage objects to delete with the trip: its photos' files and the GPX file."""
        keys = [k for p in self.photos.all() for k in p.object_keys]
        gpx_key = getattr(getattr(self, "track", None), "gpx_key", None)
        return [*keys, gpx_key] if gpx_key else keys


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


class Highlight(models.Model):
    """One stop in a trip's story: a titled note with the photos taken there (SPEC F9).

    Photos join a highlight through `Photo.highlight`, so a photo appears in the story once.
    Its place on the route comes from its photos (see HighlightSerializer.route_fraction).
    """

    class Kind(models.TextChoices):
        SIGHT = "sight", "Sight"
        VIEWPOINT = "viewpoint", "Viewpoint"
        FOOD = "food", "Food & drink"
        STAY = "stay", "Stay"
        CAMP = "camp", "Camp"
        SUMMIT = "summit", "Summit"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name="highlights")
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.OTHER)
    label = models.CharField(max_length=120)
    body = models.TextField(max_length=5000, blank=True)  # plain paragraphs for now
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "created_at"]

    def __str__(self):
        return f"Highlight {self.label} ({self.trip_id})"


class Photo(models.Model):
    """A trip photo. Only EXIF-free WebP copies are kept; the upload is deleted (ADR-21)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    class Placement(models.TextChoices):
        EXIF = "exif", "From photo GPS"
        TIME = "time", "Matched by time"
        MANUAL = "manual", "Placed by hand"
        UNPLACED = "unplaced", "Not placed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name="photos")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="photos"
    )
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=40)
    # Temporary object key of the browser's upload; cleared once the copies are made.
    upload_key = models.CharField(max_length=255, null=True, blank=True)
    sizes = models.JSONField(default=dict, blank=True)  # {"thumb": key, "web": key}
    original_bytes = models.BigIntegerField(default=0)
    stored_bytes = models.BigIntegerField(default=0)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    # The EXIF fields re-matching needs, so the original is never needed again.
    exif = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    error = models.CharField(max_length=300, blank=True)
    taken_at = models.DateTimeField(null=True, blank=True)  # UTC, camera offset applied
    location = models.PointField(dim=3, srid=4326, null=True, blank=True)
    placement = models.CharField(
        max_length=10, choices=Placement.choices, default=Placement.UNPLACED
    )
    route_fraction = models.FloatField(null=True, blank=True)  # 0..1 along the route
    # Distance between the time-matched and GPS positions, for the accuracy metric (§6.3).
    time_match_error_m = models.FloatField(null=True, blank=True)
    caption = models.CharField(max_length=500, blank=True)
    is_public = models.BooleanField(default=True)
    order = models.IntegerField(default=0)
    # The story stop this photo belongs to, if any.
    highlight = models.ForeignKey(
        Highlight, on_delete=models.SET_NULL, null=True, blank=True, related_name="photos"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "taken_at", "created_at"]
        indexes = [models.Index(fields=["trip", "status"])]

    def __str__(self):
        return f"Photo {self.filename} ({self.trip_id})"

    @property
    def object_keys(self) -> list[str]:
        return [k for k in [self.upload_key, *self.sizes.values()] if k]
