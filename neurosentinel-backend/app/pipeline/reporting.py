from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import Any

import numpy as np
from scipy.signal import welch

from app.pipeline.config import CHANNEL_TO_REGION, PRODUCTION_METRICS, STANDARD_CHANNELS, top_items
from app.pipeline.explainability import generate_brain_heatmap, map_channel_importance_to_regions


def compute_signal_quality(window: np.ndarray, channel_mask: np.ndarray, fs: int = 256) -> dict[str, Any]:
    active_channels = np.where(channel_mask)[0]
    noise_scores: list[float] = []
    for channel_index in active_channels:
        freqs, power = welch(window[channel_index], fs=fs, nperseg=min(256, len(window[channel_index])))
        high_frequency_mask = freqs > 30
        total_power = power.sum() + 1e-12
        noise_scores.append(float(power[high_frequency_mask].sum() / total_power))

    variances = np.var(window[active_channels], axis=1) if len(active_channels) else np.array([])
    flatline_channels = active_channels[variances < 1e-6].tolist() if len(active_channels) else []
    score = 1.0
    score -= min((float(np.mean(noise_scores)) if noise_scores else 0.0) * 2, 0.3)
    score -= min(len(flatline_channels) * 0.1, 0.3)
    score -= 0.2 if len(variances) and bool(variances.max() > 100 or variances.min() < 1e-4) else 0.0
    score -= min((22 - len(active_channels)) * 0.05, 0.2)
    score = round(max(0.0, min(1.0, score)), 3)
    grade = "Good" if score > 0.7 else "Moderate" if score > 0.4 else "Poor"
    return {
        "overall_score": score,
        "grade": grade,
        "noise_ratio_mean": float(np.mean(noise_scores)) if noise_scores else 0.0,
        "flatline_channels": flatline_channels,
        "missing_channels": [STANDARD_CHANNELS[index] for index in range(22) if not channel_mask[index]],
    }


def assess_recording_quality(windows: np.ndarray, channel_mask: np.ndarray, fs: int = 256, sample_every: int = 10) -> dict[str, Any]:
    scores: list[float] = []
    grades: list[str] = []
    noise_ratios: list[float] = []
    for index in range(0, len(windows), sample_every):
        quality = compute_signal_quality(windows[index], channel_mask, fs=fs)
        scores.append(float(quality["overall_score"]))
        grades.append(str(quality["grade"]))
        noise_ratios.append(float(quality["noise_ratio_mean"]))
    grade_counts = Counter(grades)
    dominant_grade = grade_counts.most_common(1)[0][0] if grade_counts else "Unknown"
    return {
        "mean_quality_score": round(float(np.mean(scores)), 3) if scores else 0.0,
        "dominant_grade": dominant_grade,
        "grade_distribution": dict(grade_counts),
        "mean_noise_ratio": round(float(np.mean(noise_ratios)), 4) if noise_ratios else 0.0,
        "missing_channels": [channel for index, channel in enumerate(STANDARD_CHANNELS) if not channel_mask[index]],
        "n_windows_assessed": len(scores),
        "source": "COMPUTED — signal statistics, not model output",
    }


