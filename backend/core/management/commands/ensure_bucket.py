"""Create the storage bucket and its CORS rule (local dev; on R2 set both in the dashboard).

Browsers upload photos straight to the bucket with presigned PUTs (ADR-4), so the bucket must
allow PUT from the frontend's origins. The same origins as CSRF_TRUSTED_ORIGINS are used.
"""

from botocore.exceptions import ClientError
from django.conf import settings
from django.core.management.base import BaseCommand

from core.storage import _client


class Command(BaseCommand):
    help = "Create the S3 bucket configured in S3_BUCKET if it is missing."

    def handle(self, *args, **options):
        client = _client()
        bucket = settings.S3_BUCKET
        try:
            client.head_bucket(Bucket=bucket)
            self.stdout.write(f"Bucket '{bucket}' already exists.")
        except ClientError:
            client.create_bucket(Bucket=bucket)
            self.stdout.write(self.style.SUCCESS(f"Created bucket '{bucket}'."))
        client.put_bucket_cors(
            Bucket=bucket,
            CORSConfiguration={
                "CORSRules": [
                    {
                        "AllowedOrigins": list(settings.CSRF_TRUSTED_ORIGINS),
                        "AllowedMethods": ["PUT", "GET", "HEAD"],
                        "AllowedHeaders": ["*"],
                        "MaxAgeSeconds": 3600,
                    }
                ]
            },
        )
        origins = ", ".join(settings.CSRF_TRUSTED_ORIGINS)
        self.stdout.write(f"Browser uploads allowed from: {origins}")
