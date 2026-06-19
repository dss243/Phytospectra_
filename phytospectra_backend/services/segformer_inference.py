"""
services/segformer_inference.py

SegFormer-B0 inference — aligned with segformer_boxfill + predict_single.py.

Preprocessing matches training exactly:
  - RGN input  : [R, G, NDVI_uint8] stacked as RGB
  - Processor  : SegformerImageProcessor(do_resize=False, do_rescale=True,
                                         do_normalize=True)
  - Image size : resize whole image to IMG_SIZE=256, single forward pass
  - Upsampling : bilinear upsample logits back to original resolution

Display (predict_single.py behaviour):
  - Model prediction is overlaid on the original image (natural colour)
  - Soil pixels (NDVI below threshold) keep the original image — no green/red
  - Only healthy / stressed vegetation pixels are colour-blended
"""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import (
    SegformerForSemanticSegmentation,
    SegformerImageProcessor,
)

from core.config import settings

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parent.parent

# ── Constants — must match training / predict_single.py ─────────────────────
_SEGFORMER_BACKBONE = "nvidia/mit-b0"
_MODEL_PATH = _BACKEND_ROOT / "models" / "segformer_b0_boxfill.pt"
_IMG_SIZE = 256
_NUM_LABELS = 2
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
IGNORE_LABEL = 255

_SEG_CLASSES: dict[int, str] = {0: "healthy", 1: "stressed"}

_CLASS_COLORS: dict[int, np.ndarray] = {
    0: np.array([46, 204, 113], dtype=np.uint8),   # healthy  → green
    1: np.array([231, 76, 60], dtype=np.uint8),    # stressed → red
}

# Soil: NDVI below this → original image colour (no overlay). Matches predict_single.
SOIL_NDVI_THRESHOLD: float = 0.10
OVERLAY_ALPHA: float = 0.55

# Image-level class: match analytics tiers (mild stress starts below 55% healthy veg).
_DEFAULT_HEALTHY_CLASS_THRESHOLD = 55.0


def healthy_class_threshold_pct() -> float:
    return float(
        getattr(settings, "SEGFORMER_HEALTHY_CLASS_PCT", _DEFAULT_HEALTHY_CLASS_THRESHOLD)
    )


def stress_alert_threshold_pct() -> float:
    """Alert when stressed vegetation >= this % (all images, from settings)."""
    return float(getattr(settings, "STRESS_ALERT_STRESSED_PCT", 30.0))


def normalize_segformer_stats(row: dict) -> dict:
    """Normalize stats dict from run_segformer or a DB row — any image."""
    h = row.get("healthy_pixel_count")
    s = row.get("stressed_pixel_count")
    stressed_pct = row.get("stressed_percentage")
    health_score = row.get("health_score")
    if h is not None and s is not None:
        try:
            total = int(h) + int(s)
            if total > 0:
                if stressed_pct is None:
                    stressed_pct = round(int(s) / total * 100, 2)
                if health_score is None:
                    health_score = round(int(h) / total * 100, 2)
        except (TypeError, ValueError):
            pass
    return {
        "stress_class": row.get("stress_class"),
        "health_score": health_score,
        "stressed_percentage": stressed_pct,
        "healthy_pixel_count": h,
        "stressed_pixel_count": s,
    }


def should_send_stress_alert(stats: dict) -> bool:
    """
    True when stressed vegetation >= STRESS_ALERT_STRESSED_PCT (default 30%).
    Same rule for every SegFormer image — no per-file exceptions.
    """
    stats = normalize_segformer_stats(stats)
    threshold = stress_alert_threshold_pct()
    stressed_pct = stats.get("stressed_percentage")
    if stressed_pct is not None:
        try:
            return float(stressed_pct) >= threshold
        except (TypeError, ValueError):
            pass
    health = stats.get("health_score")
    if health is not None:
        try:
            return float(health) <= (100.0 - threshold)
        except (TypeError, ValueError):
            pass
    return stats.get("stress_class") == "stressed"

_RGN_RED_IDX = 0
_RGN_NIR_IDX = 2


def _default_soil_threshold() -> float:
    return float(getattr(settings, "SEGFORMER_NDVI_THRESHOLD", SOIL_NDVI_THRESHOLD))


def _default_overlay_alpha() -> float:
    return float(getattr(settings, "SEGFORMER_OVERLAY_ALPHA", OVERLAY_ALPHA))


def _default_max_side() -> int:
    """Longest edge for inference overlay (0 = full resolution, slow on CPU)."""
    return int(getattr(settings, "SEGFORMER_MAX_SIDE", 1536))


