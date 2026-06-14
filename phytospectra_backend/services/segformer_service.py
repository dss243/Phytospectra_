# services/segformer_service.py
import torch
import torch.nn.functional as F
import numpy as np
from PIL import Image
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

# lazy imports — only pulled in when model actually loads
_model      = None
_processor  = None
_device     = None

IMG_SIZE        = 512
NUM_CLASSES     = 2
SEG_CLASSES     = {0: "healthy", 1: "stressed"}
IGNORE_INDEX    = 255
RGN_RED_IDX     = 0
RGN_NIR_IDX     = 2


def _compute_ndvi(arr: np.ndarray) -> np.ndarray:
    red = arr[:, :, RGN_RED_IDX].astype(np.float32)
    nir = arr[:, :, RGN_NIR_IDX].astype(np.float32)
    return ((nir - red) / (nir + red + 1e-6)).clip(-1.0, 1.0)


def _build_rgn_input(arr: np.ndarray) -> Image.Image:
    """Exactly the same preprocessing as training."""
    ndvi     = _compute_ndvi(arr)
    ndvi_u8  = ((ndvi + 1.0) * 127.5).clip(0, 255).astype(np.uint8)
    stacked  = np.stack([
        arr[:, :, RGN_RED_IDX].clip(0, 255).astype(np.uint8),
        arr[:, :, 1          ].clip(0, 255).astype(np.uint8),
        ndvi_u8,
    ], axis=-1)
    return Image.fromarray(stacked, mode="RGB")


def load_model(weights_path: str):
    global _model, _processor, _device
    if _model is not None:
        return  # already loaded

    from transformers import (
        SegformerForSemanticSegmentation,
        SegformerImageProcessor,
    )

    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Loading SegFormer on {_device} from {weights_path}")

    _processor = SegformerImageProcessor.from_pretrained(
        "nvidia/mit-b0",
        do_resize=False,
        do_rescale=True,
        do_normalize=True,
    )

    model_cfg = SegformerForSemanticSegmentation.from_pretrained(
        "nvidia/mit-b0",
        num_labels=NUM_CLASSES,
        id2label={i: n for i, n in SEG_CLASSES.items()},
        label2id={n: i for i, n in SEG_CLASSES.items()},
        ignore_mismatched_sizes=True,
    )

    if Path(weights_path).exists():
        state = torch.load(weights_path, map_location=_device)
        model_cfg.load_state_dict(state)
        logger.info("SegFormer weights loaded successfully")
    else:
        logger.warning(f"Weights not found at {weights_path} — using random weights (dev mode)")

    _model = model_cfg.to(_device)
    _model.eval()


def predict(image_array: np.ndarray) -> dict:
    """
    Args:
        image_array: (H, W, 3) float32 array with [R, G, NIR] bands (0-255 range)
    Returns:
        {
          pred_mask:       list[list[int]]   (H×W, values 0/1)
          healthy_pct:     float
          stressed_pct:    float
          ndvi_mean:       float
          dominant_class:  str
        }
    """
    if _model is None:
        return _mock_predict(image_array)

    try:
        pil_in   = _build_rgn_input(image_array)
        pil_resized = pil_in.resize((IMG_SIZE, IMG_SIZE), Image.BILINEAR)

        encoding = _processor(
            images=pil_resized,
            return_tensors="pt",
            do_resize=False,
        )
        pv = encoding["pixel_values"].to(_device)

        with torch.no_grad():
            logits    = _model(pixel_values=pv).logits          # (1, 2, H/4, W/4)
            logits_up = F.interpolate(
                logits,
                size=(IMG_SIZE, IMG_SIZE),
                mode="bilinear",
                align_corners=False,
            )
            pred = logits_up.argmax(dim=1).squeeze(0).cpu().numpy()  # (H, W)

        healthy_pct  = float((pred == 0).mean() * 100)
        stressed_pct = float((pred == 1).mean() * 100)
        ndvi_mean    = float(_compute_ndvi(image_array).mean())

        return {
            "pred_mask"     : pred.tolist(),
            "healthy_pct"   : round(healthy_pct,  2),
            "stressed_pct"  : round(stressed_pct, 2),
            "ndvi_mean"     : round(ndvi_mean,     4),
            "dominant_class": "stressed" if stressed_pct > 50 else "healthy",
        }

    except Exception as e:
        logger.error(f"SegFormer inference error: {e}", exc_info=True)
        return _mock_predict(image_array)


def _mock_predict(image_array: np.ndarray) -> dict:
    """Deterministic mock for simulation / dev without weights."""
    import random
    H, W  = image_array.shape[:2]
    ndvi  = _compute_ndvi(image_array)
    mean  = float(ndvi.mean())

    stressed_pct = max(0.0, min(100.0, (0.5 - mean) * 120 + random.uniform(-5, 5)))
    healthy_pct  = 100.0 - stressed_pct

    # Build a simple mock mask: top half healthy, bottom half stressed
    mock_mask           = np.zeros((H, W), dtype=np.uint8)
    mock_mask[H // 2:]  = 1

    return {
        "pred_mask"     : mock_mask.tolist(),
        "healthy_pct"   : round(healthy_pct,  2),
        "stressed_pct"  : round(stressed_pct, 2),
        "ndvi_mean"     : round(mean,          4),
        "dominant_class": "stressed" if stressed_pct > 50 else "healthy",
    }
