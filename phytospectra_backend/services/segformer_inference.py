"""
services/segformer_inference.py

SegFormer-B0 inference for flight-level segmentation.
Preprocessing matches segformer_v5_1 training script exactly:
  - RGN input: build_rgn_input() → [R, G, NDVI_uint8] stacked as RGB
  - NDVI: (NIR - Red) / (NIR + Red + 1e-6), NIR = channel index 2 (blue slot)
  - SegformerImageProcessor with do_resize=False, do_rescale=True, do_normalize=True
  - Patch size 512, overlap 64, soft-logit stitching

V5.1 PATCH — Global NDVI background removal:
  - Pixels with NDVI < NDVI_VEGETATION_THR are treated as background (soil/shadow/sky)
  - Background pixels are set to IGNORE_LABEL in the final class map
  - Applied after tiling inference, using the original raw float array

V5.2 PATCH — Largest-component background filtering:
  - After NDVI masking, only the single largest connected background region is kept
  - Smaller isolated background blobs are reassigned to the nearest vegetation class
    (healthy=0 or stressed=1) based on whichever dominates their local surroundings
  - Eliminates noise specks that pass the NDVI threshold but are not true background
"""

from __future__ import annotations

import io
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

# ── Config — must match training script ──────────────────────────────────────
_MODEL_PATH  = _BACKEND_ROOT / "models" / "segformer_b0_v5_1.pt"
_PATCH_SIZE  = 512
_DEVICE      = "cuda" if torch.cuda.is_available() else "cpu"
_NUM_LABELS  = 2

_SEG_CLASSES = {0: "healthy", 1: "stressed"}

# Palette matches training script PALETTE exactly
_PALETTE: dict[int, tuple[int, int, int]] = {
    0: (46,  204, 113),   # healthy  — green
    1: (231,  76,  60),   # stressed — red
}

# Background / ignored pixels rendered as white in the colour mask
_BACKGROUND_COLOUR = (255, 255, 255)

# RGN channel indices (training script constants)
_RGN_RED_IDX = 0
_RGN_NIR_IDX = 2   # blue slot holds NIR in RGN imagery

# ── V5.1 PATCH — Global NDVI background threshold ────────────────────────────
# Pixels whose NDVI falls below this value are classified as background
# and excluded from the output (set to IGNORE_LABEL = 255).
# Tune for your dataset: 0.10 suits dense canopy; raise to 0.15–0.20
# if bare soil bleeds into vegetation predictions.
NDVI_VEGETATION_THR = 0.10
IGNORE_LABEL        = 255   # matches training IGNORE_INDEX


# ── Preprocessing helpers (exact copy from training script) ──────────────────

def _compute_ndvi_rgn(arr: np.ndarray) -> np.ndarray:
    """arr: HxWxC float32.  NIR is in the blue slot (index 2)."""
    red = arr[:, :, _RGN_RED_IDX].astype(np.float32)
    nir = arr[:, :, _RGN_NIR_IDX].astype(np.float32)
    return ((nir - red) / (nir + red + 1e-6)).clip(-1.0, 1.0)


def _ndvi_to_uint8(ndvi: np.ndarray) -> np.ndarray:
    return ((ndvi + 1.0) * 127.5).clip(0, 255).astype(np.uint8)


def _build_rgn_input(arr: np.ndarray) -> np.ndarray:
    """
    Convert raw image array → 3-channel uint8 [R, G, NDVI_uint8].
    Matches training script build_rgn_input() exactly.
    """
    ndvi_u8 = _ndvi_to_uint8(_compute_ndvi_rgn(arr))
    return np.stack([
        arr[:, :, _RGN_RED_IDX].clip(0, 255).astype(np.uint8),
        arr[:, :, 1].clip(0, 255).astype(np.uint8),
        ndvi_u8,
    ], axis=-1)


def _open_as_rgn_pil(image_path: str) -> tuple[Image.Image, np.ndarray, np.ndarray]:
    """
    Open an image (TIFF or RGB), apply RGN preprocessing.

    Returns:
        pil_img  : PIL RGB image with [R, G, NDVI_uint8] channels
        arr      : raw float32 array (H×W×3)
        ndvi     : float32 NDVI map (H×W), range [-1, 1]
    """
    path = Path(image_path)
    arr: np.ndarray

    # Try tifffile first (handles multi-band TIFFs)
    try:
        import tifffile
        arr = tifffile.imread(str(path)).astype(np.float32)
        if arr.ndim == 2:
            arr = np.stack([arr, arr, arr], axis=-1)
        if arr.ndim == 3 and arr.shape[0] in (1, 3):
            arr = np.transpose(arr, (1, 2, 0))
        arr = arr[:, :, :3]
    except Exception:
        arr = np.array(Image.open(path).convert("RGB")).astype(np.float32)

    ndvi      = _compute_ndvi_rgn(arr)          # H×W float32, kept for background mask
    rgn_uint8 = _build_rgn_input(arr)
    return Image.fromarray(rgn_uint8, mode="RGB"), arr, ndvi


