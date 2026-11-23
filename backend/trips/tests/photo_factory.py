"""Builds small JPEGs with chosen EXIF (time, offset, GPS, orientation) for tests."""

import io
from fractions import Fraction

from PIL import ExifTags, Image


def _dms(value: float):
    value = abs(value)
    d = int(value)
    m = int((value - d) * 60)
    s = Fraction((value - d - m / 60) * 3600).limit_denominator(10000)
    return (float(d), float(m), float(s))


def make_jpeg(
    *,
    when: str | None = "2026:05:10 08:04:10",
    offset: str | None = None,
    gps: tuple[float, float] | None = None,
    orientation: int | None = None,
    size: tuple[int, int] = (320, 200),
) -> bytes:
    img = Image.new("RGB", size, (90, 140, 80))
    exif = Image.Exif()
    exif[ExifTags.Base.Model] = "Test Cam"
    if orientation:
        exif[ExifTags.Base.Orientation] = orientation
    sub = exif.get_ifd(ExifTags.IFD.Exif)
    if when:
        sub[ExifTags.Base.DateTimeOriginal] = when
    if offset:
        sub[ExifTags.Base.OffsetTimeOriginal] = offset
    if gps:
        lat, lon = gps
        g = exif.get_ifd(ExifTags.IFD.GPSInfo)
        g[1] = "N" if lat >= 0 else "S"
        g[2] = _dms(lat)
        g[3] = "E" if lon >= 0 else "W"
        g[4] = _dms(lon)
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif, quality=85)
    return buf.getvalue()