def characterize_seizure_type(window_data: np.ndarray, channel_mask: np.ndarray, fs: int = 256) -> dict[str, Any]:
    active_channels = np.where(channel_mask)[0]
    if len(active_channels) == 0:
        return {
            "dominant_frequency_band": "unknown",
            "band_powers": {},
            "n_channels_involved": 0,
            "spread_ratio": 0.0,
            "pattern_type": "unknown",
            "source": "HEURISTIC — insufficient active channels",
        }
    frequencies = np.fft.rfftfreq(window_data.shape[1], d=1 / fs)
    fft_power = np.abs(np.fft.rfft(window_data[active_channels], axis=1)) ** 2
    bands = {"delta": (0.5, 4), "theta": (4, 8), "alpha": (8, 13), "beta": (13, 30), "gamma": (30, 40)}
    band_powers = {}
    for name, (low, high) in bands.items():
        mask = (frequencies >= low) & (frequencies < high)
        band_powers[name] = float(fft_power[:, mask].mean()) if mask.any() else 0.0
    dominant_band = max(band_powers, key=band_powers.get) if band_powers else "unknown"
    channel_energies = np.var(window_data[active_channels], axis=1)
    threshold = float(np.percentile(channel_energies, 50)) if len(channel_energies) else 0.0
    involved_channels = int((channel_energies > threshold).sum()) if len(channel_energies) else 0
    spread_ratio = involved_channels / max(len(active_channels), 1)
    pattern_type = "generalized" if spread_ratio > 0.7 else "regional" if spread_ratio > 0.3 else "focal"
    return {
        "dominant_frequency_band": dominant_band,
        "band_powers": {name: round(value, 6) for name, value in band_powers.items()},
        "n_channels_involved": involved_channels,
        "spread_ratio": round(spread_ratio, 3),
        "pattern_type": pattern_type,
        "source": "HEURISTIC — not ground-truth seizure type",
    }


def compute_severity_score(event_data: dict[str, Any]) -> dict[str, Any]:
    score = 0.0
    duration_sec = float(event_data.get("duration_sec", 0))
    if duration_sec > 300:
        score += 3.0
    elif duration_sec > 120:
        score += 2.5
    elif duration_sec > 60:
        score += 2.0
    elif duration_sec > 30:
        score += 1.5
    elif duration_sec > 10:
        score += 1.0
    else:
        score += 0.5

    score += min(float(event_data.get("peak_amplitude", 0)) / 3.0, 2.0)
    score += float(event_data.get("spread_ratio", 0)) * 2.0

    band_powers = event_data.get("band_powers", {})
    if isinstance(band_powers, dict) and band_powers:
        total_power = float(sum(band_powers.values())) + 1e-12
        score += min(float(band_powers.get("gamma", 0)) / total_power * 5, 1.5)
    score += float(event_data.get("mean_probability", 0)) * 1.5
    final_score = round(min(10.0, score), 1)
    return {
        "score": final_score,
        "risk_level": "Critical" if final_score >= 8 else "High" if final_score >= 6 else "Medium" if final_score >= 3 else "Low",
        "source": "HEURISTIC — rule-based, not trained",
    }


def detect_early_warning(probabilities: np.ndarray, current_index: int, baseline_window: int = 60, warning_threshold: float = 2.0) -> dict[str, Any]:
    if current_index < baseline_window:
        return {"warning": False, "reason": "Insufficient baseline"}
    baseline = probabilities[current_index - baseline_window : current_index - 10]
    recent = probabilities[current_index - 5 : current_index]
    if len(baseline) == 0 or len(recent) == 0:
        return {"warning": False}
    baseline_mean = float(np.mean(baseline))
    baseline_std = float(np.std(baseline)) + 1e-6
    z_score = (float(np.mean(recent)) - baseline_mean) / baseline_std
    return {
        "warning": bool(z_score > warning_threshold),
        "z_score": round(z_score, 2),
        "baseline_prob": round(baseline_mean, 4),
        "current_prob": round(float(np.mean(recent)), 4),
        "source": "DERIVED — statistical comparison to baseline",
    }


def classify_focal_vs_generalized(event_data: dict[str, Any]) -> dict[str, Any]:
    n_channels_involved = int(event_data.get("n_channels_involved", 0))
    classification = "generalized" if n_channels_involved > 14 else "focal" if n_channels_involved < 7 else "regional"
    return {
        "classification": classification,
        "n_channels_involved": n_channels_involved,
        "source": "HEURISTIC — channel count threshold",
    }


def _risk_rank(risk_level: str) -> int:
    return {"Low": 0, "Medium": 1, "High": 2, "Critical": 3}.get(risk_level, 0)


