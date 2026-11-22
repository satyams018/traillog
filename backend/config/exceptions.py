"""Uniform API error shape: {"error": {"code", "message", "fields"?}} (SPEC §9)."""

from rest_framework import exceptions
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None  # unhandled -> Django 500

    code = getattr(exc, "default_code", "error")
    if isinstance(exc, exceptions.APIException) and isinstance(exc.get_codes(), str):
        code = exc.get_codes()

    data = response.data
    error = {"code": code, "message": str(getattr(exc, "detail", "Request failed"))}
    if isinstance(exc, exceptions.ValidationError) and isinstance(data, dict):
        error["code"] = "invalid"
        error["message"] = "Some fields are invalid."
        error["fields"] = data
    elif isinstance(data, dict) and "detail" in data:
        error["message"] = str(data["detail"])

    response.data = {"error": error}
    return response