def _prepare_working_arrays(
    raw_arr: np.ndarray,
    max_side: int,
) -> tuple[np.ndarray, np.ndarray, int, int, bool]:
    """
    Downscale large MAPIR frames before upsample/overlay on CPU.
    Model still runs at 256×256; only post-processing resolution is capped.
    """
    h, w = raw_arr.shape[:2]
    if max_side <= 0 or max(h, w) <= max_side:
        return raw_arr, _compute_ndvi_rgn(raw_arr), w, h, False

    scale = max_side / max(h, w)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    u8 = raw_arr[:, :, :3].clip(0, 255).astype(np.uint8)
    resized = np.array(
        Image.fromarray(u8, mode="RGB").resize((nw, nh), Image.BILINEAR),
        dtype=np.float32,
    )
    logger.info(
        "SegFormer working size %dx%d (source %dx%d, max_side=%d)",
        nw, nh, w, h, max_side,
    )
    return resized, _compute_ndvi_rgn(resized), nw, nh, True

def _compute_ndvi_rgn(arr: np.ndarray) -> np.ndarray:
    """arr: H×W×C float32. NIR is in the blue slot (channel index 2)."""
    red = arr[:, :, _RGN_RED_IDX].astype(np.float32)
    nir = arr[:, :, _RGN_NIR_IDX].astype(np.float32)
    return ((nir - red) / (nir + red + 1e-6)).clip(-1.0, 1.0)


def _ndvi_to_uint8(ndvi: np.ndarray) -> np.ndarray:
    return ((ndvi + 1.0) * 127.5).clip(0, 255).astype(np.uint8)


def _build_rgn_input(arr: np.ndarray) -> np.ndarray:
    """[R, G, NDVI_uint8] — identical to open_model_input() in predict_single.py."""
    ndvi_u8 = _ndvi_to_uint8(_compute_ndvi_rgn(arr))
    return np.stack([
        arr[:, :, _RGN_RED_IDX].clip(0, 255).astype(np.uint8),
        arr[:, :, 1].clip(0, 255).astype(np.uint8),
        ndvi_u8,
    ], axis=-1)


def _load_raw_array(image_path: str) -> np.ndarray:
    """Load image as H×W×3 float32 RGB (tifffile or PIL)."""
    path = Path(image_path)
    try:
        import tifffile
        arr = tifffile.imread(str(path)).astype(np.float32)
        if arr.ndim == 2:
            arr = np.stack([arr, arr, arr], axis=-1)
        if arr.ndim == 3 and arr.shape[0] in (1, 3):
            arr = np.transpose(arr, (1, 2, 0))
        return arr[:, :, :3]
    except Exception:
        return np.array(Image.open(path).convert("RGB")).astype(np.float32)


def _open_as_rgn_pil(
    image_path: str,
) -> tuple[Image.Image, np.ndarray, np.ndarray]:
    """
    Returns
    -------
    pil_model_in : PIL RGB [R, G, NDVI_uint8] for the model
    raw_arr      : float32 H×W×3 as stored
    ndvi         : float32 H×W NDVI in [-1, 1]
    """
    raw_arr = _load_raw_array(image_path)
    ndvi = _compute_ndvi_rgn(raw_arr)
    rgn_uint8 = _build_rgn_input(raw_arr)
    return Image.fromarray(rgn_uint8, mode="RGB"), raw_arr, ndvi


def _raw_display_rgb(raw_arr: np.ndarray) -> np.ndarray:
    """Original image for overlay — no channel manipulation (predict_single)."""
    return raw_arr[:, :, :3].clip(0, 255).astype(np.uint8)


def _soil_mask(ndvi: np.ndarray, threshold: float) -> np.ndarray:
    """True where pixel is soil (low NDVI). Matches compute_ndvi_mask()."""
    return ndvi < threshold


# ── Model loader ──────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _load_segformer() -> tuple[
    SegformerForSemanticSegmentation, SegformerImageProcessor
]:
    if not _MODEL_PATH.exists():
        raise FileNotFoundError(
            f"SegFormer weights not found at {_MODEL_PATH.resolve()}.\n"
            "Place segformer_b0_boxfill.pt in the models/ folder."
        )
    logger.info("Loading SegFormer from %s on %s", _MODEL_PATH, _DEVICE)

    processor = SegformerImageProcessor.from_pretrained(
        _SEGFORMER_BACKBONE,
        do_resize=False,
        do_rescale=True,
        do_normalize=True,
    )
    model = SegformerForSemanticSegmentation.from_pretrained(
        _SEGFORMER_BACKBONE,
        num_labels=_NUM_LABELS,
        id2label=_SEG_CLASSES,
        label2id={v: k for k, v in _SEG_CLASSES.items()},
        ignore_mismatched_sizes=True,
    )
    state = torch.load(_MODEL_PATH, map_location=_DEVICE)
    if isinstance(state, dict) and "model_state_dict" in state:
        state = state["model_state_dict"]
    missing, unexpected = model.load_state_dict(state, strict=True)
    if unexpected:
        logger.warning("SegFormer unexpected keys: %s", unexpected[:5])
    model.to(_DEVICE).eval()

    logger.info("SegFormer model ready (%s)", _DEVICE)
    return model, processor