# ── Model loader (singleton, thread-safe via lru_cache) ─────────────────────

@lru_cache(maxsize=1)
def _load_segformer() -> tuple[SegformerForSemanticSegmentation, SegformerImageProcessor]:
    if not _MODEL_PATH.exists():
        raise FileNotFoundError(
            f"SegFormer weights not found at {_MODEL_PATH.resolve()}. "
            "Place segformer_b0_v5_1.pt in the models/ folder."
        )
    logger.info(f"Loading SegFormer from {_MODEL_PATH} on {_DEVICE}")

    processor = SegformerImageProcessor.from_pretrained(
        "nvidia/mit-b0",
        do_resize=False,
        do_rescale=True,
        do_normalize=True,
    )

    model = SegformerForSemanticSegmentation.from_pretrained(
        "nvidia/mit-b0",
        num_labels=_NUM_LABELS,
        id2label=_SEG_CLASSES,
        label2id={v: k for k, v in _SEG_CLASSES.items()},
        ignore_mismatched_sizes=True,
    )
    state = torch.load(_MODEL_PATH, map_location=_DEVICE)
    if isinstance(state, dict) and "model_state_dict" in state:
        state = state["model_state_dict"]
    model.load_state_dict(state, strict=False)
    model.to(_DEVICE).eval()

    logger.info("SegFormer model ready")
    return model, processor


def preload_segformer() -> None:
    """Load weights at startup so the first gallery segmentation is faster."""
    _load_segformer()


def _tile_overlap() -> int:
    if _DEVICE == "cpu":
        return settings.SEGFORMER_TILE_OVERLAP
    return 64


def _tile_batch_size() -> int:
    if _DEVICE == "cpu":
        return max(1, settings.SEGFORMER_TILE_BATCH)
    return 8


