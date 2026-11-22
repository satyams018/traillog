"""Create the storage bucket if it doesn't exist (local dev; on R2 create it in the dashboard)."""

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