def _derive_suspicious_risk(
    n_windows_above: int,
    raw_prob_max: float,
    seizure_ratio: float,
    quality_grade: str,
    domain_shift: float,
) -> tuple[str, str]:
    """Derive risk level and pattern_alert_level for SUSPICIOUS state.

    Returns (risk_level, pattern_alert_level) where pattern_alert_level
    is 'elevated' (high burden) or 'low' (marginal signal).
    """
    # Score the evidence burden (0-10)
    score = 0.0
    score += min(n_windows_above / 20, 3.0)          # up to 3 pts for window count
    score += min(raw_prob_max * 3.0, 3.0)             # up to 3 pts for peak probability
    score += min(seizure_ratio * 30, 2.0)             # up to 2 pts for seizure ratio
    # Penalize for poor quality or high domain shift (less trustworthy signal)
    if quality_grade.lower() in ("poor", "unreliable"):
        score -= 1.5
    if domain_shift >= 0.7:
        score -= 1.0  # High domain shift = elevated FP risk
    elif domain_shift >= 0.4:
        score -= 0.5
    score = max(0.0, min(10.0, score))

    if score >= 5.0:
        return ("Medium", "elevated")   # Elevated concern: many windows, high probability
    elif score >= 2.0:
        return ("Medium", "low")        # Low concern but still flagged
    else:
        return ("Low", "low")           # Marginal signal, likely noise


def _build_recommendations(risk: str, status_epilepticus: bool, early_warning: bool, event_count: int, diagnostic_state: str = "CLEAR") -> list[str]:
    recommendations = []
    if status_epilepticus:
        recommendations.append("URGENT: status epilepticus is suspected from duration heuristics and needs immediate neurologist review.")
    if risk == "Critical":
        recommendations.append("Critical risk pattern detected. Escalate to neurology immediately.")
    elif risk == "High":
        recommendations.append("High-risk pattern detected. Neurologist review is strongly recommended within 24 hours.")
    elif diagnostic_state == "SUSPICIOUS":
        recommendations.append("Suspicious seizure-like patterns detected by the model but no events survived post-processing filters. Neurologist review is recommended to evaluate clinical significance.")
    else:
        recommendations.append("Routine neurologist review is recommended for final interpretation.")
    if early_warning:
        recommendations.append("Pre-ictal trend detected. Monitor closely and correlate with direct clinical observation.")
    if event_count > 3:
        recommendations.append(f"Multiple events ({event_count}) were detected. Evaluate for seizure clustering.")
    if diagnostic_state == "SUSPICIOUS":
        recommendations.append("Consider extended or repeat EEG monitoring if clinical suspicion for seizures persists despite no confirmed events in this recording.")
    recommendations.append("Correlate all findings with direct clinical observation and patient history.")
    recommendations.append("Heuristic outputs are estimates and require clinical validation.")
    return recommendations