def _maybe_downscale(
    pil_img: Image.Image, ndvi: np.ndarray, max_side: int
) -> tuple[Image.Image, np.ndarray]:
    w, h = pil_img.size
    longest = max(w, h)
    if longest <= max_side:
        return pil_img, ndvi
    scale = max_side / longest
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    logger.info("Inference downscale: %dx%d → %dx%d (max_side=%d)", w, h, nw, nh, max_side)
    pil_out = pil_img.resize((nw, nh), Image.BILINEAR)
    ndvi_u8 = ((ndvi + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
    ndvi_out = np.array(Image.fromarray(ndvi_u8).resize((nw, nh), Image.BILINEAR)).astype(
        np.float32
    )
    ndvi_out = (ndvi_out / 127.5) - 1.0
    return pil_out, ndvi_out


# ── Core tiling inference ─────────────────────────────────────────────────────

@torch.no_grad()
def _segment_pil(pil_img: Image.Image) -> np.ndarray:
    """
    Tile a PIL image, run SegFormer on batched patches, stitch soft logits.
    Returns (H, W) uint8 class-index array.
    """
    model, processor = _load_segformer()
    W, H = pil_img.size
    img_np = np.array(pil_img.convert("RGB"))

    overlap = _tile_overlap()
    step = _PATCH_SIZE - overlap
    batch_size = _tile_batch_size()

    logit_acc = np.zeros((_NUM_LABELS, H, W), dtype=np.float32)
    count_acc = np.zeros((H, W), dtype=np.float32)

    tiles: list[tuple[int, int, int, int, Image.Image]] = []
    for r in range(0, H, step):
        for c in range(0, W, step):
            r1, r2 = r, min(r + _PATCH_SIZE, H)
            c1, c2 = c, min(c + _PATCH_SIZE, W)
            ph, pw = r2 - r1, c2 - c1
            patch = img_np[r1:r2, c1:c2]
            if ph < _PATCH_SIZE or pw < _PATCH_SIZE:
                pad = np.zeros((_PATCH_SIZE, _PATCH_SIZE, 3), dtype=np.uint8)
                pad[:ph, :pw] = patch
                patch = pad
            tiles.append((r1, r2, c1, c2, Image.fromarray(patch)))

    n_tiles = len(tiles)
    t0 = time.perf_counter()
    for i in range(0, n_tiles, batch_size):
        batch = tiles[i : i + batch_size]
        patch_pils = [t[4] for t in batch]
        encoding = processor(images=patch_pils, return_tensors="pt", do_resize=False)
        pixel_values = encoding["pixel_values"].to(_DEVICE)

        out = model(pixel_values=pixel_values)
        logits = F.interpolate(
            out.logits,
            size=(_PATCH_SIZE, _PATCH_SIZE),
            mode="bilinear",
            align_corners=False,
        )

        for j, (r1, r2, c1, c2, _) in enumerate(batch):
            ph, pw = r2 - r1, c2 - c1
            logits_np = logits[j].cpu().numpy()
            logit_acc[:, r1:r2, c1:c2] += logits_np[:, :ph, :pw]
            count_acc[r1:r2, c1:c2] += 1.0

    elapsed = time.perf_counter() - t0
    logger.info(
        "SegFormer tiles: %d (batch=%d, overlap=%d, %dx%d) in %.1fs on %s",
        n_tiles, batch_size, overlap, W, H, elapsed, _DEVICE,
    )

    count_acc = np.where(count_acc == 0, 1, count_acc)
    logit_acc /= count_acc[np.newaxis]

    return logit_acc.argmax(axis=0).astype(np.uint8)


# ── V5.1 PATCH — Global NDVI background removal ───────────────────────────────

def _apply_ndvi_background_mask(
    class_map: np.ndarray,
    ndvi: np.ndarray,
    threshold: float = NDVI_VEGETATION_THR,
) -> np.ndarray:
    """
    Zero out predictions for non-vegetation pixels using a global NDVI threshold.

    Pixels with NDVI < threshold are considered background (soil / shadow / sky)
    and are set to IGNORE_LABEL (255) in the returned class map.

    Args:
        class_map : H×W uint8 array of predicted class indices
        ndvi      : H×W float32 NDVI map, range [-1, 1]
        threshold : NDVI cut-off below which pixels are treated as background

    Returns:
        masked class map (H×W uint8), background pixels = IGNORE_LABEL
    """
    masked = class_map.copy()
    background = ndvi < threshold        # True where pixel is NOT vegetation
    masked[background] = IGNORE_LABEL
    logger.debug(
        f"NDVI background mask: {background.sum():,} / {background.size:,} pixels "
        f"removed ({100 * background.mean():.1f}%)"
    )
    return masked


# ── V5.2 PATCH — Largest-component background filtering ──────────────────────

def _keep_largest_background(class_map: np.ndarray) -> np.ndarray:
    """
    Retain only the single largest connected region of IGNORE_LABEL (background).
    All smaller isolated background blobs are reassigned to the dominant vegetation
    class (healthy=0 or stressed=1) among their immediate 8-connected neighbours.

    This removes noise specks that passed the NDVI threshold but are clearly not
    part of the true continuous background region.

    Args:
        class_map : H×W uint8 array where IGNORE_LABEL=255 marks background pixels

    Returns:
        Updated class map (H×W uint8) with small background blobs reassigned.
    """
    from scipy.ndimage import label as ndi_label

    binary = (class_map == IGNORE_LABEL).astype(np.uint8)
    labeled, num_features = ndi_label(binary)

    if num_features <= 1:
        # Zero or one background region — nothing to clean up
        return class_map

    # Identify the largest connected background component
    sizes       = np.bincount(labeled.ravel())
    sizes[0]    = 0                          # index-0 is the non-background label
    largest_lbl = int(sizes.argmax())

    # Build mask of small (non-largest) background blobs
    small_bg = (labeled > 0) & (labeled != largest_lbl)
    if not small_bg.any():
        return class_map

    result = class_map.copy()

    # For each small blob, pick the dominant vegetation class in its neighbourhood.
    # We dilate the blob by 3 px and sample the surrounding vegetation pixels.
    from scipy.ndimage import binary_dilation

    small_labels = [lbl for lbl in range(1, num_features + 1) if lbl != largest_lbl]
    struct       = np.ones((3, 3), dtype=bool)   # 8-connectivity

    for lbl in small_labels:
        blob      = labeled == lbl
        dilated   = binary_dilation(blob, structure=struct, iterations=3)
        neighbors = dilated & ~blob & (class_map != IGNORE_LABEL)

        if neighbors.any():
            neighbor_vals = class_map[neighbors]
            # Majority vote among valid vegetation neighbours
            counts       = np.bincount(neighbor_vals.astype(np.int64), minlength=2)
            replacement  = int(counts[:2].argmax())
        else:
            # No vegetation neighbours found — default to healthy (0)
            replacement = 0

        result[blob] = replacement

    removed = int(small_bg.sum())
    logger.debug(
        f"Largest-background filter: {num_features - 1} small blob(s) removed, "
        f"{removed:,} pixels reassigned"
    )
    return result


# ── Post-processing helpers ───────────────────────────────────────────────────

def _colourise(class_map: np.ndarray) -> Image.Image:
    """
    Colourise a class map.
    IGNORE_LABEL pixels → white (background).
    """
    H, W = class_map.shape
    rgb  = np.full((H, W, 3), 255, dtype=np.uint8)   # white by default = background
    for cls_idx, colour in _PALETTE.items():
        rgb[class_map == cls_idx] = colour
    return Image.fromarray(rgb, "RGB")


def _label_counts(class_map: np.ndarray) -> dict[str, int]:
    unique, counts = np.unique(class_map, return_counts=True)
    return {str(int(u)): int(c) for u, c in zip(unique, counts)}


def _compute_stats(class_map: np.ndarray) -> dict[str, Any]:
    """
    Return health metrics.
    Background pixels (IGNORE_LABEL) are excluded from the denominator so
    percentages reflect vegetation only — not the whole image footprint.
    """
    vegetation_mask = class_map != IGNORE_LABEL
    total_veg = int(vegetation_mask.sum())

    healthy  = int((class_map == 0).sum())
    stressed = int((class_map == 1).sum())

    # Percentages over vegetation pixels only (background excluded)
    health_pct   = round(healthy  / total_veg * 100, 2) if total_veg > 0 else 0.0
    stressed_pct = round(stressed / total_veg * 100, 2) if total_veg > 0 else 0.0
    health_score = health_pct   # 0–100 float, same convention as ViT pipeline

    return {
        "healthy_pixel_count":    healthy,
        "stressed_pixel_count":   stressed,
        "background_pixel_count": int((class_map == IGNORE_LABEL).sum()),
        "vegetation_pixel_count": total_veg,
        "health_percentage":      health_pct,
        "stressed_percentage":    stressed_pct,
        "health_score":           health_score,
        "stress_class":           "healthy" if healthy >= stressed else "stressed",
        "confidence":             round(max(healthy, stressed) / total_veg, 4) if total_veg > 0 else 0.0,
        "ndvi_threshold_used":    NDVI_VEGETATION_THR,
    }


# ── Public API ────────────────────────────────────────────────────────────────

def run_segformer(
    image_path: str,
    ndvi_threshold: float = NDVI_VEGETATION_THR,
) -> dict[str, Any]:
    """
    Run full SegFormer segmentation on a single image file,
    with global NDVI-based background removal and largest-component filtering.

    Args:
        image_path     : path to the input image (TIFF or standard format)
        ndvi_threshold : NDVI cut-off for background removal (default 0.10).
                         Raise to 0.15–0.20 for images with heavy bare-soil.

    Returns:
        {
            "class_map":              np.ndarray (H×W uint8, 255=background),
            "mask_image":             PIL.Image  (RGB colourised, white=background),
            "label_counts":           {"0": int, "1": int, "255": int},
            "healthy_pixel_count":    int,
            "stressed_pixel_count":   int,
            "background_pixel_count": int,
            "vegetation_pixel_count": int,
            "health_percentage":      float,   # over vegetation only
            "stressed_percentage":    float,   # over vegetation only
            "health_score":           float,   # 0–100
            "stress_class":           str,
            "confidence":             float,
            "ndvi_threshold_used":    float,
        }
    """
    # 1. Load image → RGN PIL + raw array + NDVI map
    pil_img, _arr, ndvi = _open_as_rgn_pil(image_path)
    pil_img, ndvi = _maybe_downscale(pil_img, ndvi, settings.SEGFORMER_MAX_SIDE)

    # 2. Tiling inference → raw class map
    t0 = time.perf_counter()
    class_map = _segment_pil(pil_img)
    logger.info("run_segformer inference %.1fs | %s", time.perf_counter() - t0, image_path)

    # 3. V5.1 PATCH: mask out background pixels globally using NDVI
    class_map = _apply_ndvi_background_mask(class_map, ndvi, threshold=ndvi_threshold)

    # 4. V5.2 PATCH: discard small background blobs, keep only the dominant region
    class_map = _keep_largest_background(class_map)

    # 5. Colourise + stats
    mask_image = _colourise(class_map)
    stats      = _compute_stats(class_map)

    return {
        "class_map":    class_map,
        "mask_image":   mask_image,
        "label_counts": _label_counts(class_map),
        **stats,
    }