import pytest
from django.core.cache import cache

from config.celery import app as celery_app
from core import storage


@pytest.fixture(autouse=True)
def _test_settings(settings):
    settings.STORAGE_BACKEND = "memory"
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]  # fast tests
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    cache.clear()  # rate-limit counters must not leak between tests
    storage.clear_memory()
    yield
    storage.clear_memory()
