import logging

logger = logging.getLogger(__name__)


def extract_gps_from_exif(image_path: str) -> dict | None:
    """
    Real GPS from image metadata only — never synthetic/random coords.
    Tries EXIF first, then GeoTIFF georeferencing (MAPIR / drone TIFF).
    """
    from services.gps_utils import extract_gps_from_exif_strict

    gps = extract_gps_from_exif_strict(image_path)
    if gps:
        return gps

    gps = _gps_from_geotiff(image_path)
    if gps:
        logger.info("GPS from GeoTIFF tags: %s -> %s", image_path, gps)
        return gps

    logger.info("No GPS in image metadata: %s", image_path)
    return None


def _gps_from_geotiff(image_path: str) -> dict | None:
    """Center-pixel WGS84 from GeoTIFF CRS/transform (common on MAPIR exports)."""
    try:
        import rasterio
        from rasterio.warp import transform as warp_transform

        with rasterio.open(image_path) as src:
            if src.crs is None:
                return None
            row = src.height // 2
            col = src.width // 2
            x, y = rasterio.transform.xy(src.transform, row, col, offset="center")
            crs_str = src.crs.to_string()
            if crs_str == "EPSG:4326":
                lng, lat = float(x), float(y)
            else:
                lngs, lats = warp_transform(src.crs, "EPSG:4326", [float(x)], [float(y)])
                lng, lat = float(lngs[0]), float(lats[0])
            if abs(lat) > 90 or abs(lng) > 180:
                return None
            return {"lat": round(lat, 6), "lng": round(lng, 6)}
    except Exception as e:
        logger.debug("GeoTIFF GPS lookup failed for %s: %s", image_path, e)
    return None


def calibrate_image(image_path: str) -> dict:
    """
    Legacy function kept for backward compatibility.
    Actual calibration is now handled in pipeline._load_image_as_bands().
    """
    import numpy as np
    import rasterio

    with rasterio.open(image_path) as src:
        logger.info(
            "Opening: %s | Bands: %s | Size: %sx%s",
            image_path,
            src.count,
            src.width,
            src.height,
        )
        red = src.read(1).astype("float32")
        green = src.read(2).astype("float32")
        nir = src.read(3).astype("float32") if src.count >= 3 else src.read(1).astype("float32")

    max_val = 65535.0 if red.max() > 255 else 255.0
    red = np.clip(red / max_val, 0, 1)
    green = np.clip(green / max_val, 0, 1)
    nir = np.clip(nir / max_val, 0, 1)

    logger.info("Calibrated | Red mean: %.3f | NIR mean: %.3f", red.mean(), nir.mean())
    return {"red": red, "green": green, "nir": nir}
