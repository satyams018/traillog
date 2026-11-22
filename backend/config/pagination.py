from rest_framework.pagination import CursorPagination


class CreatedAtCursorPagination(CursorPagination):
    """Stable cursor paging (no page-number skips when rows are added). Newest first."""

    ordering = "-created_at"
    page_size = 20
