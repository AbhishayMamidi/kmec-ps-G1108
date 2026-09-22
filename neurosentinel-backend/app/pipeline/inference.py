from __future__ import annotations

import gc
import logging
import os
from typing import Any, Callable

import numpy as np
import torch

from app.pipeline.config import PIPELINE_CONFIG, SEIZURE_STRIDE_SAMPLES, WINDOW_SAMPLES
from app.pipeline.preprocessing import preprocess_any_edf, preprocess_edf_to_data

logger = logging.getLogger(__name__)

# Type for the guard callback: raises if memory/cancel/timeout exceeded
GuardFn = Callable[[], None]


class JobAborted(Exception):
    """Raised when a guard check fails (memory, cancel, timeout)."""
    pass


def _smooth(probabilities: np.ndarray, window: int = 7) -> np.ndarray:
    if window <= 1:
        return probabilities.copy()
    kernel = np.ones(window) / window
    return np.convolve(probabilities, kernel, mode="same").astype(np.float32)


def _hysteresis(probabilities: np.ndarray, high: float, low: float, stride_sec: float = 1.0) -> list[tuple[float, float]]:
    events: list[tuple[float, float]] = []
    in_event = False
    start_index = 0
    for index, probability in enumerate(probabilities):
        if not in_event and probability >= high:
            in_event = True
            start_index = index
        elif in_event and probability < low:
            in_event = False
            events.append((start_index * stride_sec, index * stride_sec))
    if in_event:
        events.append((start_index * stride_sec, len(probabilities) * stride_sec))
    return events


def _filter_min_duration(events: list[tuple[float, float]], min_sec: float) -> list[tuple[float, float]]:
    return [(start, end) for start, end in events if (end - start) >= min_sec]


def _merge_close(events: list[tuple[float, float]], gap_sec: float) -> list[tuple[float, float]]:
    if len(events) <= 1:
        return list(events)
    merged: list[list[float]] = [[events[0][0], events[0][1]]]
    for start, end in events[1:]:
        if start - merged[-1][1] <= gap_sec:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def _mean_filter(probabilities: np.ndarray, events: list[tuple[float, float]], min_mean: float, stride_sec: float = 1.0) -> list[tuple[float, float]]:
    filtered: list[tuple[float, float]] = []
    for onset, offset in events:
        start_index = int(onset / stride_sec)
        end_index = min(int(offset / stride_sec), len(probabilities))
        event_probabilities = probabilities[start_index:end_index]
        if len(event_probabilities) and float(event_probabilities.mean()) >= min_mean:
            filtered.append((onset, offset))
    return filtered


def _sustained_filter(
    probabilities: np.ndarray,
    events: list[tuple[float, float]],
    sustained_sec: float,
    sustained_threshold: float,
    stride_sec: float = 1.0,
) -> list[tuple[float, float]]:
    required = int(sustained_sec / stride_sec)
    filtered: list[tuple[float, float]] = []
    for onset, offset in events:
        start_index = int(onset / stride_sec)
        end_index = min(int(offset / stride_sec), len(probabilities))
        event_probabilities = probabilities[start_index:end_index]
        current_run = 0
        max_run = 0
        for value in event_probabilities >= sustained_threshold:
            if value:
                current_run += 1
                max_run = max(max_run, current_run)
            else:
                current_run = 0
        if max_run >= required:
            filtered.append((onset, offset))
    return filtered


def compute_output_domain_shift(raw_probabilities: np.ndarray) -> float:
    if raw_probabilities is None or len(raw_probabilities) == 0:
        return 0.0
    probability_median = float(np.median(raw_probabilities))
    if probability_median < 0.05:
        return 0.0
    if probability_median < 0.15:
        return 0.3
    if probability_median < 0.30:
        return 0.6
    return 0.9


