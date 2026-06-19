"""GPS normalization, strict EXIF extraction, and field boundary checks."""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


def normalize_gps(gps: Any) -> Optional[dict]:
    """Return {lat, lng} or None from images/segmentations gps JSON."""
    if not gps or not isinstance(gps, dict):
        return None
    lat = gps.get("lat", gps.get("latitude"))
    lng = gps.get("lng", gps.get("longitude"))
    if lat is None or lng is None:
        return None
    try:
        return {"lat": round(float(lat), 6), "lng": round(float(lng), 6)}
    except (TypeError, ValueError):
        return None


def extract_gps_from_exif_strict(image_path: str) -> Optional[dict]:
    """EXIF GPS only — no synthetic fallback."""
    try:
        import exifread
        with open(image_path, "rb") as f:
            tags = exifread.process_file(f, stop_tag="GPS")

        def to_decimal(vals):
            d = float(vals[0].num) / float(vals[0].den)
            m = float(vals[1].num) / float(vals[1].den)
            s = float(vals[2].num) / float(vals[2].den)
            return d + m / 60 + s / 3600

        if "GPS GPSLatitude" in tags and "GPS GPSLongitude" in tags:
            lat = to_decimal(tags["GPS GPSLatitude"].values)
            lng = to_decimal(tags["GPS GPSLongitude"].values)
            if tags.get("GPS GPSLatitudeRef", "N").values == "S":
                lat = -lat
            if tags.get("GPS GPSLongitudeRef", "E").values == "W":
                lng = -lng
            return {"lat": round(lat, 6), "lng": round(lng, 6)}
    except Exception as e:
        logger.warning(f"Strict EXIF GPS failed for {image_path}: {e}")
    return None


def _outer_ring(boundary: Any) -> Optional[list]:
    """GeoJSON Polygon geometry or Feature → outer ring [[lng, lat], ...]."""
    if not boundary or not isinstance(boundary, dict):
        return None
    geom = boundary
    if boundary.get("type") == "Feature":
        geom = boundary.get("geometry") or {}
    if geom.get("type") != "Polygon":
        coords = geom.get("coordinates")
        if isinstance(coords, list) and coords and isinstance(coords[0], list):
            ring = coords[0]
            if ring and isinstance(ring[0], (int, float)):
                return ring
        return None
    coords = geom.get("coordinates")
    if not coords or not isinstance(coords[0], list):
        return None
    return coords[0]


def point_in_boundary(lat: float, lng: float, boundary: Any) -> Optional[bool]:
    """Ray-casting; None if no boundary defined."""
    ring = _outer_ring(boundary)
    if not ring or len(ring) < 3:
        return None

    x, y = lng, lat
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = float(ring[i][0]), float(ring[i][1])
        xj, yj = float(ring[j][0]), float(ring[j][1])
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def health_bucket(score: Optional[float]) -> str:
    if score is None:
        return "unknown"
    if score >= 75:
        return "healthy"
    if score >= 55:
        return "mild"
    if score >= 35:
        return "moderate"
    return "severe"


def is_map_worthy_stress(
    health_score: Optional[float],
    stress_class: Optional[str],
) -> bool:
    """
    Map pins only: moderate + severe (health score under 55).
    Charts use chart_zone_bucket() and include all SegFormer results.
    """
    cls = (stress_class or "").lower()
    if cls == "healthy":
        return False
    if health_score is not None:
        try:
            return float(health_score) < 55
        except (TypeError, ValueError):
            pass
    if cls == "stressed":
        return True
    return False


def chart_zone_bucket(
    health_score: Optional[float],
    stress_class: Optional[str],
) -> str:
    """All SegFormer rows → health tier for analytics charts (not map pins)."""
    if health_score is not None:
        try:
            return health_bucket(float(health_score))
        except (TypeError, ValueError):
            pass
    cls = (stress_class or "").lower()
    if cls == "healthy":
        return "healthy"
    if cls == "stressed":
        return "moderate"
    return "unknown"


def stress_zone_bucket(
    health_score: Optional[float],
    stress_class: Optional[str],
) -> Optional[str]:
    """Map-worthy segmentation → moderate or severe bucket."""
    if not is_map_worthy_stress(health_score, stress_class):
        return None
    bucket = health_bucket(health_score)
    if bucket in ("moderate", "severe"):
        return bucket
    return "moderate"
