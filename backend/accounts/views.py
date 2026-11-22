from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import generics
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import MeSerializer


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    """Sets the csrftoken cookie so the SPA can send X-CSRFToken on unsafe requests."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"ok": True})


class MeView(generics.RetrieveUpdateAPIView):
    serializer_class = MeSerializer
    http_method_names = ["get", "patch"]

    def get_object(self):
        return self.request.user