def generate_clinical_report(analysis_results: dict[str, Any]) -> dict[str, Any]:
    events = analysis_results.get("events", [])
    quality = analysis_results.get("quality_grade", "Unknown")
    quality_score = analysis_results.get("quality_score", 0.0)
    duration = analysis_results.get("duration_minutes", 0.0)
    missing_channels = analysis_results.get("missing_channels", "None")
    risk = analysis_results.get("risk_level", "Low")
    recording_id = analysis_results.get("recording_id", "Unknown")
    trend_summary = analysis_results.get("trend_summary", "N/A")
    early_warning = analysis_results.get("early_warning", False)
    status_epilepticus = analysis_results.get("se_flag", False)
    top_channels = analysis_results.get("channel_importance_summary", "N/A")
    top_regions = analysis_results.get("top_regions", [])
    timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
    diagnostic_state = analysis_results.get("diagnostic_state", "CLEAR")
    suppressed = analysis_results.get("suppressed_candidates")

    badge = {"Low": "🟢", "Medium": "🟡", "High": "🟠", "Critical": "🔴"}.get(risk, "⚪")

    report_dict = {
        "meta": {
            "recording_id": recording_id,
            "generated_at": timestamp,
            "duration_min": round(float(duration), 1),
            "tool": "NeuroSentinel AI v4",
            "disclaimer": "Decision support only. Not a medical diagnosis. Neurologist review required.",
        },
        "signal_quality": {
            "grade": quality,
            "score": quality_score,
            "missing_channels": missing_channels,
        },
        "summary": {
            "total_events": len(events),
            "overall_risk": risk,
            "trend_summary": trend_summary,
            "early_warning": early_warning,
            "status_epilepticus": status_epilepticus,
        },
        "events": [
            {
                "id": event["event_idx"],
                "onset_sec": event["onset_sec"],
                "offset_sec": event["offset_sec"],
                "duration_sec": event["duration_sec"],
                "confidence_pct": round(float(event["mean_probability"]) * 100, 1),
                "severity": event.get("severity_score", "N/A"),
                "risk_level": event.get("risk_level", "N/A"),
                "pattern": event.get("pattern_type", "N/A"),
                "focal_vs_gen": event.get("focal_vs_gen", "N/A"),
                "isi_sec": event.get("inter_seizure_interval"),
                "band_powers": event.get("band_powers", {}),
            }
            for event in events
        ],
        "explainability": {
            "top_channels": top_channels,
            "top_regions": top_regions,
        },
        "recommendations": _build_recommendations(risk, bool(status_epilepticus), bool(early_warning), len(events), analysis_results.get("diagnostic_state", "CLEAR")),
    }

    event_markdown = ""
    for event in events:
        inter_seizure_row = f"| Inter-seizure Interval | {event.get('inter_seizure_interval')}s |\n" if event.get("inter_seizure_interval") is not None else ""
        band_powers = event.get("band_powers", {})
        dominant_band = max(band_powers, key=band_powers.get) if band_powers else "N/A"
        event_markdown += f"""
#### Event {event['event_idx']} — {event.get('risk_level', 'Low')} Risk

| Field | Value |
|---|---|
| Onset → Offset | {event['onset_sec']}s → {event['offset_sec']}s |
| Duration | {event['duration_sec']}s |
| Confidence | {round(float(event['mean_probability']) * 100, 1)}% |
| Severity Score | {event.get('severity_score', 'N/A')}/10 `[HEURISTIC]` |
| Spread Pattern | {event.get('pattern_type', 'N/A')} `[HEURISTIC]` |
| Classification | {event.get('focal_vs_gen', 'N/A')} `[HEURISTIC]` |
| Dominant Band | {dominant_band} `[HEURISTIC]` |
{inter_seizure_row}"""

    recommendations_markdown = "\n".join(f"- {recommendation}" for recommendation in report_dict["recommendations"])
    top_region_string = ", ".join(f"{name} ({score:.3f})" for name, score in top_regions) if top_regions else "N/A"
    markdown = f"""# NeuroSentinel AI — Clinical EEG Report

> Generated: {timestamp}
> Recording ID: `{recording_id}`
> Tool: NeuroSentinel AI v4

## 1. Signal Quality

| Metric | Value |
|---|---|
| Grade | **{quality}** |
| Quality Score | {quality_score} / 1.0 |
| Duration Analyzed | {round(float(duration), 1)} min |
| Missing Channels | {missing_channels} |

## 2. Executive Summary

| | |
|---|---|
| Seizure Events Detected | **{len(events)}**{' (suspicious candidate activity suppressed by post-processing)' if diagnostic_state == 'SUSPICIOUS' else ''} |
| Diagnostic State | **{diagnostic_state}** |
| Overall Risk Level | {badge} **{risk}** |
| Early Warning Signal | {'Yes' if early_warning else 'No'} |
| Status Epilepticus Flag | {'Yes' if status_epilepticus else 'No'} |

Trend: {trend_summary}

## 3. Detected Events
{event_markdown if events else (
    f'_No confirmed seizure events. However, the model flagged {suppressed["n_windows_above_threshold"]} '
    f'candidate window(s) with seizure-like probability (max {suppressed["max_probability"]:.1%}, '
    f'seizure ratio {suppressed["seizure_ratio"]:.1%}). These did not meet post-processing '
    f'criteria and were suppressed. Clinical correlation is recommended._'
    if diagnostic_state == 'SUSPICIOUS' and suppressed
    else '_No seizure events detected in this recording._'
)}

## 4. Brain Region & Channel Analysis

Top contributing channels: {top_channels}
Top active regions: {top_region_string}

## 5. Recommendations

{recommendations_markdown}

## Disclaimer

NeuroSentinel AI is a decision support tool only.
All findings must be reviewed by a qualified neurologist.
Heuristic values are rule-based estimates, not ground truth.
"""
    return {"dict": report_dict, "markdown": markdown}


