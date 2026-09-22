from collections.abc import Sequence


PIPELINE_CONFIG = {
    "TARGET_FS": 256,
    "BANDPASS_LOW": 0.5,
    "BANDPASS_HIGH": 40.0,
    "NOTCH_CANDIDATES": [50.0, 60.0],
    "NOTCH_Q": 20,
    "NOTCH_HARMONICS": True,
    "WINDOW_SEC": 4,
    "STRIDE_SEC": 4,
    "STRIDE_SZ_SEC": 1,
    "AMP_THRESHOLD": 5.0,
    "MAX_MISSING_CH": 3,
}

STANDARD_CHANNELS: list[str] = [
    "FP1-F7",
    "F7-T7",
    "T7-P7",
    "P7-O1",
    "FP1-F3",
    "F3-C3",
    "C3-P3",
    "P3-O1",
    "FP2-F4",
    "F4-C4",
    "C4-P4",
    "P4-O2",
    "FP2-F8",
    "F8-T8",
    "T8-P8",
    "P8-O2",
    "FZ-CZ",
    "CZ-PZ",
    "P7-T7",
    "T7-FT9",
    "FT9-FT10",
    "FT10-T8",
]

CHANNEL_TO_REGION = {
    0: "Left Temporal",
    1: "Left Temporal",
    2: "Left Temporal",
    3: "Left Temporal",
    4: "Left Frontal",
    5: "Left Central",
    6: "Left Parietal",
    7: "Left Occipital",
    8: "Right Frontal",
    9: "Right Central",
    10: "Right Parietal",
    11: "Right Occipital",
    12: "Right Temporal",
    13: "Right Temporal",
    14: "Right Temporal",
    15: "Right Temporal",
    16: "Midline Frontal",
    17: "Midline Parietal",
    18: "Left Temporal",
    19: "Left Inferior",
    20: "Bilateral Inferior",
    21: "Right Inferior",
}

N_CHANNELS = len(STANDARD_CHANNELS)
WINDOW_SAMPLES = int(PIPELINE_CONFIG["WINDOW_SEC"] * PIPELINE_CONFIG["TARGET_FS"])
STRIDE_SAMPLES = int(PIPELINE_CONFIG["STRIDE_SEC"] * PIPELINE_CONFIG["TARGET_FS"])
SEIZURE_STRIDE_SAMPLES = int(PIPELINE_CONFIG["STRIDE_SZ_SEC"] * PIPELINE_CONFIG["TARGET_FS"])

PRODUCTION_METRICS = {
    "version": "V4 production",
    "accuracy_pct": 99.55,
    "macro_f1": 0.979,
    "event_fp_per_hour": 0.98,
    "event_sensitivity_pct": 73.3,
    "detection_latency_seconds": 3.5,
    "zero_shot_siena_sensitivity_pct": 80.0,
    "zero_shot_siena_events_per_hour": 1.67,
}

SCOUT_FULL_NAME = "SCOUT — Seizure Clinical Operations & Understanding Tool"


def top_items(items: Sequence[tuple[str, float]], count: int = 3) -> list[tuple[str, float]]:
    return sorted(items, key=lambda item: item[1], reverse=True)[:count]
