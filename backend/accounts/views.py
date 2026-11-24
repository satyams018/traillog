from django.contrib.auth import logout
from django.db import transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from trips.tasks import delete_objects

from .serializers import DeleteAccountSerializer, MeSerializer


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    """Sets the csrftoken cookie so the SPA can send X-CSRFToken on unsafe requests."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"ok": True})


class MeView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = MeSerializer
    http_method_names = ["get", "patch", "delete"]

    def get_object(self):
        return self.request.user

    throttle_classes = [ScopedRateThrottle]

    @property
    def throttle_scope(self):
        # Deleting checks the password, so it gets a tight limit, like a login form.
        return "account_delete" if self.request.method == "DELETE" else None

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        """Delete the account, its trips and photos, and every stored file (ADR-37).

        The password is asked again so a borrowed, still-logged-in phone can't do it.
        """
        body = DeleteAccountSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(body.validated_data["password"]):
            raise ValidationError({"password": ["That password isn't right."]})

        keys = [k for trip in user.trips.prefetch_related("photos") for k in trip.object_keys]
        logout(request)
        user.delete()  # trips, tracks, photos and highlights go with it (CASCADE)
        if keys:
            transaction.on_commit(lambda: delete_objects.delay(keys))
        return Response(status=status.HTTP_204_NO_CONTENT)
