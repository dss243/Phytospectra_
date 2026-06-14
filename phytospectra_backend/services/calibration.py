import numpy as np
import logging
import random

logger = logging.getLogger(__name__)


def extract_gps_from_exif(image_path: str) -> dict:
    """Extract GPS coordinates from image EXIF data, or return default coords."""
    default = {
        'lat': round(36.48 + random.uniform(-0.05, 0.05), 6),
        'lng': round(2.95  + random.uniform(-0.05, 0.05), 6)
    }
    try:
        import exifread
        with open(image_path, 'rb') as f:
            tags = exifread.process_file(f, stop_tag='GPS')

        def to_decimal(vals):
            d = float(vals[0].num) / float(vals[0].den)
            m = float(vals[1].num) / float(vals[1].den)
            s = float(vals[2].num) / float(vals[2].den)
            return d + m / 60 + s / 3600

        if 'GPS GPSLatitude' in tags and 'GPS GPSLongitude' in tags:
            lat = to_decimal(tags['GPS GPSLatitude'].values)
            lng = to_decimal(tags['GPS GPSLongitude'].values)
            if tags.get('GPS GPSLatitudeRef',  'N').values == 'S': lat = -lat
            if tags.get('GPS GPSLongitudeRef', 'E').values == 'W': lng = -lng
            return {'lat': round(lat, 6), 'lng': round(lng, 6)}

    except Exception as e:
        logger.warning(f"EXIF extraction failed: {e}. Using default coords.")

    return default


def calibrate_image(image_path: str) -> dict:
    """
    Legacy function kept for backward compatibility.
    Actual calibration is now handled in pipeline._load_image_as_bands().
    """
    import rasterio
    with rasterio.open(image_path) as src:
        logger.info(f"Opening: {image_path} | Bands: {src.count} | Size: {src.width}x{src.height}")
        red   = src.read(1).astype('float32')
        green = src.read(2).astype('float32')
        nir   = src.read(3).astype('float32') if src.count >= 3 else src.read(1).astype('float32')

    max_val = 65535.0 if red.max() > 255 else 255.0
    red   = np.clip(red   / max_val, 0, 1)
    green = np.clip(green / max_val, 0, 1)
    nir   = np.clip(nir   / max_val, 0, 1)

    logger.info(f"Calibrated | Red mean: {red.mean():.3f} | NIR mean: {nir.mean():.3f}")
    return {'red': red, 'green': green, 'nir': nir}