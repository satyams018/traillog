from django.utils.text import slugify
from rest_framework import serializers

from .models import Trip


class TripSerializer(serializers.ModelSerializer):
    has_track = serializers.SerializerMethodField()
    track_updated_at = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()

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
