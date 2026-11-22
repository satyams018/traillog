from rest_framework.routers import SimpleRouter

from .views import TripViewSet

router = SimpleRouter(trailing_slash=False)
router.register("trips", TripViewSet, basename="trip")

urlpatterns = router.urls
