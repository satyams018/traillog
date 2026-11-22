from django.contrib.gis import admin

from .models import Track, Trip


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = ("title", "owner", "kind", "visibility", "status", "created_at")
    list_filter = ("status", "visibility", "kind")
    search_fields = ("title", "owner__username")


@admin.register(Track)
class TrackAdmin(admin.GISModelAdmin):
    list_display = ("trip", "updated_at")
    exclude = ("times", "profile")
