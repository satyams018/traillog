from rest_framework import serializers

from .models import User


class MeSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "display_name",
            "storage_used_bytes",
            "storage_quota_bytes",
        ]
        # Username changes would break existing share links, so it is fixed after signup.
        read_only_fields = ["id", "username", "email", "storage_used_bytes", "storage_quota_bytes"]


class DeleteAccountSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False)
