import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import logging
import os

logger = logging.getLogger(__name__)


def compute_ndvi(red, nir):
    np.seterr(divide='ignore', invalid='ignore')
    ndvi = np.where((nir + red) == 0, 0, (nir - red) / (nir + red))
    return np.clip(np.nan_to_num(ndvi, nan=0.0), -1, 1).astype('float32')


def compute_gndvi(green, nir):
    np.seterr(divide='ignore', invalid='ignore')
    gndvi = np.where((nir + green) == 0, 0, (nir - green) / (nir + green))
    return np.clip(np.nan_to_num(gndvi, nan=0.0), -1, 1).astype('float32')


def compute_health_score(ndvi) -> float:
    vegetated = ndvi[ndvi > 0.05]
    mean_ndvi = float(np.mean(vegetated)) if len(vegetated) > 0 else float(np.mean(ndvi))
    score = (mean_ndvi / 0.9) * 100
    return round(min(max(score, 0.0), 100.0), 1)


def get_stress_label(health_score: float) -> str:
    if health_score >= 65: return "healthy"
    if health_score >= 45: return "mild_stress"
    if health_score >= 25: return "moderate_stress"
    return "severe_stress"


def generate_heatmap_png(ndvi, output_path: str) -> str:
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Force clean numpy array
    ndvi = np.array(ndvi, dtype=np.float32)
    ndvi = np.nan_to_num(ndvi, nan=0.0, posinf=0.85, neginf=-0.1)
    ndvi = np.clip(ndvi, -1, 1)

    try:
        colors = [
            (0.0,  '#ef4444'),
            (0.25, '#f97316'),
            (0.50, '#eab308'),
            (0.75, '#22c55e'),
            (1.0,  '#16a34a'),
        ]
        cmap = mcolors.LinearSegmentedColormap.from_list(
            'cropsense', [(v, c) for v, c in colors]
        )
        fig, ax = plt.subplots(figsize=(10, 8), dpi=150)
        im = ax.imshow(ndvi, cmap=cmap, vmin=-0.1, vmax=0.85, interpolation='bilinear')
        cbar = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
        cbar.set_label('Vegetation Health Index', fontsize=10)
        ax.set_title('Crop Health Heatmap', fontsize=13, fontweight='bold', pad=12)
        ax.axis('off')
        plt.tight_layout()
        plt.savefig(output_path, dpi=150, bbox_inches='tight',
                    facecolor='white', edgecolor='none', pad_inches=0.1)
        plt.close(fig)
        logger.info(f"Heatmap saved: {output_path}")
        return output_path

    except Exception as e:
        logger.error(f"Matplotlib heatmap failed: {e}")
        plt.close('all')  # clean up any open figures

        try:
            import cv2
            # Explicitly convert to proper uint8 numpy array
            ndvi_norm = ((ndvi + 1) / 2 * 255)
            ndvi_norm = np.array(ndvi_norm, dtype=np.uint8)  # ← key fix
            colored   = cv2.applyColorMap(ndvi_norm, cv2.COLORMAP_JET)
            cv2.imwrite(output_path, colored)
            logger.warning("Used OpenCV fallback for heatmap")
            return output_path

        except Exception as cv_err:
            logger.error(f"OpenCV fallback also failed: {cv_err}")
            # Last resort — save raw grayscale with PIL
            from PIL import Image
            ndvi_norm = np.array(((ndvi + 1) / 2 * 255), dtype=np.uint8)
            Image.fromarray(ndvi_norm, mode='L').save(output_path)
            logger.warning("Used PIL grayscale as last resort heatmap")
            return output_path