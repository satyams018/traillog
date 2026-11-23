"""Django settings for TrailLog.

All environment-specific values come from environment variables (or the repo-root `.env`
in development). See `.env.example` for the full list.
"""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
REPO_DIR = BASE_DIR.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CSRF_TRUSTED_ORIGINS=(list, ["http://localhost:5173"]),
    CELERY_TASK_ALWAYS_EAGER=(bool, False),
    ACCOUNT_EMAIL_VERIFICATION=(str, "optional"),
)
environ.Env.read_env(REPO_DIR / ".env", overwrite=False)

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

# GeoDjango needs GDAL/GEOS. On Apple Silicon Homebrew they live in /opt/homebrew/lib,
# which ctypes does not search by default, so allow explicit paths.
GDAL_LIBRARY_PATH = env("GDAL_LIBRARY_PATH", default=None)
GEOS_LIBRARY_PATH = env("GEOS_LIBRARY_PATH", default=None)

INSTALLED_APPS = [
    "core",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "django.contrib.postgres",
    "rest_framework",
    "allauth",
    "allauth.account",
    "allauth.headless",
    "accounts",
    "trips",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# DATABASE_URL uses the postgis:// scheme so Django picks the GeoDjango PostGIS backend.
DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["CONN_MAX_AGE"] = 60

# Shared cache. allauth's login rate limits live here, so production must use Redis:
# with local-memory caches every gunicorn worker would count failed logins separately.
CACHES = {"default": env.cache("CACHE_URL", default="locmemcache://")}

AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# --- Sessions & CSRF (ADR-3: same-origin session cookies) ---
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# --- django-allauth (headless, email + password; Google comes in v1.0.1) ---
HEADLESS_ONLY = True
HEADLESS_FRONTEND_URLS = {
    "account_confirm_email": "/account/verify-email/{key}",
    "account_reset_password_from_key": "/account/password/reset/{key}",
    "account_signup": "/signup",
}
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*"]
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_USERNAME_MIN_LENGTH = 3
ACCOUNT_USERNAME_VALIDATORS = "accounts.validators.username_validators"
# "optional" sends the email but doesn't block login; switch to "mandatory" once a real
# email provider is configured for production.
ACCOUNT_EMAIL_VERIFICATION = env("ACCOUNT_EMAIL_VERIFICATION")
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="TrailLog <no-reply@localhost>")

# --- DRF ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "config.pagination.CreatedAtCursorPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_RATES": {"upload": "20/min", "presign": "20/min"},
}

# --- Celery (ADR-6) ---
CELERY_BROKER_URL = env("REDIS_URL", default="redis://localhost:6379/0")
CELERY_TASK_ALWAYS_EAGER = env("CELERY_TASK_ALWAYS_EAGER")
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_TASK_ACKS_LATE = True  # re-deliver a job if the worker dies mid-task
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_IGNORE_RESULT = True  # status lives on the Trip row, not in a result backend

# --- Object storage (S3 API: SeaweedFS locally, R2 in prod) ---
STORAGE_BACKEND = env("STORAGE_BACKEND", default="s3")  # "s3" or "memory" (tests)
S3_ENDPOINT_URL = env("S3_ENDPOINT_URL", default="http://localhost:9000")
S3_ACCESS_KEY_ID = env("S3_ACCESS_KEY_ID", default="")
S3_SECRET_ACCESS_KEY = env("S3_SECRET_ACCESS_KEY", default="")
S3_BUCKET = env("S3_BUCKET", default="traillog")
S3_REGION = env("S3_REGION", default="auto")

# --- Upload limits (SPEC §9) ---
GPX_MAX_BYTES = 20 * 1024 * 1024
GPX_MAX_POINTS = 200_000
PHOTO_MAX_BYTES = 25 * 1024 * 1024
PHOTO_MAX_PER_TRIP = 300
PHOTO_PRESIGN_BATCH = 50
# Stored WebP copies are ~5% of a phone JPEG/HEIC; used to refuse uploads over quota early.
PHOTO_STORED_RATIO = 0.05
DATA_UPLOAD_MAX_MEMORY_SIZE = 2_621_440  # files above 2.5 MB stream to a temp file

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