def domain_adaptive_post_process(probabilities: np.ndarray, domain_shift: float, stride_sec: float = 1.0) -> tuple[list[tuple[float, float]], float, float, dict[str, Any]]:
    # Two-tier approach:
    # HIGH domain shift (foreign data like Siena): strict filtering to suppress FP
    #   — model produces elevated baseline (median 0.41-0.81) on foreign data
    #   — strict thresholds eliminate cross-dataset false alarms
    # LOW/NO domain shift (in-domain like CHB-MIT/Helsinki): relaxed filtering
    #   — model baselines are low (median ~0.001), genuine seizures spike clearly
    #   — relaxed thresholds catch shorter/sparser seizures without FP risk
    if domain_shift >= 0.7:
        # HIGH domain shift: preserve original strict filtering for FP suppression
        smooth_window = 13
        min_duration = 20.0
        min_mean = 0.88
        sustained_seconds = 8
        sustained_threshold = 0.88
        smoothed = _smooth(probabilities, window=smooth_window)
        high = 0.90  # fixed — seizures must clearly exceed elevated baseline
        low = 0.75
        threshold_mode = "fixed_strict"
    elif domain_shift >= 0.4:
        # MODERATE domain shift: moderately strict
        smooth_window = 11
        min_duration = 15.0
        min_mean = 0.80
        sustained_seconds = 5
        sustained_threshold = 0.75
        smoothed = _smooth(probabilities, window=smooth_window)
        high = max(float(np.percentile(smoothed, 99)), 0.5)
        low = high * 0.7
        threshold_mode = "percentile_moderate"
    elif domain_shift >= 0.15:
        # LOW domain shift: relaxed but still cautious
        smooth_window = 7
        min_duration = 10.0
        min_mean = 0.65
        sustained_seconds = 4
        sustained_threshold = 0.55
        smoothed = _smooth(probabilities, window=smooth_window)
        high = max(float(np.percentile(smoothed, 97)), 0.5)
        low = high * 0.65
        threshold_mode = "percentile_relaxed"
    else:
        # NO domain shift (in-domain data): permissive thresholds
        # Model baselines are very low (~0.001), so even moderate spikes are real
        smooth_window = 5
        min_duration = 8.0
        min_mean = 0.55
        sustained_seconds = 3
        sustained_threshold = 0.45
        smoothed = _smooth(probabilities, window=smooth_window)
        high = max(float(np.percentile(smoothed, 95)), 0.5)
        low = high * 0.6
        threshold_mode = "percentile_permissive"

    config = {
        "smooth_window": smooth_window,
        "min_duration": min_duration,
        "min_mean_prob": min_mean,
        "sustained_sec": sustained_seconds,
        "sustained_thresh": sustained_threshold,
        "threshold_mode": threshold_mode,
    }

    events = _hysteresis(smoothed, high, low, stride_sec)
    events = _filter_min_duration(events, min_duration)
    events = _merge_close(events, 5.0)
    events = _mean_filter(probabilities, events, min_mean, stride_sec)
    events = _sustained_filter(probabilities, events, sustained_seconds, sustained_threshold, stride_sec)
    return events, high, low, config


@torch.no_grad()
def infer_probabilities(
    model: torch.nn.Module,
    windows: np.ndarray,
    device: torch.device,
    batch_size: int = 4,
    guard_fn: GuardFn | None = None,
) -> np.ndarray:
    """Run model inference on windows. Memory-safe: deletes tensors after each batch."""
    chunks: list[np.ndarray] = []
    model.eval()
    for start in range(0, len(windows), batch_size):
        # Check memory/cancel/timeout BEFORE each batch forward pass
        if guard_fn:
            guard_fn()
        batch = torch.from_numpy(windows[start : start + batch_size]).to(device)
        logits = model(batch)
        probabilities = torch.softmax(logits, dim=1)[:, 1].cpu().numpy()
        chunks.append(probabilities)
        # Explicitly free GPU/CPU tensors to prevent accumulation
        del batch, logits
    return np.concatenate(chunks)


