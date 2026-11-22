import logging

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from core import storage

from .models import Track, Trip
from .serializers import TripSerializer
from .tasks import process_gpx

log = logging.getLogger(__name__)


class TripViewSet(viewsets.ModelViewSet):
    """Owner-only trip CRUD. Other users' trips return 404, never 403 (SPEC §8)."""

    serializer_class = TripSerializer
    http_method_names = ["get", "post", "patch", "delete"]
    throttle_scope = None  # set per action below (e.g. "upload")

    def get_queryset(self):
        return Trip.objects.filter(owner=self.request.user).select_related("track")

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_destroy(self, instance):
        gpx_key = getattr(getattr(instance, "track", None), "gpx_key", None)
        instance.delete()
        if gpx_key:
            transaction.on_commit(lambda: storage.delete(gpx_key))

    @action(
        detail=True,
        methods=["post"],
        parser_classes=[MultiPartParser],
        throttle_classes=[ScopedRateThrottle],
        throttle_scope="upload",
    )
    def gpx(self, request, pk=None):
        trip = self.get_object()
        if trip.status == Trip.Status.PROCESSING:
            return Response(
                {"error": {"code": "busy", "message": "This trip is still processing."}},
                status=status.HTTP_409_CONFLICT,
            )
        upload = request.FILES.get("file")
        data = validate_gpx_upload(upload)

        key = f"gpx/{trip.id}/track.gpx"
        try:
            storage.put_bytes(key, data, content_type="application/gpx+xml")
        except (BotoCoreError, ClientError):
            log.exception("Storing GPX for trip %s failed", trip.id)
            return Response(
                {
                    "error": {
                        "code": "storage_unavailable",
                        "message": "We couldn't save your file right now. Please try again.",
                    }
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        with transaction.atomic():
            Track.objects.update_or_create(trip=trip, defaults={"gpx_key": key})
            trip.status = Trip.Status.PROCESSING
            trip.error = ""
            trip.save(update_fields=["status", "error", "updated_at"])
            transaction.on_commit(lambda: process_gpx.delay(str(trip.id)))
        return Response(TripSerializer(trip).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=["get"])
    def track(self, request, pk=None):
        trip = self.get_object()
        track = getattr(trip, "track", None)
        if track is None or track.simplified_geom is None:
            return Response(
                {"error": {"code": "not_ready", "message": "No processed track yet."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        geom = track.simplified_geom
        return Response(
            {
                "geometry": {"type": "LineString", "coordinates": geom.coords},
                "bbox": list(geom.extent),
                "profile": track.profile,
                "waypoints": track.waypoints,
            }
        )


def validate_gpx_upload(upload) -> bytes:
    if upload is None:
        raise ValidationError({"file": ["Choose a GPX file to upload."]})
    if upload.size > settings.GPX_MAX_BYTES:
        mb = settings.GPX_MAX_BYTES // (1024 * 1024)
        raise ValidationError({"file": [f"GPX files must be {mb} MB or smaller."]})
    if not upload.name.lower().endswith(".gpx"):
        raise ValidationError({"file": ["The file must have a .gpx extension."]})
    data = upload.read()
    if b"<gpx" not in data[:4096]:
        raise ValidationError({"file": ["This doesn't look like a GPX file."]})
    return data