def preload_segformer() -> None:
    """Warm up model at app startup so the first request is fast."""
    _load_segformer()


# ── Inference — single resize + forward pass ──────────────────────────────────

@torch.no_grad()
def _run_forward(pil_model_in: Image.Image) -> np.ndarray:
    """Raw model prediction (0/1) at original resolution — not modified for soil."""
    model, processor = _load_segformer()
    orig_W, orig_H = pil_model_in.size

    pil_resized = pil_model_in.resize((_IMG_SIZE, _IMG_SIZE), Image.BILINEAR)
    encoding = processor(
        images=pil_resized,
        return_tensors="pt",
        do_resize=False,
    )
    pixel_values = encoding["pixel_values"].to(_DEVICE)

    logits = model(pixel_values=pixel_values).logits
    logits_up = F.interpolate(
        logits,
        size=(orig_H, orig_W),
        mode="bilinear",
        align_corners=False,
    )
    return logits_up.argmax(dim=1).squeeze(0).cpu().numpy().astype(np.uint8)


# ── Overlay + stats (predict_single.py) ───────────────────────────────────────

def _build_overlay(
    img_np: np.ndarray,
    mask_np: np.ndarray,
    soil_mask: np.ndarray,
    alpha: float = OVERLAY_ALPHA,
) -> np.ndarray:
    """
    Blend class colours only on vegetation pixels.
    Soil pixels keep the original natural image colour.
    """
    colour = np.zeros_like(img_np)
    for cls_id, color in _CLASS_COLORS.items():
        colour[mask_np == cls_id] = color

    labelled = (mask_np == 0) | (mask_np == 1)
    labelled = labelled & ~soil_mask

    out = img_np.copy().astype(np.float32)
    out[labelled] = (
        alpha * colour[labelled].astype(np.float32)
        + (1.0 - alpha) * img_np[labelled].astype(np.float32)
    )
    return out.clip(0, 255).astype(np.uint8)


def _class_map_for_storage(
    pred_mask: np.ndarray,
    soil_mask: np.ndarray,
) -> np.ndarray:
    """Canonical class map: 0/1 on vegetation, IGNORE_LABEL on soil."""
    out = pred_mask.copy()
    out[soil_mask] = IGNORE_LABEL
    return out


def _label_counts(class_map: np.ndarray) -> dict[str, int]:
    unique, counts = np.unique(class_map, return_counts=True)
    return {str(int(u)): int(c) for u, c in zip(unique, counts)}


def _compute_stats(
    pred_mask: np.ndarray,
    soil_mask: np.ndarray,
    soil_threshold: float,
) -> dict[str, Any]:
    """Health metrics over vegetation pixels only (soil excluded)."""
    veg = ~soil_mask
    total_veg = int(veg.sum())
    healthy = int(((pred_mask == 0) & veg).sum())
    stressed = int(((pred_mask == 1) & veg).sum())
    soil_px = int(soil_mask.sum())

    health_pct = round(healthy / total_veg * 100, 2) if total_veg > 0 else 0.0
    stressed_pct = round(stressed / total_veg * 100, 2) if total_veg > 0 else 0.0
    healthy_threshold = healthy_class_threshold_pct()
    if health_pct >= healthy_threshold:
        stress_class = "healthy"
        confidence = round(healthy / total_veg, 4) if total_veg > 0 else 0.0
    else:
        stress_class = "stressed"
        confidence = round(stressed / total_veg, 4) if total_veg > 0 else 0.0

    alert_worthy = should_send_stress_alert({
        "health_score": health_pct,
        "stressed_percentage": stressed_pct,
        "stress_class": stress_class,
        "healthy_pixel_count": healthy,
        "stressed_pixel_count": stressed,
    })

    return {
        "healthy_pixel_count": healthy,
        "stressed_pixel_count": stressed,
        "background_pixel_count": soil_px,
        "vegetation_pixel_count": total_veg,
        "health_percentage": health_pct,
        "stressed_percentage": stressed_pct,
        "health_score": health_pct,
        "stress_class": stress_class,
        "confidence": confidence,
        "alert_worthy": alert_worthy,
        "ndvi_threshold_used": soil_threshold,
    }


# ── Public API ────────────────────────────────────────────────────────────────

_USE_DEFAULT_SOIL = object()