@torch.no_grad()
def analyze_preprocessed_windows(
    model: torch.nn.Module,
    windows: np.ndarray,
    channel_mask: np.ndarray,
    metadata: dict[str, Any],
    device: torch.device | None = None,
    batch_size: int = 64,
) -> dict[str, Any]:
    if device is None:
        device = next(model.parameters()).device

    raw_probabilities = infer_probabilities(model, windows, device=device, batch_size=batch_size)
    output_shift = compute_output_domain_shift(raw_probabilities)
    events, high, low, post_process_config = domain_adaptive_post_process(raw_probabilities, output_shift, stride_sec=1.0)

    # Seizure-aware fallback: if strict PP killed all events but model clearly
    # detects seizures, retry with relaxed thresholds. This prevents domain-shift
    # filtering from suppressing real seizures on foreign seizure-heavy recordings
    # (e.g. Helsinki neonatal EEG).
    if not events and output_shift >= 0.4:
        raw_max = float(raw_probabilities.max())
        seizure_ratio = float((raw_probabilities > 0.5).mean())
        if raw_max > 0.5 or seizure_ratio > 0.05:
            logger.info(
                "Post-processing killed all events at domain_shift=%.2f but model shows seizure signal "
                "(max=%.3f, ratio=%.3f). Retrying with relaxed thresholds.",
                output_shift, raw_max, seizure_ratio,
            )
            events, high, low, post_process_config = domain_adaptive_post_process(
                raw_probabilities, 0.0, stride_sec=1.0  # force permissive tier
            )
            post_process_config["threshold_mode"] += "_seizure_fallback"

    shift_label = "NONE" if output_shift < 0.15 else "LOW" if output_shift < 0.4 else "MODERATE" if output_shift < 0.7 else "HIGH"
    duration_hours = metadata.get("duration_sec", 0.0) / 3600 if metadata.get("duration_sec") else 0.0
    return {
        "status": "ok",
        "raw_probabilities": raw_probabilities,
        "events": events,
        "n_events": len(events),
        "events_per_hour": round(len(events) / max(duration_hours, 0.001), 2),
        "output_domain_shift": round(output_shift, 3),
        "shift_label": shift_label,
        "post_process_config": post_process_config,
        "threshold_high": round(float(high), 4),
        "threshold_low": round(float(low), 4),
        "raw_prob_mean": round(float(raw_probabilities.mean()), 4),
        "raw_prob_median": round(float(np.median(raw_probabilities)), 4),
        "raw_prob_p99": round(float(np.percentile(raw_probabilities, 99)), 4),
        "raw_prob_max": round(float(raw_probabilities.max()), 4),
        "metadata": metadata,
        "channel_mask": channel_mask.astype(bool),
    }


@torch.no_grad()
def robust_inference(
    model: torch.nn.Module,
    edf_path: str,
    device: torch.device | None = None,
    batch_size: int = 64,
) -> dict[str, Any]:
    filename = os.path.basename(edf_path)
    windows, channel_mask, metadata = preprocess_any_edf(edf_path)
    if windows is None or len(windows) == 0:
        return {"status": "no_windows", "filename": filename, "metadata": metadata, "events": []}

    result = analyze_preprocessed_windows(model, windows, channel_mask, metadata, device=device, batch_size=batch_size)
    result["filename"] = filename
    del windows
    gc.collect()
    return result


