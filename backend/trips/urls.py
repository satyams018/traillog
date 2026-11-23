from rest_framework.routers import SimpleRouter

from .views import HighlightViewSet, PhotoViewSet, TripViewSet

router = SimpleRouter(trailing_slash=False)
router.register("trips", TripViewSet, basename="trip")
router.register("photos", PhotoViewSet, basename="photo")
router.register("highlights", HighlightViewSet, basename="highlight")

urlpatterns = router.urls
