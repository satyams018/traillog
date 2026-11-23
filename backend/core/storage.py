"""Thin wrapper over the S3 API (SeaweedFS locally, Cloudflare R2 in production).

A tiny in-memory backend is used in tests so they don't need SeaweedFS running.
Photos go browser -> storage directly with presigned PUT URLs (ADR-4), and are served with
short-lived presigned GET URLs because the bucket is private.
"""

from functools import lru_cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
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


def head_size(key: str) -> int | None:
    """Size of a stored object in bytes, or None if it doesn't exist."""
    if _use_memory():
        return len(_memory[key]) if key in _memory else None
    try:
        return _client().head_object(Bucket=settings.S3_BUCKET, Key=key)["ContentLength"]
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def presign_put(key: str, content_type: str, size: int, expires_s: int = 3600) -> str:
    """URL the browser PUTs one file to. Content-Type and Content-Length are signed, so the
    browser must send exactly the declared type and size (sizes are re-checked with HEAD)."""
    if _use_memory():
        return f"memory://put/{key}"
    return _client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.S3_BUCKET,
            "Key": key,
            "ContentType": content_type,
            "ContentLength": size,
        },
        ExpiresIn=expires_s,
    )


def presign_get(key: str, expires_s: int = 3600) -> str:
    if _use_memory():
        return f"memory://get/{key}"
    return _client().generate_presigned_url(
        "get_object", Params={"Bucket": settings.S3_BUCKET, "Key": key}, ExpiresIn=expires_s
    )


def delete(key: str) -> None:
    if _use_memory():
        _memory.pop(key, None)
        return
    _client().delete_object(Bucket=settings.S3_BUCKET, Key=key)


def clear_memory() -> None:
    """Test helper."""
    _memory.clear()