@torch.no_grad()
def infer_from_data_chunked(
    model: torch.nn.Module,
    data: np.ndarray,
    channel_mask: np.ndarray,
    metadata: dict[str, Any],
    device: torch.device | None = None,
    batch_size: int = 4,
    max_windows_per_chunk: int = 50,
    guard_fn: GuardFn | None = None,
) -> dict[str, Any]:
    """Run inference on preprocessed data without materializing all windows at once.

    Memory discipline:
    - guard_fn is called EVERY chunk to check memory/cancel/timeout
    - Only `max_windows_per_chunk` windows exist at any time (~4MB for 50)
    - Each chunk's tensors are deleted immediately after inference
    - gc.collect() is called after EVERY chunk to force release
    - Quality samples capped at 10
    """
    # Enforce hard chunk cap at runtime (never exceed 50 regardless of caller)
    max_windows_per_chunk = min(max_windows_per_chunk, 50)
    batch_size = min(batch_size, 4)

    if device is None:
        device = next(model.parameters()).device
    model.eval()

    channels, total_samples = data.shape
    win = WINDOW_SAMPLES
    stride = SEIZURE_STRIDE_SAMPLES

    if total_samples < win:
        return {"status": "no_windows", "metadata": metadata, "events": []}

    n_windows = (total_samples - win) // stride + 1
    all_probs: list[np.ndarray] = []
    representative_window: np.ndarray | None = None
    max_prob = -1.0
    quality_samples: list[np.ndarray] = []

    for chunk_idx, chunk_start in enumerate(range(0, n_windows, max_windows_per_chunk)):
        # ── GUARD CHECK: memory / cancel / timeout ──
        if guard_fn:
            guard_fn()

        chunk_end = min(chunk_start + max_windows_per_chunk, n_windows)
        chunk_n = chunk_end - chunk_start

        # Extract this chunk of windows from data using stride tricks
        sample_start = chunk_start * stride
        sample_end = (chunk_end - 1) * stride + win
        chunk_data = data[:, sample_start:sample_end]

        stride0, stride1 = chunk_data.strides
        view = np.lib.stride_tricks.as_strided(
            chunk_data,
            shape=(chunk_n, channels, win),
            strides=(stride * stride1, stride0, stride1),
            writeable=False,
        )
        windows = view.copy().astype(np.float32)

        # Run inference on this chunk (guard_fn also called per-batch inside)
        probs = infer_probabilities(model, windows, device, batch_size, guard_fn=guard_fn)
        all_probs.append(probs)

        # Track representative window (highest seizure probability)
        chunk_max_idx = int(np.argmax(probs))
        if probs[chunk_max_idx] > max_prob:
            max_prob = float(probs[chunk_max_idx])
            representative_window = windows[chunk_max_idx].copy()

        # Sample windows for quality assessment (keep up to 10)
        if len(quality_samples) < 10:
            sample_step = max(1, len(windows) // 3)
            for i in range(0, len(windows), sample_step):
                if len(quality_samples) < 10:
                    quality_samples.append(windows[i].copy())

        # CRITICAL: free this chunk's memory before next iteration
        del windows, chunk_data, view, probs
        gc.collect()

        if chunk_idx % 10 == 0:
            logger.debug("Chunk %d/%d processed", chunk_idx + 1, (n_windows + max_windows_per_chunk - 1) // max_windows_per_chunk)

    raw_probabilities = np.concatenate(all_probs)
    del all_probs
    gc.collect()

    # Post-processing (identical to non-chunked path)
    output_shift = compute_output_domain_shift(raw_probabilities)
    events, high, low, post_process_config = domain_adaptive_post_process(raw_probabilities, output_shift, stride_sec=1.0)

    # Seizure-aware fallback (same as non-chunked path)
    if not events and output_shift >= 0.4:
        raw_max = float(raw_probabilities.max())
        seizure_ratio = float((raw_probabilities > 0.5).mean())
        if raw_max > 0.5 or seizure_ratio > 0.05:
            logger.info(
                "[chunked] Post-processing killed all events at domain_shift=%.2f but model shows seizure signal "
                "(max=%.3f, ratio=%.3f). Retrying with relaxed thresholds.",
                output_shift, raw_max, seizure_ratio,
            )
            events, high, low, post_process_config = domain_adaptive_post_process(
                raw_probabilities, 0.0, stride_sec=1.0
            )
            post_process_config["threshold_mode"] += "_seizure_fallback"

    shift_label = "NONE" if output_shift < 0.15 else "LOW" if output_shift < 0.4 else "MODERATE" if output_shift < 0.7 else "HIGH"
    duration_hours = metadata.get("duration_sec", 0.0) / 3600 if metadata.get("duration_sec") else 0.0

    result = {
        "status": "ok",
        "raw_probabilities": raw_probabilities,
        "events": events,
        "n_events": len(events),
        "events_per_hour": round(len(events) / max(duration_hours, 0.001), 2),
        "output_domain_shift": round(output_shift, 3),
        "shift_label": shift_label,
        "post_process_config": post_process_config,
        "threshold_high": round(float(high), 4),
        "threshold_low": round(float(low), 4),
        "raw_prob_mean": round(float(raw_probabilities.mean()), 4),
        "raw_prob_median": round(float(np.median(raw_probabilities)), 4),
        "raw_prob_p99": round(float(np.percentile(raw_probabilities, 99)), 4),
        "raw_prob_max": round(float(raw_probabilities.max()), 4),
        "metadata": metadata,
        "channel_mask": channel_mask.astype(bool),
        "representative_window": representative_window,
        "quality_samples": np.stack(quality_samples) if quality_samples else None,
    }
    return result

