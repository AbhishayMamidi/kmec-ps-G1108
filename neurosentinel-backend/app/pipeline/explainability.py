from __future__ import annotations

from typing import Any

import numpy as np
import torch

from app.pipeline.config import CHANNEL_TO_REGION, STANDARD_CHANNELS


def extract_attention_maps(model: torch.nn.Module, x: torch.Tensor, layer_idx: int = -1) -> np.ndarray | None:
    model.eval()
    attention_weights: dict[str, torch.Tensor] = {}
    layer = model.transformer.layers[layer_idx]
    original_forward = layer.self_attn.forward

    def patched_forward(query: torch.Tensor, key: torch.Tensor, value: torch.Tensor, **kwargs: Any) -> tuple[torch.Tensor, torch.Tensor]:
        kwargs["need_weights"] = True
        kwargs.pop("average_attn_weights", None)
        output, attention = original_forward(query, key, value, **kwargs)
        attention_weights["attn"] = attention.detach().cpu()
        return output, attention

    layer.self_attn.forward = patched_forward  # type: ignore[method-assign]
    try:
        with torch.no_grad():
            _ = model(x)
    finally:
        layer.self_attn.forward = original_forward  # type: ignore[method-assign]

    if "attn" not in attention_weights:
        return None
    attention = attention_weights["attn"]
    cls_attention = attention[:, 0, 1:]
    return cls_attention.numpy()


@torch.no_grad()
def compute_channel_importance(model: torch.nn.Module, x: torch.Tensor, target_class: int = 1) -> np.ndarray:
    """Compute channel importance using perturbation (zero-out) method.

    MEMORY-SAFE: Runs entirely under torch.no_grad().
    NO gradient graph is built — saves 80-150MB vs the gradient-based method.

    For each channel, we zero it out and measure the drop in seizure probability.
    Channels that cause bigger drops are more important.
    """
    import gc

    model.eval()
    # Get baseline prediction
    base_logits = model(x)
    base_prob = torch.softmax(base_logits, dim=1)[:, target_class].item()
    del base_logits

    n_channels = x.shape[1]
    importance = np.zeros(n_channels, dtype=np.float32)

    for ch in range(n_channels):
        # Clone, zero out one channel, measure impact
        perturbed = x.clone()
        perturbed[:, ch, :] = 0.0
        logits = model(perturbed)
        prob = torch.softmax(logits, dim=1)[:, target_class].item()
        importance[ch] = max(0.0, base_prob - prob)  # drop = importance
        del perturbed, logits

    # Normalize to sum to 1
    total = importance.sum()
    if total > 1e-8:
        importance /= total

    gc.collect()
    return importance


def map_channel_importance_to_regions(channel_importance: np.ndarray, channel_mask: np.ndarray) -> dict[str, float]:
    region_scores: dict[str, list[float]] = {}
    for channel_index in range(len(STANDARD_CHANNELS)):
        if bool(channel_mask[channel_index]):
            region = CHANNEL_TO_REGION[channel_index]
            region_scores.setdefault(region, []).append(float(channel_importance[channel_index]))
    return {region: round(float(np.mean(values)), 4) for region, values in region_scores.items()}


def generate_brain_heatmap(channel_importance: np.ndarray, channel_mask: np.ndarray) -> dict[str, Any]:
    electrode_positions = {
        "FP1-F7": (0.25, 0.15),
        "F7-T7": (0.10, 0.35),
        "T7-P7": (0.10, 0.60),
        "P7-O1": (0.25, 0.85),
        "FP1-F3": (0.35, 0.15),
        "F3-C3": (0.30, 0.40),
        "C3-P3": (0.30, 0.60),
        "P3-O1": (0.35, 0.85),
        "FP2-F4": (0.65, 0.15),
        "F4-C4": (0.70, 0.40),
        "C4-P4": (0.70, 0.60),
        "P4-O2": (0.65, 0.85),
        "FP2-F8": (0.75, 0.15),
        "F8-T8": (0.90, 0.35),
        "T8-P8": (0.90, 0.60),
        "P8-O2": (0.75, 0.85),
        "FZ-CZ": (0.50, 0.30),
        "CZ-PZ": (0.50, 0.55),
        "P7-T7": (0.15, 0.55),
        "T7-FT9": (0.08, 0.45),
        "FT9-FT10": (0.50, 0.10),
        "FT10-T8": (0.92, 0.45),
    }
    regions = map_channel_importance_to_regions(channel_importance, channel_mask)
    channels = []
    for channel_index, channel_name in enumerate(STANDARD_CHANNELS):
        x, y = electrode_positions.get(channel_name, (0.5, 0.5))
        channels.append(
            {
                "channel": channel_name,
                "x": x,
                "y": y,
                "importance": round(float(channel_importance[channel_index]), 4),
                "active": bool(channel_mask[channel_index]),
                "region": CHANNEL_TO_REGION.get(channel_index, "Unknown"),
            }
        )
    return {
        "channels": channels,
        "regions": regions,
        "source": "DERIVED — gradient-based importance mapped to 10-20 layout",
    }