def build_full_report_payload(
    filename: str,
    inference_result: dict[str, Any],
    windows: np.ndarray,
    channel_mask: np.ndarray,
    channel_importance: np.ndarray | None = None,
    attention_weights: np.ndarray | None = None,
) -> dict[str, Any]:
    raw_probabilities = np.asarray(inference_result["raw_probabilities"], dtype=np.float32)
    events = inference_result["events"]
    quality = assess_recording_quality(windows, channel_mask)
    region_scores = map_channel_importance_to_regions(channel_importance, channel_mask) if channel_importance is not None else {}
    top_regions = top_items(list(region_scores.items()), 3)
    top_channels = []
    if channel_importance is not None:
        ranked_channels = sorted(
            [
                (STANDARD_CHANNELS[index], round(float(channel_importance[index]), 4))
                for index in range(len(STANDARD_CHANNELS))
                if bool(channel_mask[index])
            ],
            key=lambda item: item[1],
            reverse=True,
        )
        top_channels = ranked_channels[:5]

    enriched_events: list[dict[str, Any]] = []
    highest_event_risk = "Low"
    early_warning_flag = False
    for event_index, (onset_sec, offset_sec) in enumerate(events, start=1):
        start_index = int(onset_sec)
        end_index = min(int(offset_sec), len(raw_probabilities))
        event_probabilities = raw_probabilities[start_index:end_index]
        representative_index = start_index + int(np.argmax(event_probabilities)) if len(event_probabilities) else min(start_index, len(windows) - 1)
        representative_window = windows[min(representative_index, len(windows) - 1)]
        seizure_type = characterize_seizure_type(representative_window, channel_mask)
        mean_probability = float(event_probabilities.mean()) if len(event_probabilities) else 0.0
        peak_probability = float(event_probabilities.max()) if len(event_probabilities) else 0.0
        severity = compute_severity_score(
            {
                "duration_sec": offset_sec - onset_sec,
                "peak_amplitude": float(np.abs(representative_window[np.where(channel_mask)[0]]).max()) if np.where(channel_mask)[0].size else 0.0,
                "spread_ratio": seizure_type["spread_ratio"],
                "band_powers": seizure_type["band_powers"],
                "mean_probability": mean_probability,
            }
        )
        focal_vs_generalized = classify_focal_vs_generalized(seizure_type)
        early_warning = detect_early_warning(raw_probabilities, start_index)
        early_warning_flag = early_warning_flag or bool(early_warning.get("warning"))
        inter_seizure_interval = round(onset_sec - events[event_index - 2][1], 2) if event_index > 1 else None
        highest_event_risk = severity["risk_level"] if _risk_rank(severity["risk_level"]) > _risk_rank(highest_event_risk) else highest_event_risk
        enriched_events.append(
            {
                "event_idx": event_index,
                "onset_sec": round(float(onset_sec), 2),
                "offset_sec": round(float(offset_sec), 2),
                "duration_sec": round(float(offset_sec - onset_sec), 2),
                "inter_seizure_interval": inter_seizure_interval,
                "mean_probability": round(mean_probability, 4),
                "peak_probability": round(peak_probability, 4),
                "peak_amplitude": round(float(np.abs(representative_window).max()), 4),
                "pattern_type": seizure_type["pattern_type"],
                "dominant_frequency_band": seizure_type["dominant_frequency_band"],
                "band_powers": seizure_type["band_powers"],
                "n_channels_involved": seizure_type["n_channels_involved"],
                "spread_ratio": seizure_type["spread_ratio"],
                "severity_score": severity["score"],
                "risk_level": severity["risk_level"],
                "focal_vs_gen": focal_vs_generalized["classification"],
                "early_warning": bool(early_warning.get("warning")),
                "early_warning_z_score": early_warning.get("z_score"),
                "top_regions": [region for region, _score in top_regions],
            }
        )

    status_epilepticus = any(float(event["duration_sec"]) > 300 for event in enriched_events)

    # ── Raw-probability seizure detection ──────────────────────────
    raw_prob_max = float(inference_result["raw_prob_max"])
    seizure_ratio = float((raw_probabilities > 0.5).mean())
    n_windows_above_50 = int((raw_probabilities > 0.5).sum())
    model_detects_seizure = raw_prob_max > 0.5 or seizure_ratio > 0.05

    # ══════════════════════════════════════════════════════════════
    # DIAGNOSTIC STATE MACHINE — single source of truth
    # ══════════════════════════════════════════════════════════════
    # DETECTED     → post-processed events exist (confirmed seizure)
    # SUSPICIOUS   → model saw seizure-like patterns, but post-processing
    #                removed all discrete events (no confirmed events)
    # CLEAR        → model did not detect any seizure-like activity
    # ──────────────────────────────────────────────────────────────
    if enriched_events:
        diagnostic_state = "DETECTED"
        result_label = "Seizure Detected"
        pattern_alert_level = None
    elif model_detects_seizure:
        diagnostic_state = "SUSPICIOUS"
        result_label = "Suspicious Activity"
        # Risk is derived from evidence burden, not hardcoded
        suspicious_risk, pattern_alert_level = _derive_suspicious_risk(
            n_windows_above_50,
            raw_prob_max,
            seizure_ratio,
            quality["dominant_grade"],
            float(inference_result.get("output_domain_shift", 0.0)),
        )
        highest_event_risk = suspicious_risk
    else:
        diagnostic_state = "CLEAR"
        result_label = "No Seizure"
        pattern_alert_level = None

    # Suppressed candidate info for SUSPICIOUS state transparency
    suppressed_candidates = None
    if diagnostic_state == "SUSPICIOUS":
        pp_config = inference_result.get("post_process_config", {})
        suppressed_candidates = {
            "n_windows_above_threshold": n_windows_above_50,
            "max_probability": round(raw_prob_max, 4),
            "seizure_ratio": round(seizure_ratio, 4),
            "pattern_alert_level": pattern_alert_level,
            "filter_criteria": {
                "min_duration_sec": pp_config.get("min_duration"),
                "min_mean_prob": pp_config.get("min_mean_prob"),
                "sustained_sec": pp_config.get("sustained_sec"),
                "sustained_threshold": pp_config.get("sustained_thresh"),
            },
            "reason": "Seizure-like probability spikes were detected but did not meet post-processing criteria "
                      "(minimum duration, sustained threshold, or mean probability filters). "
                      "This may indicate brief, sub-threshold, or borderline epileptiform patterns.",
        }

    n_ev = len(enriched_events)
    if diagnostic_state == "DETECTED":
        trend_summary = f"{n_ev} event{'s' if n_ev != 1 else ''} detected with {highest_event_risk.lower()} overall heuristic risk."
    elif diagnostic_state == "SUSPICIOUS":
        trend_summary = (
            f"Model flagged {n_windows_above_50} window(s) with seizure-like probability (max {raw_prob_max:.1%}, "
            f"seizure ratio {seizure_ratio:.1%}), but post-processing filters removed all discrete events. "
            f"No confirmed seizure events. Clinical correlation recommended."
        )
    else:
        trend_summary = "No seizure activity detected in this recording."

    # ── Confidence score ──────────────────────────────────────────
    if diagnostic_state == "DETECTED":
        confidence_score = round(max(event["mean_probability"] for event in enriched_events) * 100, 1)
    elif diagnostic_state == "SUSPICIOUS":
        top_probs = raw_probabilities[raw_probabilities > 0.5]
        if len(top_probs) > 0:
            confidence_score = round(float(np.percentile(top_probs, 75)) * 100, 1)
        else:
            confidence_score = round(raw_prob_max * 100, 1)
    else:
        if raw_prob_max < 0.1:
            confidence_score = 95.0
        elif raw_prob_max < 0.2:
            confidence_score = 88.0
        elif raw_prob_max < 0.3:
            confidence_score = 78.0
        elif raw_prob_max < 0.4:
            confidence_score = 65.0
        else:
            confidence_score = round((1.0 - raw_prob_max) * 100, 1)

    risk_level = highest_event_risk if diagnostic_state in ("DETECTED", "SUSPICIOUS") else "Low"

    payload = {
        "recording_id": filename,
        "file_name": filename,
        "diagnostic_state": diagnostic_state,
        "result_label": result_label,
        "confidence_score": confidence_score,
        "quality_grade": quality["dominant_grade"],
        "quality_score": quality["mean_quality_score"],
        "duration_minutes": round(float(inference_result["metadata"].get("duration_sec", 0.0)) / 60, 1),
        "missing_channels": quality["missing_channels"] or "None",
        "risk_level": risk_level,
        "trend_summary": trend_summary,
        "early_warning": early_warning_flag,
        "se_flag": status_epilepticus,
        "channel_importance_summary": ", ".join(f"{name} ({score:.3f})" for name, score in top_channels) if top_channels else "Unavailable",
        "top_regions": top_regions,
        "events": enriched_events,
        "suppressed_candidates": suppressed_candidates,
        "model_outputs": {
            "probability_timeline": [round(float(probability), 4) for probability in raw_probabilities.tolist()],
            "probability_summary": {
                "mean": inference_result["raw_prob_mean"],
                "median": inference_result["raw_prob_median"],
                "p99": inference_result["raw_prob_p99"],
                "max": inference_result["raw_prob_max"],
            },
            "events_per_hour": inference_result["events_per_hour"],
            "output_domain_shift": inference_result["output_domain_shift"],
            "shift_label": inference_result["shift_label"],
            "threshold_high": inference_result["threshold_high"],
            "threshold_low": inference_result["threshold_low"],
            "post_process_config": inference_result["post_process_config"],
        },
        "quality": quality,
        "explainability": {
            "channel_importance": [round(float(value), 4) for value in channel_importance.tolist()] if channel_importance is not None else [],
            "attention_weights": [round(float(value), 4) for value in attention_weights.flatten().tolist()] if attention_weights is not None else [],
            "top_channels": top_channels,
            "top_regions": top_regions,
            "brain_heatmap": generate_brain_heatmap(channel_importance, channel_mask) if channel_importance is not None else None,
        },
        "declared_metrics": PRODUCTION_METRICS,
        "metadata": inference_result["metadata"],
    }

    clinical_report = generate_clinical_report(payload)

    # State-driven summary text
    if diagnostic_state == "DETECTED":
        summary_text = (
            f"Seizure Detected. {n_ev} event{'s' if n_ev != 1 else ''}, {risk_level} risk, "
            f"signal quality {payload['quality_grade'].lower()}, confidence {confidence_score:.1f}%."
        )
    elif diagnostic_state == "SUSPICIOUS":
        summary_text = (
            f"Suspicious Activity. {n_windows_above_50} window(s) flagged (max prob {raw_prob_max:.1%}), "
            f"0 confirmed events after filtering, {risk_level} risk, "
            f"signal quality {payload['quality_grade'].lower()}, confidence {confidence_score:.1f}%."
        )
    else:
        summary_text = (
            f"No Seizure. 0 events, Low risk, "
            f"signal quality {payload['quality_grade'].lower()}, confidence {confidence_score:.1f}%."
        )

    return {
        "summary_text": summary_text,
        "result_label": result_label,
        "diagnostic_state": diagnostic_state,
        "confidence_score": confidence_score,
        "event_count": len(enriched_events),
        "risk_level": risk_level,
        "quality_grade": payload["quality_grade"],
        "duration_minutes": payload["duration_minutes"],
        "report_json": {
            **payload,
            "clinical_report": clinical_report["dict"],
            "clinical_report_markdown": clinical_report["markdown"],
        },
    }
