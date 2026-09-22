from __future__ import annotations

import gc
import logging
import os
import warnings
from typing import Any

import mne
import numpy as np
from scipy.signal import butter, iirnotch, sosfiltfilt, tf2sos, welch

from app.pipeline.config import N_CHANNELS, PIPELINE_CONFIG, SEIZURE_STRIDE_SAMPLES, STANDARD_CHANNELS, WINDOW_SAMPLES

logger = logging.getLogger(__name__)
mne.set_log_level("WARNING")

_FILTER_CACHE: dict[tuple[Any, ...], np.ndarray] = {}

_ELECTRODE_ALIASES = {
    "T3": "T7",
    "T4": "T8",
    "T5": "P7",
    "T6": "P8",
    "PG1": "FT9",
    "PG2": "FT10",
}

_STRIP_PREFIXES = ["EEG ", "EEG-", "EEG_"]
_STRIP_SUFFIXES = ["-REF", "-LE", "-AR", "-AVG", "-A1", "-A2", "-CLE", "-CAR", "-LM", "-AVR", "-LINKED", " REF", " LE", " AR"]


def detect_powerline_freq(data: np.ndarray, fs: float, candidates: list[float] | None = None) -> float:
    if candidates is None:
        candidates = PIPELINE_CONFIG["NOTCH_CANDIDATES"]

    segment_length = int(min(30 * fs, data.shape[1]))
    total_time = data.shape[1]
    segment_count = min(4, max(1, total_time // segment_length))
    segment_starts = np.linspace(0, total_time - segment_length, segment_count, dtype=int)
    accumulated_scores = {candidate: [] for candidate in candidates if candidate < fs / 2}

    for start in segment_starts:
        snippet = data[:4, start : start + segment_length].astype(np.float64)
        snippet -= snippet.mean(axis=1, keepdims=True)
        nperseg = min(int(4 * fs), segment_length)
        freqs, power = welch(snippet, fs=fs, nperseg=nperseg, axis=1)
        mean_power = power.mean(axis=0)
        for candidate in accumulated_scores:
            band_mask = (freqs >= candidate - 1.0) & (freqs <= candidate + 1.0)
            floor_mask = ((freqs >= candidate - 5.0) & (freqs < candidate - 1.0)) | ((freqs > candidate + 1.0) & (freqs <= candidate + 5.0))
            if band_mask.sum() == 0 or floor_mask.sum() == 0:
                accumulated_scores[candidate].append(0.0)
                continue
            peak = mean_power[band_mask].max()
            floor = np.median(mean_power[floor_mask])
            accumulated_scores[candidate].append(peak / (floor + 1e-12))

    if not accumulated_scores:
        return 60.0

    final_scores = {candidate: float(np.mean(values)) for candidate, values in accumulated_scores.items()}
    return float(max(final_scores, key=final_scores.get))


def _get_bandpass_sos(fs: float) -> np.ndarray:
    key = ("bandpass", fs)
    if key not in _FILTER_CACHE:
        nyquist = fs / 2
        _FILTER_CACHE[key] = butter(
            4,
            [PIPELINE_CONFIG["BANDPASS_LOW"] / nyquist, PIPELINE_CONFIG["BANDPASS_HIGH"] / nyquist],
            btype="band",
            output="sos",
        )
    return _FILTER_CACHE[key]


def _get_notch_sos(fs: float, frequency: float) -> np.ndarray:
    key = ("notch", fs, frequency)
    if key not in _FILTER_CACHE:
        b, a = iirnotch(frequency, PIPELINE_CONFIG["NOTCH_Q"], fs)
        _FILTER_CACHE[key] = tf2sos(b, a)
    return _FILTER_CACHE[key]


def apply_notch(data: np.ndarray, fs: float, frequency: float, channels: np.ndarray | None = None) -> None:
    indices = channels if channels is not None else np.arange(data.shape[0])
    data[indices] = sosfiltfilt(_get_notch_sos(fs, frequency), data[indices], axis=1)
    if PIPELINE_CONFIG["NOTCH_HARMONICS"]:
        second_harmonic = frequency * 2.0
        if second_harmonic < fs / 2:
            data[indices] = sosfiltfilt(_get_notch_sos(fs, second_harmonic), data[indices], axis=1)


def apply_bandpass(data: np.ndarray, fs: float, channels: np.ndarray | None = None) -> None:
    indices = channels if channels is not None else np.arange(data.shape[0])
    data[indices] = sosfiltfilt(_get_bandpass_sos(fs), data[indices], axis=1)


def robust_normalize(data: np.ndarray, fs: float, seizure_intervals: list[tuple[float, float]] | None = None, channels: np.ndarray | None = None) -> None:
    indices = channels if channels is not None else np.arange(data.shape[0])
    total_samples = data.shape[1]
    background_mask = np.ones(total_samples, dtype=bool)
    for onset, offset in seizure_intervals or []:
        start = max(0, int(onset * fs))
        end = min(total_samples, int(offset * fs))
        background_mask[start:end] = False
    if background_mask.sum() < int(10 * fs):
        background_mask[:] = False
        background_mask[: min(total_samples, int(60 * fs))] = True
    background = data[indices][:, background_mask]
    q75, q50, q25 = np.percentile(background, [75, 50, 25], axis=1)
    robust_std = (q75 - q25) / 1.349
    data[indices] -= q50[:, np.newaxis]
    data[indices] /= robust_std[:, np.newaxis] + 1e-6


def extract_windows_vectorised(
    data: np.ndarray,
    win: int,
    stride: int,
    ch_mask: np.ndarray,
    amp_threshold: float,
    skip_artifact_rejection: bool = False,
) -> tuple[np.ndarray | None, int, int]:
    channels, total_samples = data.shape
    if total_samples < win:
        return None, 0, 0

    n_windows = (total_samples - win) // stride + 1
    stride0, stride1 = data.strides
    view = np.lib.stride_tricks.as_strided(
        data,
        shape=(n_windows, channels, win),
        strides=(stride * stride1, stride0, stride1),
        writeable=False,
    )

    if skip_artifact_rejection:
        good_mask = np.ones(n_windows, dtype=bool)
    else:
        real_view = view[:, ch_mask, :]
        peak_amplitude = np.abs(real_view).max(axis=(1, 2))
        good_mask = peak_amplitude < amp_threshold

    good_window_count = int(good_mask.sum())
    rejected_window_count = n_windows - good_window_count
    if good_window_count == 0:
        return None, 0, rejected_window_count

    windows = view[good_mask].copy().astype(np.float32)
    return windows, good_window_count, rejected_window_count


def _normalize_electrode(name: str) -> str:
    value = name.strip().upper()
    for prefix in _STRIP_PREFIXES:
        if value.startswith(prefix):
            value = value[len(prefix) :]
            break
    for suffix in _STRIP_SUFFIXES:
        if value.endswith(suffix):
            value = value[: -len(suffix)]
            break
    return _ELECTRODE_ALIASES.get(value.strip(), value.strip())


def _detect_montage(channel_names: list[str]) -> str:
    bipolar_count = 0
    for channel_name in channel_names:
        normalized = channel_name.strip().upper()
        for prefix in _STRIP_PREFIXES:
            if normalized.startswith(prefix):
                normalized = normalized[len(prefix) :]
                break
        for suffix in _STRIP_SUFFIXES:
            if normalized.endswith(suffix):
                normalized = normalized[: -len(suffix)]
                break
        parts = normalized.strip().split("-")
        if len(parts) == 2 and len(parts[0]) >= 2 and len(parts[1]) >= 2:
            if parts[0][0].isalpha() and parts[1][0].isalpha():
                bipolar_count += 1
    return "bipolar" if bipolar_count > len(channel_names) * 0.5 else "referential"


def adapt_to_bipolar(raw_data: np.ndarray, channel_names: list[str], n_samples: int) -> tuple[np.ndarray, list[str], str]:
    montage = _detect_montage(channel_names)
    if montage == "bipolar":
        return raw_data, list(channel_names), montage

    electrode_indices: dict[str, int] = {}
    for index, channel_name in enumerate(channel_names):
        electrode = _normalize_electrode(channel_name)
        if electrode not in electrode_indices:
            electrode_indices[electrode] = index

    adapted_rows: list[np.ndarray] = []
    adapted_names: list[str] = []
    for standard_channel in STANDARD_CHANNELS:
        left, right = standard_channel.split("-")
        left = _ELECTRODE_ALIASES.get(left, left)
        right = _ELECTRODE_ALIASES.get(right, right)
        if left in electrode_indices and right in electrode_indices:
            bipolar = raw_data[electrode_indices[left], :n_samples] - raw_data[electrode_indices[right], :n_samples]
            adapted_rows.append(bipolar)
            adapted_names.append(standard_channel)

    if not adapted_rows:
        raise ValueError(f"Cannot compute any bipolar channels. Available electrodes: {sorted(electrode_indices.keys())}")

    logger.info("Adapter converted %s input to 22-channel bipolar view (%s computed channels)", montage, len(adapted_rows))
    return np.array(adapted_rows, dtype=np.float32), adapted_names, montage


def _normalize_channel_name(name: str) -> str:
    normalized = name.upper().strip()
    if normalized.startswith("EEG "):
        normalized = normalized[4:]
    return normalized.replace("-REF", "").replace("-LE", "")


def enforce_channels(raw_data: np.ndarray, raw_channel_names: list[str], n_samples: int, filename: str) -> tuple[np.ndarray, np.ndarray]:
    available: dict[str, int] = {}
    for index, channel_name in enumerate(raw_channel_names):
        normalized = _normalize_channel_name(channel_name)
        if normalized not in available:
            available[normalized] = index

    source_indices = [available.get(_normalize_channel_name(channel_name)) for channel_name in STANDARD_CHANNELS]
    channel_mask = np.array([index is not None for index in source_indices], dtype=bool)
    missing_count = int((~channel_mask).sum())
    if missing_count > PIPELINE_CONFIG["MAX_MISSING_CH"]:
        raise ValueError(f"{filename}: {missing_count} channels missing — montage incompatible")

    output = np.zeros((N_CHANNELS, n_samples), dtype=np.float32)
    for output_index, source_index in enumerate(source_indices):
        if source_index is not None:
            output[output_index] = raw_data[source_index]
    return output, channel_mask


def _pick_needed_channels(raw: mne.io.BaseRaw, raw_channel_names: list[str]) -> list[str]:
    """Identify the minimal set of channels we actually need, to avoid loading unnecessary data.

    This is a MEMORY optimization only. It drops clearly non-EEG channels (ECG, EMG, SpO2, etc.)
    BEFORE calling load_data(), so we don't allocate float64 arrays for channels we will never use.
    The rest of the pipeline (adapt_to_bipolar, enforce_channels) is unchanged.

    Safe for: CHB-MIT (bipolar), Siena (referential), and any unknown EDF format.
    """
    # Build set of all individual electrodes needed for the 22-channel bipolar montage
    needed_electrodes: set[str] = set()
    for bipolar_pair in STANDARD_CHANNELS:
        left, right = bipolar_pair.split("-")
        needed_electrodes.add(_ELECTRODE_ALIASES.get(left, left))
        needed_electrodes.add(_ELECTRODE_ALIASES.get(right, right))

    # Pre-compute normalized standard channel names for bipolar matching
    standard_normalized: set[str] = {_normalize_channel_name(s) for s in STANDARD_CHANNELS}

    keep: list[str] = []
    for ch_name in raw_channel_names:
        # Match individual electrodes (referential montages: "EEG FP1-REF", "EEG T3-LE", etc.)
        electrode = _normalize_electrode(ch_name)
        if electrode in needed_electrodes:
            keep.append(ch_name)
            continue
        # Match already-bipolar channels (CHB-MIT: "FP1-F7", "EEG FP1-F7", etc.)
        bipolar = _normalize_channel_name(ch_name)
        if bipolar in standard_normalized:
            keep.append(ch_name)
            continue

    # If we matched at least some channels, use only those
    if keep:
        return keep

    # Fallback: keep all channels EXCEPT clearly non-EEG signals
    _NON_EEG_KEYWORDS = {"ECG", "EKG", "EMG", "EOG", "SPO2", "HR", "RESP", "TEMP",
                         "PHOTIC", "DC", "BURSTS", "SUPPR", "IBI", "BODY", "PULSE",
                         "SAO2", "CHIN", "LEG", "SNORE", "FLOW", "THOR", "ABDO"}
    fallback: list[str] = []
    for ch_name in raw_channel_names:
        upper = ch_name.upper().strip()
        if not any(kw in upper for kw in _NON_EEG_KEYWORDS):
            fallback.append(ch_name)

    # If even the fallback is empty, keep everything (never return empty)
    return fallback if fallback else raw_channel_names



def preprocess_edf_to_data(edf_path: str) -> tuple[np.ndarray | None, np.ndarray, dict[str, Any]]:
    """Preprocess EDF and return the continuous data array (NOT windowed).

    This is the memory-efficient entry point for large files. Windowing
    is deferred to the caller, which can extract windows in small chunks
    and stream them through the model without materializing all windows at once.

    Returns:
        data: float32 array of shape (22, n_samples) — preprocessed signal, or None on failure
        channel_mask: bool array of shape (22,)
        metadata: dict with preprocessing info
    """
    filename = os.path.basename(edf_path)
    metadata: dict[str, Any] = {"filename": filename}
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            raw = mne.io.read_raw_edf(edf_path, preload=False, verbose=False)

        original_fs = float(raw.info["sfreq"])
        raw_channel_names = list(raw.ch_names)
        duration_sec = float(raw.times[-1]) if len(raw.times) else 0.0

        # Extract recording date from EDF header if available
        recording_date = ""
        meas_date = raw.info.get("meas_date")
        if meas_date is not None:
            try:
                recording_date = meas_date.strftime("%Y-%m-%d %H:%M:%S") if hasattr(meas_date, "strftime") else str(meas_date)
            except Exception:
                recording_date = ""

        metadata.update(
            sampling_rate_original=original_fs,
            n_input_channels=len(raw_channel_names),
            duration_sec=duration_sec,
            recording_date=recording_date,
        )

        detect_duration = min(30.0, duration_sec or 30.0)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            snippet, _ = raw[:, : int(detect_duration * original_fs)]
        powerline_hz = detect_powerline_freq(snippet.astype(np.float32), original_fs)
        del snippet
        metadata["powerline_hz"] = powerline_hz

        # --- Memory optimization: drop channels we don't need BEFORE loading ---
        needed_channels = _pick_needed_channels(raw, raw_channel_names)
        drop_channels = [ch for ch in raw_channel_names if ch not in needed_channels]
        if drop_channels:
            logger.info("Dropping %d unneeded channels to save memory: %s", len(drop_channels), drop_channels[:5])
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                raw.drop_channels(drop_channels)
        raw_channel_names = list(raw.ch_names)
        metadata["channels_dropped_for_memory"] = len(drop_channels)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            raw.load_data(verbose=False)
            if abs(original_fs - PIPELINE_CONFIG["TARGET_FS"]) > 0.5:
                raw.resample(PIPELINE_CONFIG["TARGET_FS"], method="polyphase", verbose=False)

        fs = float(PIPELINE_CONFIG["TARGET_FS"])
        raw_data = raw.get_data().astype(np.float32)
        n_samples = raw_data.shape[1]
        del raw
        gc.collect()

        adapted_data, adapted_names, montage = adapt_to_bipolar(raw_data, raw_channel_names, n_samples)
        del raw_data
        gc.collect()
        metadata["montage_type"] = montage

        data, channel_mask = enforce_channels(adapted_data, adapted_names, n_samples, filename)
        del adapted_data
        gc.collect()

        real_indices = np.where(channel_mask)[0]
        apply_notch(data, fs, powerline_hz, channels=real_indices)
        apply_bandpass(data, fs, channels=real_indices)
        robust_normalize(data, fs, seizure_intervals=[], channels=real_indices)

        n_windows = max(0, (n_samples - WINDOW_SAMPLES) // SEIZURE_STRIDE_SAMPLES + 1)
        metadata.update(
            n_mapped=int(channel_mask.sum()),
            missing_channels=[STANDARD_CHANNELS[index] for index in range(N_CHANNELS) if not channel_mask[index]],
            n_windows=n_windows,
            sampling_rate_processed=fs,
            source_types=["observed" if channel_mask[index] else "missing" for index in range(N_CHANNELS)],
            channel_mask=channel_mask.astype(bool).tolist(),
        )
        return data, channel_mask, metadata
    except ValueError as exc:
        logger.warning("Skipping EDF %s because preprocessing rejected it: %s", filename, exc)
        metadata["error"] = str(exc)
    except Exception as exc:  # pragma: no cover - direct I/O failures are environment dependent
        logger.exception("Unexpected preprocessing failure for %s", filename)
        metadata["error"] = str(exc)

    return None, np.zeros(N_CHANNELS, dtype=bool), metadata


def extract_window_at(data: np.ndarray, index: int, stride: int = SEIZURE_STRIDE_SAMPLES, win: int = WINDOW_SAMPLES) -> np.ndarray:
    """Extract a single window from the data array by window index."""
    start = index * stride
    return data[:, start : start + win].copy().astype(np.float32)


def preprocess_any_edf(edf_path: str) -> tuple[np.ndarray | None, np.ndarray, dict[str, Any]]:
    """Preprocess EDF and extract ALL windows. Use preprocess_edf_to_data() for large files."""
    data, channel_mask, metadata = preprocess_edf_to_data(edf_path)
    if data is None:
        return None, channel_mask, metadata

    windows, good_window_count, _ = extract_windows_vectorised(
        data,
        WINDOW_SAMPLES,
        SEIZURE_STRIDE_SAMPLES,
        channel_mask,
        PIPELINE_CONFIG["AMP_THRESHOLD"],
        skip_artifact_rejection=True,
    )
    del data
    gc.collect()

    metadata["n_windows"] = good_window_count if windows is not None else 0
    return windows, channel_mask, metadata

