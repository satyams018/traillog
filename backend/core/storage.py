"""Thin wrapper over the S3 API (SeaweedFS locally, Cloudflare R2 in production).

A tiny in-memory backend is used in tests so they don't need SeaweedFS running.
Presigned URLs for photo uploads will be added here too.
"""

from functools import lru_cache

import boto3
from botocore.config import Config
from django.conf import settings

_memory: dict[str, bytes] = {}


@lru_cache(maxsize=1)
def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        aws_access_key_id=settings.S3_ACCESS_KEY_ID,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        region_name=settings.S3_REGION,
        config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
    )


def _use_memory() -> bool:
    return settings.STORAGE_BACKEND == "memory"


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    if _use_memory():
        _memory[key] = data
        return
    _client().put_object(Bucket=settings.S3_BUCKET, Key=key, Body=data, ContentType=content_type)


def get_bytes(key: str) -> bytes:
    if _use_memory():
        return _memory[key]
    obj = _client().get_object(Bucket=settings.S3_BUCKET, Key=key)
    return obj["Body"].read()


def delete(key: str) -> None:
    if _use_memory():
        _memory.pop(key, None)
        return
    _client().delete_object(Bucket=settings.S3_BUCKET, Key=key)


def clear_memory() -> None:
    """Test helper."""
    _memory.clear()
