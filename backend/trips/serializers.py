from django.conf import settings
from django.utils.text import slugify
from rest_framework import serializers

from core import storage

from .models import Highlight, Photo, Trip

ELEVATION_PREVIEW_POINTS = 48


def cover_photos(trip):
    """A trip's candidate cover photos, best first: ready, shown on the share page if
    possible, then in the photos' own order. `trip` may be an OuterRef for a subquery."""
    return Photo.objects.filter(trip=trip, status=Photo.Status.READY).order_by(
        "-is_public", "order", "taken_at", "created_at"
    )


class TripSerializer(serializers.ModelSerializer):
    has_track = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()
    elevation_preview = serializers.SerializerMethodField()
    track_updated_at = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()
    cover_url = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        fields = [
            "id",
            "kind",
            "title",
            "slug",
            "description",
            "visibility",
            "share_token",
            "status",
            "error",
            "stats",
            "timezone",
            "camera_offset_s",
            "privacy_zone_m",
            "start_date",
            "end_date",
            "has_track",
            "track_updated_at",
            "preview",
            "elevation_preview",
            "photo_count",
            "cover_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "slug",
            "share_token",
            "status",
            "error",
            "stats",
            "timezone",
            "start_date",
            "end_date",
            "created_at",
            "updated_at",
        ]

    def get_has_track(self, obj) -> bool:
        return hasattr(obj, "track") and obj.track.geom is not None

    def get_track_updated_at(self, obj):
        """Lets the client cache the (large) track until the GPX actually changes."""
        track = getattr(obj, "track", None)  # missing reverse 1:1 raises AttributeError
        return track.updated_at if track else None

    def get_photo_count(self, obj) -> int:
        annotated = getattr(obj, "ready_photo_count", None)
        if annotated is not None:
            return annotated
        return obj.photos.filter(status=Photo.Status.READY).count()

    def get_cover_url(self, obj) -> str | None:
        """Web-size copy of the trip's first photo, for the trip card (owner-only API)."""
        if hasattr(obj, "cover_key"):
            key = obj.cover_key
        else:
            photo = cover_photos(obj).first()
            key = photo.sizes.get("web") if photo else None
        return storage.presign_get(key) if key else None

    def get_elevation_preview(self, obj) -> list:
        """<= 48 evenly spaced elevations, drawn as a small ridge on trip cards."""
        track = getattr(obj, "track", None)
        eles = [row[1] for row in (track.profile if track else []) if row[1] is not None]
        if len(eles) <= ELEVATION_PREVIEW_POINTS:
            return [round(e) for e in eles]
        n = ELEVATION_PREVIEW_POINTS
        return [round(eles[round(i * (len(eles) - 1) / (n - 1))]) for i in range(n)]

    def get_preview(self, obj) -> list:
        track = getattr(obj, "track", None)
        return track.preview if track else []

    def validate_title(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Title can't be empty.")
        return value

    def validate_camera_offset_s(self, value: int) -> int:
        if abs(value) > 48 * 3600:
            raise serializers.ValidationError("Offset must be within ±48 hours.")
        return value

    def validate_kind(self, value: str) -> str:
        if value != Trip.Kind.GPX:
            raise serializers.ValidationError("Only GPX trips are supported for now.")
        return value

    def create(self, validated_data):
        owner = validated_data["owner"]
        validated_data["slug"] = unique_slug(owner, validated_data["title"])
        return super().create(validated_data)


def unique_slug(owner, title: str) -> str:
    """Slug unique per owner. It is fixed at creation so share links never change."""
    base = slugify(title)[:60].strip("-") or "trip"
    slug, n = base, 2
    while Trip.objects.filter(owner=owner, slug=slug).exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


class PhotoSerializer(serializers.ModelSerializer):
    """Owner view of a photo. EXIF stays server-side; files are short-lived signed URLs."""

    thumb_url = serializers.SerializerMethodField()
    web_url = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = [
            "id",
            "filename",
            "status",
            "error",
            "thumb_url",
            "web_url",
            "width",
            "height",
            "taken_at",
            "location",
            "placement",
            "route_fraction",
            "caption",
            "is_public",
            "order",
            "highlight",
            "stored_bytes",
            "created_at",
        ]
        read_only_fields = fields

    def _url(self, obj, size):
        key = obj.sizes.get(size)
        return storage.presign_get(key) if key else None

    def get_thumb_url(self, obj):
        return self._url(obj, "thumb")

    def get_web_url(self, obj):
        return self._url(obj, "web")

    def get_location(self, obj):
        """[lng, lat, ele] or null."""
        return list(obj.location.coords) if obj.location else None


class PhotoUpdateSerializer(serializers.Serializer):
    """PATCH body. `location` ([lng, lat]) or `route_fraction` places a photo by hand;
    `location: null` un-places it so time matching can try again."""

    caption = serializers.CharField(max_length=500, allow_blank=True, required=False)
    is_public = serializers.BooleanField(required=False)
    order = serializers.IntegerField(min_value=0, max_value=100_000, required=False)
    location = serializers.ListField(
        child=serializers.FloatField(),
        min_length=2,
        max_length=2,
        allow_null=True,
        required=False,
    )
    route_fraction = serializers.FloatField(min_value=0, max_value=1, required=False)

    def validate_location(self, value):
        if value is not None:
            lng, lat = value
            if not (-180 <= lng <= 180 and -90 <= lat <= 90):
                raise serializers.ValidationError("Not a valid [longitude, latitude].")
        return value

    def validate(self, attrs):
        if "location" in attrs and "route_fraction" in attrs:
            raise serializers.ValidationError("Send either location or route_fraction.")
        return attrs


class PresignItemSerializer(serializers.Serializer):
    filename = serializers.CharField(max_length=255)
    content_type = serializers.ChoiceField(choices=["image/jpeg", "image/heic", "image/heif"])
    bytes = serializers.IntegerField(min_value=1)

    def validate_bytes(self, value):
        if value > settings.PHOTO_MAX_BYTES:
            mb = settings.PHOTO_MAX_BYTES // (1024 * 1024)
            raise serializers.ValidationError(f"Photos must be {mb} MB or smaller.")
        return value


class BulkVisibilitySerializer(serializers.Serializer):
    photo_ids = serializers.JSONField()  # list of UUIDs, or the string "all"
    is_public = serializers.BooleanField()

    def validate_photo_ids(self, value):
        if value == "all":
            return value
        if not isinstance(value, list) or not value or len(value) > settings.PHOTO_MAX_PER_TRIP:
            raise serializers.ValidationError('Send a list of photo ids or "all".')
        field = serializers.UUIDField()
        return [field.to_internal_value(v) for v in value]


HIGHLIGHT_MAX_PHOTOS = 24


def photo_story_order(photos):
    """A highlight's photos in the order you walked past them (unplaced ones last)."""
    return sorted(
        photos,
        key=lambda p: (
            p.route_fraction is None,
            p.route_fraction or 0,
            p.taken_at is None,
            p.taken_at or p.created_at,
            p.created_at,
        ),
    )


class HighlightSerializer(serializers.ModelSerializer):
    """A story stop. Expects `photos` prefetched with only ready photos."""

    photo_ids = serializers.SerializerMethodField()
    route_fraction = serializers.SerializerMethodField()

    class Meta:
        model = Highlight
        fields = ["id", "kind", "label", "body", "order", "photo_ids", "route_fraction"]
        read_only_fields = fields

    def get_photo_ids(self, obj) -> list[str]:
        return [str(p.id) for p in photo_story_order(obj.photos.all())]

    def get_route_fraction(self, obj) -> float | None:
        """Where the stop is on the route: the middle of its placed photos."""
        fractions = [p.route_fraction for p in obj.photos.all() if p.route_fraction is not None]
        return round(sum(fractions) / len(fractions), 5) if fractions else None


class HighlightWriteSerializer(serializers.Serializer):
    """POST/PATCH body. `photo_ids` replaces the stop's photos; photos taken from another
    stop move here, since a photo appears in the story once."""

    kind = serializers.ChoiceField(choices=Highlight.Kind.choices, required=False)
    label = serializers.CharField(max_length=120, required=False)
    body = serializers.CharField(max_length=5000, allow_blank=True, required=False)
    photo_ids = serializers.ListField(
        child=serializers.UUIDField(), max_length=HIGHLIGHT_MAX_PHOTOS, required=False
    )

    def validate_label(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give this stop a title.")
        return value

    def validate_photo_ids(self, value):
        trip = self.context["trip"]
        ids = list(dict.fromkeys(value))  # drop repeats, keep order
        found = set(
            trip.photos.filter(id__in=ids, status=Photo.Status.READY).values_list("id", flat=True)
        )
        if len(found) != len(ids):
            raise serializers.ValidationError("Some of these photos aren't in this trip.")
        return ids


class HighlightOrderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)
