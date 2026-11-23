import logging
from datetime import timedelta

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.db import transaction
from django.db.models import Count, OuterRef, Prefetch, Q, Subquery, Sum
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from core import storage

from .models import Highlight, Photo, Track, Trip
from .photos import locate_on_line, point_at_fraction
from .serializers import (
    BulkVisibilitySerializer,
    HighlightOrderSerializer,
    HighlightSerializer,
    HighlightWriteSerializer,
    PhotoSerializer,
    PhotoUpdateSerializer,
    PresignItemSerializer,
    TripSerializer,
    cover_photos,
)
from .tasks import (
    _matching_track,
    _quota_add,
    apply_placement,
    delete_objects,
    match_photos,
    process_gpx,
    process_photo,
)

log = logging.getLogger(__name__)


class TripViewSet(viewsets.ModelViewSet):
    """Owner-only trip CRUD. Other users' trips return 404, never 403 (SPEC §8)."""

    serializer_class = TripSerializer
    http_method_names = ["get", "post", "patch", "delete"]
    throttle_scope = None  # set per action below (e.g. "upload")

    def get_queryset(self):
        return (
            Trip.objects.filter(owner=self.request.user)
            .select_related("track")
            .annotate(
                ready_photo_count=Count("photos", filter=Q(photos__status=Photo.Status.READY)),
                cover_key=Subquery(cover_photos(OuterRef("pk")).values("sizes__web")[:1]),
            )
        )

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_update(self, serializer):
        old_offset = serializer.instance.camera_offset_s
        trip = serializer.save()
        if trip.camera_offset_s != old_offset:
            # Synchronous on purpose: matching reads only DB fields (~ms for 300 photos), so
            # the offset slider sees the new positions in the same response (ADR-29).
            match_photos(str(trip.id))

    @transaction.atomic
    def perform_destroy(self, instance):
        keys = [k for p in instance.photos.all() for k in p.object_keys]
        gpx_key = getattr(getattr(instance, "track", None), "gpx_key", None)
        if gpx_key:
            keys.append(gpx_key)
        freed = instance.photos.aggregate(total=Sum("stored_bytes"))["total"] or 0
        instance.delete()
        _quota_add(instance.owner_id, -freed)
        if keys:
            transaction.on_commit(lambda: delete_objects.delay(keys))

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

    # --- Photos -------------------------------------------------------------------------

    @action(detail=True, methods=["get"], url_path="photos")
    def photos(self, request, pk=None):
        trip = self.get_object()
        qs = trip.photos.exclude(status=Photo.Status.FAILED, updated_at__lt=_day_ago())
        return Response(PhotoSerializer(qs, many=True).data)

    @action(
        detail=True,
        methods=["post"],
        url_path="photos/presign",
        throttle_classes=[ScopedRateThrottle],
        throttle_scope="presign",
    )
    def presign(self, request, pk=None):
        """Reserve photo rows and hand out one presigned PUT URL per file (ADR-4)."""
        trip = self.get_object()
        if not isinstance(request.data, list) or not request.data:
            raise ValidationError({"files": ["Send a list of files to upload."]})
        if len(request.data) > settings.PHOTO_PRESIGN_BATCH:
            raise ValidationError(
                {"files": [f"Upload at most {settings.PHOTO_PRESIGN_BATCH} photos at a time."]}
            )
        items = PresignItemSerializer(data=request.data, many=True)
        items.is_valid(raise_exception=True)
        files = items.validated_data

        with transaction.atomic():
            # Lock the user row so two parallel presigns can't both squeeze under the quota.
            user = get_user_model().objects.select_for_update().get(id=request.user.id)
            existing = trip.photos.exclude(status=Photo.Status.FAILED).count()
            if existing + len(files) > settings.PHOTO_MAX_PER_TRIP:
                return _error(
                    "too_many_photos",
                    f"A trip can hold up to {settings.PHOTO_MAX_PER_TRIP} photos "
                    f"({existing} already added).",
                    status.HTTP_400_BAD_REQUEST,
                )
            pending = (
                Photo.objects.filter(
                    uploaded_by=user, status=Photo.Status.PENDING, created_at__gte=_day_ago()
                ).aggregate(total=Sum("original_bytes"))["total"]
                or 0
            )
            incoming = sum(f["bytes"] for f in files)
            estimate = user.storage_used_bytes + (pending + incoming) * settings.PHOTO_STORED_RATIO
            if estimate > user.storage_quota_bytes:
                return _error(
                    "quota_exceeded",
                    "These photos would go over your storage limit. Delete some photos or "
                    "upload fewer.",
                    status.HTTP_409_CONFLICT,
                )
            start_order = (
                trip.photos.order_by("-order").values_list("order", flat=True).first() or 0
            ) + 1
            photos = [
                Photo(
                    trip=trip,
                    uploaded_by=user,
                    filename=f["filename"],
                    content_type=(
                        "image/heic" if f["content_type"] == "image/heif" else f["content_type"]
                    ),
                    original_bytes=f["bytes"],
                    order=start_order + i,
                )
                for i, f in enumerate(files)
            ]
            for p in photos:
                p.upload_key = f"uploads/{trip.id}/{p.id}"
            Photo.objects.bulk_create(photos)

        out = []
        for p, f in zip(photos, files, strict=True):
            out.append(
                {
                    "photo_id": str(p.id),
                    "filename": p.filename,
                    "put_url": storage.presign_put(p.upload_key, f["content_type"], f["bytes"]),
                    "headers": {"Content-Type": f["content_type"]},
                }
            )
        return Response(out, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="photos/bulk")
    def bulk(self, request, pk=None):
        """Show or hide many photos at once, including the whole trip with "all"."""
        trip = self.get_object()
        body = BulkVisibilitySerializer(data=request.data)
        body.is_valid(raise_exception=True)
        qs = trip.photos.all()
        if body.validated_data["photo_ids"] != "all":
            qs = qs.filter(id__in=body.validated_data["photo_ids"])
        updated = qs.update(is_public=body.validated_data["is_public"], updated_at=timezone.now())
        return Response({"updated": updated})

    # --- Story highlights ---------------------------------------------------------------

    @action(detail=True, methods=["get", "post"], url_path="highlights")
    def highlights(self, request, pk=None):
        trip = self.get_object()
        if request.method == "GET":
            return Response(HighlightSerializer(_highlights(trip), many=True).data)
        body = HighlightWriteSerializer(data=request.data, context={"trip": trip})
        body.is_valid(raise_exception=True)
        data = body.validated_data
        if "label" not in data:
            raise ValidationError({"label": ["Give this stop a title."]})
        with transaction.atomic():
            highlight = Highlight.objects.create(
                trip=trip,
                kind=data.get("kind", Highlight.Kind.OTHER),
                label=data["label"],
                body=data.get("body", ""),
            )
            _set_highlight_photos(highlight, data.get("photo_ids", []))
            _insert_in_route_order(trip, highlight)
        return Response(
            HighlightSerializer(_highlights(trip).get(id=highlight.id)).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="highlights/order")
    def highlight_order(self, request, pk=None):
        """Reorder the story: `ids` must list every highlight of the trip exactly once."""
        trip = self.get_object()
        body = HighlightOrderSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        ids = body.validated_data["ids"]
        current = set(trip.highlights.values_list("id", flat=True))
        if len(ids) != len(set(ids)) or set(ids) != current:
            raise ValidationError({"ids": ["List every highlight of this trip exactly once."]})
        with transaction.atomic():
            for i, hid in enumerate(ids):
                Highlight.objects.filter(id=hid).update(order=i)
        return Response(HighlightSerializer(_highlights(trip), many=True).data)


