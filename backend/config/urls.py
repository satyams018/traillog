from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from trips.share import PublicTripView, og_image, share_page


def health(_request):
    return JsonResponse({"ok": True})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("_allauth/", include("allauth.headless.urls")),
    path("api/", include("accounts.urls")),
    path("api/", include("trips.urls")),
    path("api/public/u/<str:username>/<slug:slug>", PublicTripView.as_view()),
    path("u/<str:username>/<slug:slug>", share_page, name="share-page"),
    path("og/<uuid:trip_id>.png", og_image, name="og-image"),
    path("healthz", health),
]