def run_segformer(
    image_path: str,
    ndvi_threshold: float | None = _USE_DEFAULT_SOIL,  # type: ignore[assignment]
    overlay_alpha: float | None = None,
) -> dict[str, Any]:
    """
    Run SegFormer on any image file (MAPIR TIFF/JPEG, gallery upload, ESP32, etc.).

    Same model, preprocessing, health/stress stats, and alert thresholds for every
    image — identical pipeline to predict_single.py in the notebook.
    """
    if ndvi_threshold is _USE_DEFAULT_SOIL:
        soil_threshold = _default_soil_threshold()
    else:
        soil_threshold = ndvi_threshold

    alpha = overlay_alpha if overlay_alpha is not None else _default_overlay_alpha()
    max_side = _default_max_side()

    t_load = time.perf_counter()
    raw_full = _load_raw_array(image_path)
    raw_arr, ndvi, work_w, work_h, was_scaled = _prepare_working_arrays(raw_full, max_side)
    rgn_uint8 = _build_rgn_input(raw_arr)
    pil_model_in = Image.fromarray(rgn_uint8, mode="RGB")
    img_np = _raw_display_rgb(raw_arr)
    logger.info(
        "run_segformer load %.2fs | %s | work=%dx%d scaled=%s",
        time.perf_counter() - t_load,
        Path(image_path).name,
        work_w,
        work_h,
        was_scaled,
    )

    if soil_threshold is not None:
        soil = _soil_mask(ndvi, soil_threshold)
    else:
        soil = np.zeros(ndvi.shape, dtype=bool)

    t0 = time.perf_counter()
    pred_mask = _run_forward(pil_model_in)
    t_infer = time.perf_counter() - t0

    t1 = time.perf_counter()
    overlay = _build_overlay(img_np, pred_mask, soil, alpha=alpha)
    mask_image = Image.fromarray(overlay, "RGB")
    t_overlay = time.perf_counter() - t1

    class_map = _class_map_for_storage(pred_mask, soil)
    stats = _compute_stats(
        pred_mask,
        soil,
        soil_threshold if soil_threshold is not None else SOIL_NDVI_THRESHOLD,
    )

    logger.info(
        "run_segformer done infer=%.2fs overlay=%.2fs device=%s | veg=%d stressed=%d",
        t_infer,
        t_overlay,
        _DEVICE,
        stats["healthy_pixel_count"],
        stats["stressed_pixel_count"],
    )

    return {
        "class_map": class_map,
        "pred_mask": pred_mask,
        "mask_image": mask_image,
        "label_counts": _label_counts(class_map),
        **stats,
    }


def visualise_prediction(
    image_path: str,
    label_path: str | None = None,
    save_path: str | None = None,
) -> np.ndarray:
    """
    Three-panel figure like predict_single.py:
    original | (optional GT) | prediction overlay.
    """
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches

    soil_threshold = _default_soil_threshold()
    alpha = _default_overlay_alpha()

    pil_model_in, raw_arr, ndvi = _open_as_rgn_pil(image_path)
    img_np = _raw_display_rgb(raw_arr)
    soil = _soil_mask(ndvi, soil_threshold)
    pred_mask = _run_forward(pil_model_in)
    pred_overlay = _build_overlay(img_np, pred_mask, soil, alpha=alpha)

    n_cols = 2
    fig, axes = plt.subplots(1, n_cols, figsize=(6 * n_cols, 6))

    axes[0].imshow(img_np)
    axes[0].set_title("Original Image", fontsize=13, fontweight="bold")
    axes[0].axis("off")

    axes[1].imshow(pred_overlay)
    axes[1].set_title("Model Prediction", fontsize=13, fontweight="bold")
    axes[1].axis("off")

    legend = [
        mpatches.Patch(
            color=tuple(c / 255 for c in _CLASS_COLORS[0]),
            label="Healthy",
        ),
        mpatches.Patch(
            color=tuple(c / 255 for c in _CLASS_COLORS[1]),
            label="Stressed",
        ),
    ]
    axes[1].legend(handles=legend, loc="lower right", fontsize=11, framealpha=0.8)

    plt.suptitle(Path(image_path).name, fontsize=12, fontweight="bold", y=1.01)
    plt.tight_layout()

    if save_path:
        plt.savefig(save_path, dpi=150, bbox_inches="tight")
        print(f"Saved -> {save_path}")
    else:
        plt.show()

    total = pred_mask.size
    veg = ~soil
    print("\nPrediction breakdown (vegetation only):")
    for c in range(_NUM_LABELS):
        n = int(((pred_mask == c) & veg).sum())
        print(f"  {_SEG_CLASSES[c]:10s}: {n:>8,} px  ({100 * n / max(1, veg.sum()):.1f}%)")
    print(f"  {'soil':10s}: {int(soil.sum()):>8,} px  ({100 * soil.mean():.1f}%)")

    return pred_mask
