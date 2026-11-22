from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class TrailLogUserAdmin(UserAdmin):
    list_display = ("username", "email", "display_name", "date_joined")
    fieldsets = UserAdmin.fieldsets + (
        ("TrailLog", {"fields": ("display_name", "storage_used_bytes", "storage_quota_bytes")}),
    )
