from functools import lru_cache
from pathlib import Path
import logging
import numpy as np
import torch
import torch.nn as nn
import torchvision.transforms.functional as TF
from PIL import Image
from transformers import ViTForImageClassification

logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parent.parent

# ── Constants — must match training script exactly ────────────────────────────
_MODEL_PATH  = _BACKEND_ROOT / "models" / "vit_ndvi_leaf_health.pt"
_PATCH_SIZE  = 224
_DROPOUT     = 0.2
_NUM_CLASSES = 2
_IDX_TO_NAME = {0: "healthy", 1: "stressed"}
_NORM_MEAN   = [0.485, 0.456, 0.406, 0.0]
_NORM_STD    = [0.229, 0.224, 0.225, 0.5]
_NDVI_EPS    = 1e-6
_DEVICE      = "cpu"


@lru_cache(maxsize=1)
def _load_vit() -> nn.Module:
    if not _MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Model weights not found at {_MODEL_PATH.resolve()}. "
            "Place vit_ndvi_leaf_health.pt in the models/ folder."
        )

    logger.info(f"Loading ViT from {_MODEL_PATH} on {_DEVICE}")

    # ── Step 1: Load saved weights first so we can inspect them ──────────────
    state = torch.load(_MODEL_PATH, map_location=_DEVICE)

    # ── Step 2: Build model using from_pretrained to get the CORRECT
    #            HuggingFace key layout that matches the saved weights.
    #            ignore_mismatched_sizes handles the 4-ch patch embed + classifier. ──
    model = ViTForImageClassification.from_pretrained(
        "google/vit-base-patch16-224",
        num_labels=_NUM_CLASSES,
        ignore_mismatched_sizes=True,
    )

    # ── Step 3: Swap patch embedding to accept 4 channels ────────────────────
    old_conv = model.vit.embeddings.patch_embeddings.projection
    new_conv  = nn.Conv2d(
        4, old_conv.out_channels,
        old_conv.kernel_size, old_conv.stride,
        old_conv.padding, bias=(old_conv.bias is not None),
    )
    # Copy pretrained RGB weights into first 3 channels; 4th channel
    # is left as random init (will be overwritten by load_state_dict below).
    with torch.no_grad():
        new_conv.weight[:, :3] = old_conv.weight
    model.vit.embeddings.patch_embeddings.projection = new_conv
    model.vit.embeddings.patch_embeddings.num_channels = 4

    # ── Step 4: Replace classifier head to match training architecture ────────
    model.classifier = nn.Sequential(
        nn.Dropout(_DROPOUT),
        nn.Linear(model.config.hidden_size, _NUM_CLASSES),
    )

    # ── Step 5: Load your trained weights ────────────────────────────────────
    # strict=False lets us ignore any minor key mismatches from the
    # pretrained backbone weights we just loaded above.
    missing, unexpected = model.load_state_dict(state, strict=False)

    if missing:
        logger.warning(f"Missing keys when loading ViT weights ({len(missing)}): {missing[:5]}…")
    if unexpected:
        logger.warning(f"Unexpected keys when loading ViT weights ({len(unexpected)}): {unexpected[:5]}…")

    # If there are NO missing keys, the model loaded perfectly.
    # If there are missing keys, they keep the pretrained/random init values.
    if not missing:
        logger.info("ViT weights loaded perfectly — all keys matched.")
    else:
        logger.warning(
            f"ViT loaded with {len(missing)} missing key(s). "
            "Results may be suboptimal. Consider retraining with the current architecture."
        )

    model.to(_DEVICE).eval()
    logger.info("ViT model ready")
    return model


def predict_rgn(image_path: str) -> dict:
    """
    Classify a single RGN image as healthy or stressed.

    Preprocessing matches the training script exactly:
      - Resize to 224x224
      - Compute NDVI from RGN: (NIR - Red) / (NIR + Red + eps)  [NIR = blue slot]
      - Build 4-channel tensor [R, G, NIR, NDVI] with channel-specific normalisation

    Returns:
        {
            "stress_class": "healthy" | "stressed",
            "confidence":   float,   # probability of predicted class (0-1)
            "health_score": float,   # healthy probability * 100 (0-100)
        }
    """
    img  = Image.open(image_path).convert("RGB")
    crop = img.resize((_PATCH_SIZE, _PATCH_SIZE), Image.BILINEAR)
    arr  = np.array(crop).astype(np.float32) / 255.0

    # NDVI: NIR is in the blue slot (channel 2) for RGN images
    ndvi = np.clip(
        (arr[..., 2] - arr[..., 0]) / (arr[..., 2] + arr[..., 0] + _NDVI_EPS),
        -1.0, 1.0,
    )

    # Normalise RGB channels with ImageNet-like stats
    rgb_t = TF.to_tensor(crop)  # (3, 224, 224) in [0, 1]
    for c in range(3):
        rgb_t[c] = (rgb_t[c] - _NORM_MEAN[c]) / _NORM_STD[c]

    # Normalise NDVI channel
    ndvi_t = (torch.from_numpy(ndvi).unsqueeze(0) - _NORM_MEAN[3]) / _NORM_STD[3]

    # Final tensor: (1, 4, 224, 224)
    tensor = torch.cat([rgb_t, ndvi_t], dim=0).unsqueeze(0).to(_DEVICE)

    with torch.no_grad():
        probs = torch.softmax(
            _load_vit()(pixel_values=tensor).logits, dim=1
        ).cpu().numpy()[0]

    pred = int(probs.argmax())
    result = {
        "stress_class": _IDX_TO_NAME[pred],
        "confidence":   float(probs[pred]),
        "health_score": float(probs[0]) * 100.0,  # index 0 = "healthy"
    }

    logger.info(
        f"predict_rgn: {Path(image_path).name} → "
        f"{result['stress_class']} (conf={result['confidence']:.2%}, "
        f"health={result['health_score']:.1f})"
    )
    return result