class HighlightViewSet(mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Edit or remove one story stop. Deleting it leaves its photos in the trip."""

    http_method_names = ["patch", "delete"]

    def get_queryset(self):
        return Highlight.objects.filter(trip__owner=self.request.user).select_related("trip")

    def partial_update(self, request, *args, **kwargs):
        highlight = self.get_object()
        body = HighlightWriteSerializer(data=request.data, context={"trip": highlight.trip})
        body.is_valid(raise_exception=True)
        data = body.validated_data
        with transaction.atomic():
            for field in ("kind", "label", "body"):
                if field in data:
                    setattr(highlight, field, data[field])
            highlight.save()
            if "photo_ids" in data:
                _set_highlight_photos(highlight, data["photo_ids"])
        return Response(HighlightSerializer(_highlights(highlight.trip).get(id=highlight.id)).data)


def _highlights(trip):
    return trip.highlights.prefetch_related(
        Prefetch("photos", queryset=Photo.objects.filter(status=Photo.Status.READY))
    )


def _set_highlight_photos(highlight, photo_ids) -> None:
    highlight.photos.exclude(id__in=photo_ids).update(highlight=None)
    Photo.objects.filter(trip=highlight.trip_id, id__in=photo_ids).update(highlight=highlight)


def _insert_in_route_order(trip, new) -> None:
    """Slot a new stop in after the last stop that comes before it on the route, so the
    story reads start to end by default; stops the owner has reordered keep their places."""
    stops = list(_highlights(trip).exclude(id=new.id))
    new_at = HighlightSerializer(_highlights(trip).get(id=new.id)).data["route_fraction"]
    index = len(stops)
    if new_at is not None:
        index = 0
        for i, stop in enumerate(stops):
            at = HighlightSerializer(stop).data["route_fraction"]
            if at is not None and at <= new_at:
                index = i + 1
    stops.insert(index, new)
    for i, stop in enumerate(stops):
        if stop.order != i:
            Highlight.objects.filter(id=stop.id).update(order=i)


class PhotoViewSet(mixins.UpdateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Owner-only photo edits. Other users' photos are 404 (SPEC §8)."""

    serializer_class = PhotoSerializer
    http_method_names = ["patch", "delete", "post"]

    def get_queryset(self):
        return Photo.objects.filter(trip__owner=self.request.user).select_related("trip__track")

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """The browser finished its PUT: queue processing. Safe to call twice."""
        photo = self.get_object()
        if photo.status == Photo.Status.PENDING and photo.upload_key:
            transaction.on_commit(lambda: process_photo.delay(str(photo.id)))
            return Response(PhotoSerializer(photo).data, status=status.HTTP_202_ACCEPTED)
        return Response(PhotoSerializer(photo).data)

    def partial_update(self, request, *args, **kwargs):
        photo = self.get_object()
        body = PhotoUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        for field in ("caption", "is_public", "order"):
            if field in data:
                setattr(photo, field, data[field])

        if "location" in data or "route_fraction" in data:
            if photo.status != Photo.Status.READY:
                return _error(
                    "not_ready", "This photo is still processing.", status.HTTP_409_CONFLICT
                )
            track = _matching_track(photo.trip)
            if data.get("location") is None and "location" in data:
                apply_placement(photo, photo.trip, track)  # un-place: let matching retry
                if photo.placement == Photo.Placement.MANUAL:
                    photo.placement = Photo.Placement.UNPLACED
            elif "route_fraction" in data:
                if track is None:
                    return _error(
                        "no_track",
                        "Add a GPX track before placing photos on the route.",
                        status.HTTP_409_CONFLICT,
                    )
                photo.route_fraction = data["route_fraction"]
                photo.location = Point(
                    *point_at_fraction(track.simple, photo.route_fraction), srid=4326
                )
                photo.placement = Photo.Placement.MANUAL
            else:
                lng, lat = data["location"]
                ele = 0.0
                photo.route_fraction = None
                if track is not None:
                    photo.route_fraction = locate_on_line(track.simple, lng, lat)[1]
                    ele = point_at_fraction(track.simple, photo.route_fraction)[2]
                photo.location = Point(lng, lat, ele, srid=4326)
                photo.placement = Photo.Placement.MANUAL
        photo.save()
        return Response(PhotoSerializer(photo).data)

    @transaction.atomic
    def perform_destroy(self, instance):
        keys = instance.object_keys
        freed = instance.stored_bytes
        instance.delete()
        _quota_add(instance.uploaded_by_id, -freed)
        if keys:
            transaction.on_commit(lambda: delete_objects.delay(keys))


def _day_ago():
    return timezone.now() - timedelta(hours=24)


def _error(code: str, message: str, http_status: int) -> Response:
    return Response({"error": {"code": code, "message": message}}, status=http_status)


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
