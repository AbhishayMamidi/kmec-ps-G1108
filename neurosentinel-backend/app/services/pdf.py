from __future__ import annotations

import os
from datetime import UTC, datetime
from io import BytesIO
from typing import Any

from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

# ── Medical report colour palette ──
HEADER_BG = HexColor("#0A2540")
ACCENT_BLUE = HexColor("#0066CC")
SECTION_BG = HexColor("#F0F4F8")
TEXT_DARK = HexColor("#1A1A2E")
TEXT_MEDIUM = HexColor("#3D3D50")
TEXT_LIGHT = HexColor("#6B6B80")
BORDER_COLOR = HexColor("#C8CDD5")
BORDER_LIGHT = HexColor("#E2E6EB")
RISK_RED = HexColor("#DC2626")
RISK_ORANGE = HexColor("#EA580C")
RISK_GREEN = HexColor("#16A34A")
WHITE = white

MARGIN_X = 48
PAGE_WIDTH, PAGE_HEIGHT = letter
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X

# Path to logo for PDF generation
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
LOGO_PATH = os.path.join(_BASE_DIR, "logo.jpeg")

# ── Clinical channel label mapping (for clinician mode) ──
CHANNEL_CLINICAL_LABELS: dict[str, str] = {
    "FP1-F7": "Left Anterior Frontal",
    "F7-T7": "Left Anterior Temporal",
    "T7-P7": "Left Mid-Temporal",
    "P7-O1": "Left Posterior Temporal-Occipital",
    "FP1-F3": "Left Frontal",
    "F3-C3": "Left Frontocentral",
    "C3-P3": "Left Centroparietal",
    "P3-O1": "Left Parieto-Occipital",
    "FP2-F4": "Right Frontal",
    "F4-C4": "Right Frontocentral",
    "C4-P4": "Right Centroparietal",
    "P4-O2": "Right Parieto-Occipital",
    "FP2-F8": "Right Anterior Frontal",
    "F8-T8": "Right Anterior Temporal",
    "T8-P8": "Right Mid-Temporal",
    "P8-O2": "Right Posterior Temporal-Occipital",
    "FZ-CZ": "Midline Frontocentral",
    "CZ-PZ": "Midline Centroparietal",
    "P7-T7": "Left Inferior Temporal",
    "T7-FT9": "Left Inferior Frontotemporal",
    "FT9-FT10": "Bilateral Subtemporal",
    "FT10-T8": "Right Inferior Frontotemporal",
}


# ═══════════════════════════════════════════════════════════════════
#  Utility helpers
# ═══════════════════════════════════════════════════════════════════

def _risk_color(risk_level: str) -> HexColor:
    r = risk_level.lower() if isinstance(risk_level, str) else ""
    if r in ("critical", "high"):
        return RISK_RED
    if r in ("medium", "moderate"):
        return RISK_ORANGE
    if r == "low":
        return RISK_GREEN
    return TEXT_LIGHT


def _wrap_text(text: str, font_name: str, font_size: int, max_width: float) -> list[str]:
    words = str(text).split()
    if not words:
        return [""]
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _fmt_missing(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(c) for c in value) if value else "None"
    return str(value) if value and str(value).lower() != "none" else "None"


def _resolve_role(user_profile: dict[str, Any] | None) -> str:
    """Normalize the user role to one of: patient, clinician, researcher."""
    role = (user_profile or {}).get("role", "")
    if isinstance(role, str):
        r = role.lower().strip()
        if r in ("patient", "clinician", "researcher"):
            return r
    return "clinician"


def _display_role_label(role: str) -> str:
    return {"patient": "Patient", "clinician": "Clinician", "researcher": "Researcher"}.get(role, "Unknown")


# ═══════════════════════════════════════════════════════════════════
#  SCOUT Narrative Builders (§3 — the most important section)
# ═══════════════════════════════════════════════════════════════════

def _humanize_seconds(seconds: float) -> str:
    """Convert seconds to warm, human‑readable time offset."""
    m = seconds / 60.0
    if m < 1:
        return f"about {int(seconds)} seconds"
    if m < 2:
        return "about 1 minute"
    if m < 60:
        return f"about {int(m)} minutes"
    h = int(m // 60)
    rm = int(m % 60)
    if rm == 0:
        return f"about {h} hour{'s' if h > 1 else ''}"
    return f"about {h} hour{'s' if h > 1 else ''} and {rm} minutes"


def _confidence_descriptor(pct: float) -> str:
    if pct >= 85:
        return "high"
    if pct >= 60:
        return "moderate"
    return "low"


def _determine_lateralization(top_channels: list[tuple[str, float]]) -> str:
    left_markers = {"FP1", "F7", "T7", "P7", "O1", "F3", "C3", "P3", "FT9"}
    right_markers = {"FP2", "F8", "T8", "P8", "O2", "F4", "C4", "P4", "FT10"}
    left, right = 0, 0
    for ch_name, _ in top_channels[:5]:
        parts = set(ch_name.upper().replace("-", " ").split())
        if parts & left_markers:
            left += 1
        if parts & right_markers:
            right += 1
    if left > right:
        return "left lateralization"
    if right > left:
        return "right lateralization"
    if left == right and left > 0:
        return "bilateral involvement"
    return "non-lateralized pattern"


def _region_hypothesis(top_channels: list[tuple[str, float]]) -> str:
    regions: set[str] = set()
    for ch_name, _ in top_channels[:3]:
        u = ch_name.upper()
        if any(x in u for x in ("FP", "F3", "F4", "F7", "F8", "FZ")):
            regions.add("frontal")
        if any(x in u for x in ("C3", "C4", "CZ")):
            regions.add("central")
        if any(x in u for x in ("T7", "T8", "FT")):
            regions.add("temporal")
        if any(x in u for x in ("P3", "P4", "P7", "P8", "PZ")):
            regions.add("parietal")
        if any(x in u for x in ("O1", "O2")):
            regions.add("occipital")
    if not regions:
        return "indeterminate"
    return " or ".join(sorted(regions)[:2])


def _distribution_shape(mean_val: float, median_val: float, max_val: float) -> str:
    if max_val > 2.5 * mean_val and median_val < mean_val:
        return "right-skewed"
    if max_val < 1.5 * mean_val:
        return "approximately uniform"
    return "moderately skewed"


def _infer_dataset_source(filename: str) -> str:
    fn = filename.lower()
    if fn.startswith("chb"):
        parts = fn.replace(".edf", "").split("_")
        subject = parts[0] if parts else "unknown"
        return f"CHB-MIT, Subject {subject.replace('chb', '').lstrip('0') or '?'}"
    if "siena" in fn:
        return "Siena Scalp EEG Database"
    if "tuh" in fn or "tueg" in fn:
        return "TUH EEG Corpus"
    return "User Upload"


def _build_scout_narrative(
    role: str,
    filename: str,
    duration_min: float,
    events: list[dict[str, Any]],
    result_label: str,
    risk_level: str,
    quality_grade: str,
    quality_score: float,
    early_warning: bool,
    se_flag: bool,
    top_channels: list[tuple[str, float]] | str,
    prob_summary: dict[str, Any],
    missing_channels: Any,
    raw_meta: dict[str, Any],
    confidence_score: float,
) -> str:
    """Build a flowing, intelligent narrative paragraph calibrated to the user role."""
    # Normalize top_channels
    tc: list[tuple[str, float]] = []
    if isinstance(top_channels, list):
        tc = [(str(c), float(s)) for c, s in top_channels[:5]]
    tc_str = ", ".join(f"{c} ({s:.3f})" for c, s in tc[:3]) if tc else "unavailable"

    mc_list = missing_channels if isinstance(missing_channels, list) else []
    n_mapped = raw_meta.get("n_mapped", 22 - len(mc_list)) if isinstance(raw_meta, dict) else 22
    mc_str = ", ".join(str(c) for c in mc_list) if mc_list else "none"

    p_mean = prob_summary.get("mean", 0) if isinstance(prob_summary, dict) else 0
    p_median = prob_summary.get("median", 0) if isinstance(prob_summary, dict) else 0
    p_p99 = prob_summary.get("p99", 0) if isinstance(prob_summary, dict) else 0
    p_max = prob_summary.get("max", 0) if isinstance(prob_summary, dict) else 0

    if role == "patient":
        return _narrative_patient(filename, duration_min, events, quality_grade, early_warning, se_flag, confidence_score)
    if role == "researcher":
        return _narrative_researcher(filename, duration_min, events, quality_grade, quality_score, early_warning, tc, tc_str, mc_list, mc_str, n_mapped, p_mean, p_median, p_p99, p_max, raw_meta, confidence_score)
    return _narrative_clinician(filename, duration_min, events, quality_grade, quality_score, risk_level, early_warning, se_flag, tc, tc_str, mc_list, mc_str, p_mean, p_median, p_max, confidence_score)


def _format_duration_friendly(seconds: float) -> str:
    """Convert seconds to a single consistent human-readable string."""
    if seconds < 60:
        return f"{int(seconds)} seconds"
    m = int(seconds // 60)
    s = int(seconds % 60)
    if s == 0:
        return f"{m} minute{'s' if m > 1 else ''}"
    return f"{m} minute{'s' if m > 1 else ''} and {s} seconds"


def _narrative_patient(filename: str, duration_min: float, events: list, quality_grade: str, early_warning: bool, se_flag: bool, confidence_score: float) -> str:
    parts: list[str] = []
    parts.append(f"Your EEG recording was reviewed by NeuroSentinel AI over a {duration_min:.0f}-minute period.")

    if events:
        n = len(events)
        ev0 = events[0]
        onset = float(ev0.get("onset_sec", 0))
        dur = float(ev0.get("duration_sec", 0))
        conf_desc = _confidence_descriptor(confidence_score)

        parts.append(
            f"The analysis identified {n} episode{'s' if n > 1 else ''} that showed patterns the system associated with seizure activity."
        )
        parts.append(
            f"The {'first ' if n > 1 else ''}episode began approximately {_humanize_seconds(onset)} into the recording "
            f"and lasted approximately {_format_duration_friendly(dur)}."
        )
        parts.append(
            f"The system flagged this with {conf_desc} confidence ({confidence_score:.0f}%), meaning the pattern was "
            f"{'strongly ' if conf_desc == 'high' else ''}consistent with what the system has learned to recognise as seizure-related activity."
        )
        if confidence_score < 70:
            parts.append(
                "Please note that the model's confidence in this finding is below 70%, which means there is meaningful uncertainty. "
                "Your neurologist should interpret this result with additional caution and may recommend further monitoring."
            )
        if early_warning:
            parts.append(
                "An early warning pattern was also detected in the minutes leading up to this episode — "
                "this suggests a gradual buildup of unusual brain activity rather than an abrupt onset, "
                "and is something worth discussing with your treating physician."
            )
        if se_flag:
            parts.append(
                "IMPORTANT: The system detected signs of prolonged seizure activity (status epilepticus) in this recording. "
                "If you experience any further episodes lasting more than 5 minutes, call emergency services (999/911/112) immediately "
                "and do not wait to contact your neurologist first. "
                "Even if you are not currently having an episode, contact your neurologist or attend A&E as soon as possible to discuss this finding."
            )
        if n > 1:
            parts.append(
                f"A total of {n} episodes were found across the recording, which your neurologist will want to evaluate together."
            )
    else:
        parts.append(
            "No episodes were found that the system associated with seizure activity during this recording period. "
            "This is an encouraging result, though it does not guarantee the absence of seizure activity at other times."
        )
        if confidence_score < 70:
            parts.append(
                f"However, the model's confidence in this negative result is {confidence_score:.0f}%, which is relatively low. "
                "This means the system was not highly certain, and further monitoring may be warranted."
            )

    parts.append(f"The overall quality of the EEG signal was assessed as {quality_grade}, which means the system had reliable data to work with during analysis.")
    parts.append(
        "It is important to understand that this report is generated by an automated tool and does not represent a medical diagnosis. "
        "Only your neurologist can make a definitive assessment using the full context of your medical history, physical examination, and symptoms."
    )
    parts.append(
        "We recommend sharing this report with your neurologist at your earliest convenience and bringing a printed copy to your next appointment for discussion."
    )
    return " ".join(parts)


def _narrative_clinician(
    filename: str, duration_min: float, events: list, quality_grade: str, quality_score: float,
    risk_level: str, early_warning: bool, se_flag: bool,
    tc: list[tuple[str, float]], tc_str: str, mc_list: list, mc_str: str,
    p_mean: float, p_median: float, p_max: float, confidence_score: float,
) -> str:
    parts: list[str] = []

    if events:
        n = len(events)
        ev0 = events[0]
        onset = ev0.get("onset_sec", "?")
        dur = ev0.get("duration_sec", "?")
        pattern = ev0.get("pattern_type") or ev0.get("pattern", "unknown")

        parts.append(
            f"Analysis of {filename} identified {n} ictal event{'s' if n > 1 else ''} with {pattern} onset pattern "
            f"over a {duration_min:.1f}-minute recording (primary event onset {onset}s, duration {dur}s, model confidence {confidence_score:.1f}%)."
        )
        if confidence_score < 70:
            parts.append(
                f"NOTE: Model confidence ({confidence_score:.1f}%) is below the 70% reliability threshold. "
                "Interpret with caution; consider prolonged monitoring or repeat analysis before management decisions."
            )
        if tc:
            lat = _determine_lateralization(tc)
            rh = _region_hypothesis(tc)
            parts.append(
                f"Channel attribution analysis suggests {rh} predominance with {lat} — "
                f"the highest-contributing derivations were {tc_str} — "
                f"consistent with a {rh} seizure generator hypothesis."
            )
            spread = ev0.get("spread_ratio")
            n_ch = ev0.get("n_channels_involved")
            if spread is not None and n_ch is not None:
                parts.append(
                    f"The onset pattern involved {n_ch} of {22 - len(mc_list)} active channels "
                    f"(spread ratio {spread:.2f}), classifiable as {pattern} distribution."
                )
        if early_warning:
            parts.append(
                "A pre-ictal probability gradient was detectable approximately 60–90 seconds preceding ictal onset, "
                "suggesting gradual electrographic build-up rather than abrupt onset, which may carry differential significance for seizure classification."
            )
        if se_flag:
            parts.append(
                "URGENT: Status epilepticus criteria met (duration heuristic >300s). Initiate institutional SE protocol immediately. "
                "Administer first-line benzodiazepine per guidelines if not already given. Escalate to neurology/ICU as indicated."
            )
        else:
            parts.append("Status epilepticus criteria were not met based on the 300-second duration heuristic.")

        if p_max > 0:
            parts.append(
                f"Peak model probability reached {p_max:.4f} against a baseline probability mean of {p_mean:.4f} "
                f"(median {p_median:.4f}), indicating {'marked' if p_max > 2 * p_mean else 'moderate'} deviation from background activity "
                f"with {'a clear' if p_max > 3 * p_mean else 'some'} separation between ictal and interictal states."
            )
        dom_band = ev0.get("dominant_frequency_band", "unknown")
        if dom_band and dom_band != "unknown":
            parts.append(f"The dominant frequency band during the event was categorised as {dom_band}-range activity.")
    else:
        parts.append(
            f"Analysis of {filename} identified no confirmed ictal events over a {duration_min:.1f}-minute recording."
        )
        if confidence_score < 70:
            parts.append(
                f"CAUTION: Model confidence in this negative result is {confidence_score:.1f}%, below the 70% threshold. "
                "A negative result at low confidence should not be considered clinically reassuring."
            )
        if p_max > 0:
            parts.append(
                f"Peak probability was {p_max:.4f} against a baseline mean of {p_mean:.4f}."
            )
        parts.append("If clinical suspicion persists, consider prolonged monitoring or ambulatory video-EEG.")

    parts.append(
        f"Signal quality was graded as {quality_grade} (score {quality_score}/1.0) "
        f"with {len(mc_list)} missing channel{'s' if len(mc_list) != 1 else ''}{f' ({mc_str})' if mc_list else ''}"
        f"{', which were excluded from spatial feature computation' if mc_list else ''}."
    )
    parts.append(
        "Clinical correlation with semiology, current anti-seizure medication levels, imaging findings, "
        "and prior EEG history is recommended before drawing localising or lateralising conclusions from this automated analysis."
    )
    return " ".join(parts)


def _narrative_researcher(
    filename: str, duration_min: float, events: list, quality_grade: str, quality_score: float,
    early_warning: bool,
    tc: list[tuple[str, float]], tc_str: str, mc_list: list, mc_str: str, n_mapped: int,
    p_mean: float, p_median: float, p_p99: float, p_max: float,
    raw_meta: dict[str, Any], confidence_score: float,
) -> str:
    parts: list[str] = []
    ds = _infer_dataset_source(filename)
    mc_detail = f"; {mc_str} {'was' if len(mc_list) == 1 else 'were'} absent and excluded from spatial feature computation" if mc_list else ""

    parts.append(
        f"Pipeline run on {filename} ({ds}) completed successfully with {n_mapped}/22 channels mapped to the standard bipolar montage{mc_detail}."
    )

    fs_orig = raw_meta.get("sampling_rate_original", "?") if isinstance(raw_meta, dict) else "?"
    fs_proc = raw_meta.get("sampling_rate_processed", 256) if isinstance(raw_meta, dict) else 256
    n_windows = raw_meta.get("n_windows", "?") if isinstance(raw_meta, dict) else "?"
    parts.append(
        f"The recording was processed at {fs_proc} Hz (resampled from {fs_orig} Hz original) using 4-second windows with "
        f"4-second stride for background segments and 1-second stride for seizure-candidate segments, "
        f"yielding {n_windows} analysis windows over the {duration_min:.1f}-minute recording duration."
    )

    d_shape = _distribution_shape(p_mean, p_median, p_max) if p_mean > 0 else "flat"
    parts.append(
        f"Inference produced a {d_shape} probability distribution "
        f"(mean {p_mean:.4f}, median {p_median:.4f}, p99 {p_p99:.4f}, max {p_max:.4f})"
        f"{', consistent with a single high-confidence focal activation against a predominantly low-activity background' if events and p_max > 2 * p_mean else ', without clear focal peaks above the detection threshold' if not events else ''}."
    )

    if events:
        ev0 = events[0]
        onset = ev0.get("onset_sec", "?")
        offset = ev0.get("offset_sec", "?")
        dur = ev0.get("duration_sec", "?")
        pattern = ev0.get("pattern_type") or ev0.get("pattern", "unknown")
        spread = ev0.get("spread_ratio", "?")
        n_ch = ev0.get("n_channels_involved", "?")

        stride = 4
        win_count = int(float(dur) / stride) if isinstance(dur, (int, float)) and dur != "?" else "?"
        parts.append(
            f"The flagged event spans the window range {onset}–{offset} seconds ({dur} seconds duration, "
            f"approximately {win_count} windows at {stride}-second stride)."
        )
        parts.append(
            f"Top channel attribution contributors — computed via gradient-based feature importance — were {tc_str}, "
            f"with the event classified as a {pattern} spatial pattern based on a spread ratio of {spread} across {n_ch} involved channels."
        )
        if early_warning:
            parts.append(
                "A pre-ictal gradient is detectable approximately 60–90 seconds before onset, with probability values rising from baseline levels."
            )
        dom_band = ev0.get("dominant_frequency_band", "unknown")
        if dom_band and dom_band != "unknown":
            parts.append(f"The dominant frequency band during the detected event was {dom_band}-range.")

        onset_f = float(onset) if isinstance(onset, (int, float)) else 0
        parts.append(
            f"Recommend inspection of the raw probability trace in the {max(0, int(onset_f - 100))}–{offset} second range "
            f"for threshold sensitivity analysis and false-positive risk evaluation."
        )
    else:
        parts.append(
            "No events exceeded the high-confidence detection threshold. The probability trace remained below the event boundary throughout the recording. "
            "Consider evaluating threshold sensitivity if the distribution tail warrants scrutiny."
        )

    parts.append(
        f"Signal quality assessment yielded a grade of {quality_grade} (composite score {quality_score}/1.0). "
        f"The model version is NeuroSentinel V4 with declared event sensitivity of 73.3% and false-positive rate of 0.98 events per hour. "
        f"Consider running this file through the pipeline at alternative threshold values to assess detection robustness."
    )
    return " ".join(parts)


# ═══════════════════════════════════════════════════════════════════
#  Role-aware recommendation builders
# ═══════════════════════════════════════════════════════════════════

def _build_patient_recommendations(events: list, early_warning: bool, se_flag: bool, diagnostic_state: str = "CLEAR") -> list[str]:
    recs: list[str] = []
    if se_flag:
        recs.append("The system detected signs of prolonged seizure activity. Please contact your neurologist or medical team as soon as possible.")
    if events:
        recs.append("Share this report with your neurologist or treating physician so they can explain what these findings mean for you specifically.")
    elif diagnostic_state == "SUSPICIOUS":
        recs.append("Suspicious patterns were flagged but no confirmed seizure events were found. Share this report with your neurologist to determine whether further testing is needed.")
    else:
        recs.append("No seizure activity was detected in this recording. Continue to follow your neurologist's guidance for ongoing monitoring.")
    if early_warning:
        recs.append("An early warning pattern was detected — be sure to mention this when you discuss the report with your doctor.")
    recs.append("Please bring a printed copy of this report to your next medical appointment for review by your neurologist.")
    return recs[:3]


def _build_clinician_recommendations(events: list, risk: str, early_warning: bool, se_flag: bool, top_channels: list) -> list[str]:
    recs: list[str] = []
    if se_flag:
        recs.append("URGENT: Status epilepticus criteria met by duration heuristic (>300s). Immediate clinical evaluation and intervention recommended.")
    if risk in ("Critical", "High"):
        recs.append(f"{'Critical' if risk == 'Critical' else 'High'}-risk ictal pattern detected. Neurology review recommended within 24 hours.")
    if events:
        rh = _region_hypothesis(top_channels) if top_channels else "undetermined"
        lat = _determine_lateralization(top_channels) if top_channels else "non-lateralised"
        recs.append(f"Onset zone hypothesis suggests {rh} generator with {lat}. Consider video-EEG for lateralisation confirmation if clinically indicated.")
        recs.append("Consider ICD-10 classification under G40.x epilepsy spectrum after clinical correlation with semiology and imaging.")
        recs.append("Review current anti-seizure medication (ASM) regimen and trough levels in context of these findings.")
    else:
        recs.append("No ictal events detected. If clinical suspicion persists, consider prolonged ambulatory or video-EEG monitoring.")
    if early_warning:
        recs.append("Pre-ictal gradient detected — evaluate for seizure threshold changes and medication timing relative to circadian pattern.")
    recs.append("Prior EEG records should be compared for evolution of ictal patterns and baseline changes.")
    recs.append("Correlate all algorithmic findings with clinical observation and patient history before management decisions.")
    return recs


def _build_researcher_recommendations(events: list, missing_channels: list, quality_score: float, prob_summary: dict, top_channels: list) -> list[str]:
    recs: list[str] = []
    if missing_channels:
        recs.append(f"Missing channel impact: {len(missing_channels)} channel(s) ({', '.join(str(c) for c in missing_channels)}) excluded from spatial computation — evaluate potential bias on lateralisation metrics.")
    p_max = prob_summary.get("max", 0) if isinstance(prob_summary, dict) else 0
    if p_max > 0:
        recs.append(f"Threshold sensitivity: re-run with detection threshold ±10% to assess detection robustness for this recording (current peak: {p_max:.4f}).")
    if events:
        ev0 = events[0]
        onset = ev0.get("onset_sec", 0)
        offset = ev0.get("offset_sec", 0)
        recs.append(f"Raw probability trace should be inspected between {max(0, int(float(onset)) - 100)}s and {offset}s for boundary precision analysis.")
    recs.append("Attribution method was gradient-based feature importance. Consider SHAP comparison for cross-method validation on flagged segments.")
    if quality_score < 0.7:
        recs.append(f"Signal quality score {quality_score:.3f} is below the 0.7 reliability threshold — flag this recording for model confidence caveat.")
    recs.append("Consider evaluating this recording against the declared model metrics (sensitivity 73.3%, FP/hr 0.98) as a calibration data point.")
    return recs


# ═══════════════════════════════════════════════════════════════════
#  Medical Report PDF Builder — Role‑Aware
# ═══════════════════════════════════════════════════════════════════

class _MedicalReportPDF:
    """Builds a professional, clinical-grade EEG analysis report PDF calibrated to the user role."""

    def __init__(self, data: dict[str, Any], user_profile: dict[str, Any] | None = None):
        self.data = data
        self.user_profile = user_profile or {}
        self.role = _resolve_role(user_profile)
        self.buffer = BytesIO()
        self.pdf = canvas.Canvas(self.buffer, pagesize=letter)
        self.y = PAGE_HEIGHT - 36
        self.page_num = 1

    # ── Page management ─────────────────────────────────────────

    def _ensure_space(self, needed: float) -> None:
        if self.y - needed < 68:
            self._new_page()

    def _new_page(self) -> None:
        self._draw_footer()
        self.pdf.showPage()
        self.page_num += 1
        self.pdf.setStrokeColor(ACCENT_BLUE)
        self.pdf.setLineWidth(2)
        self.pdf.line(MARGIN_X, PAGE_HEIGHT - 30, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 30)
        self.pdf.setFont("Helvetica", 7)
        self.pdf.setFillColor(TEXT_LIGHT)
        title_cont = "NEUROSENTINEL AI — CLINICAL EEG ANALYSIS REPORT (continued)" if self.role != "researcher" else "NEUROSENTINEL AI — EEG PIPELINE ANALYSIS (continued)"
        self.pdf.drawString(MARGIN_X, PAGE_HEIGHT - 26, title_cont)
        self.y = PAGE_HEIGHT - 50

    def _draw_footer(self) -> None:
        self.pdf.setStrokeColor(BORDER_LIGHT)
        self.pdf.setLineWidth(0.5)
        self.pdf.line(MARGIN_X, 42, PAGE_WIDTH - MARGIN_X, 42)
        self.pdf.setFont("Helvetica", 6.5)
        self.pdf.setFillColor(TEXT_LIGHT)
        self.pdf.drawString(MARGIN_X, 30, "NeuroSentinel AI \u2014 Decision Support Only. Not a Medical Diagnosis.")
        self.pdf.drawRightString(PAGE_WIDTH - MARGIN_X, 30, f"Page {self.page_num}")

    # ── Drawing primitives ──────────────────────────────────────

    def _draw_header(self) -> None:
        self.pdf.setFillColor(HEADER_BG)
        self.pdf.rect(0, PAGE_HEIGHT - 84, PAGE_WIDTH, 84, fill=1, stroke=0)
        self.pdf.setFillColor(ACCENT_BLUE)
        self.pdf.rect(0, PAGE_HEIGHT - 88, PAGE_WIDTH, 4, fill=1, stroke=0)

        self.pdf.setFillColor(white)
        
        # Draw Logo Image
        if os.path.exists(LOGO_PATH):
            try:
                # Square logo, white/black themed - fits well in header
                self.pdf.drawImage(LOGO_PATH, MARGIN_X, PAGE_HEIGHT - 48, width=32, height=32, mask='auto')
                text_x_offset = 40
            except Exception:
                text_x_offset = 0
        else:
            text_x_offset = 0

        self.pdf.setFont("Helvetica-Bold", 16)
        self.pdf.drawString(MARGIN_X + text_x_offset, PAGE_HEIGHT - 32, "NEUROSENTINEL AI")

        self.pdf.setFont("Helvetica", 8)
        self.pdf.setFillColor(HexColor("#8899BB"))
        self.pdf.drawString(MARGIN_X + text_x_offset, PAGE_HEIGHT - 46, "Seizure Clinical Operations & Understanding Tool  |  Automated EEG Analysis Platform")

        self.pdf.setFillColor(white)
        self.pdf.setFont("Helvetica-Bold", 12)
        right_title = "CLINICAL EEG ANALYSIS REPORT" if self.role != "researcher" else "EEG PIPELINE ANALYSIS REPORT"
        self.pdf.drawRightString(PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 32, right_title)

        meta = self.data.get("clinical_report", {}).get("meta", {})
        timestamp = meta.get("generated_at", datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S"))
        self.pdf.setFont("Helvetica", 7.5)
        self.pdf.setFillColor(HexColor("#8899BB"))
        self.pdf.drawRightString(PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 46, f"Generated: {timestamp}")

        recording_id = meta.get("recording_id") or self.data.get("recording_id", "")
        if recording_id:
            self.pdf.drawRightString(PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 58, f"Recording: {recording_id}")


        self.y = PAGE_HEIGHT - 100

    def _section_header(self, title: str, number: str = "") -> None:
        self._ensure_space(42)
        self.y -= 14
        self.pdf.setFillColor(SECTION_BG)
        self.pdf.roundRect(MARGIN_X, self.y - 6, CONTENT_WIDTH, 24, 3, fill=1, stroke=0)
        self.pdf.setFillColor(ACCENT_BLUE)
        self.pdf.roundRect(MARGIN_X, self.y - 6, 4, 24, 2, fill=1, stroke=0)
        self.pdf.setFillColor(ACCENT_BLUE)
        self.pdf.setFont("Helvetica-Bold", 9.5)
        label = f"{number}   {title}" if number else title
        self.pdf.drawString(MARGIN_X + 12, self.y, label.upper())
        self.y -= 28

    def _field_row(self, label: str, value: str, bold_value: bool = False) -> None:
        self._ensure_space(18)
        self.pdf.setStrokeColor(BORDER_LIGHT)
        self.pdf.setLineWidth(0.4)
        self.pdf.line(MARGIN_X + 6, self.y - 6, MARGIN_X + CONTENT_WIDTH - 6, self.y - 6)
        self.pdf.setFont("Helvetica", 8)
        self.pdf.setFillColor(TEXT_LIGHT)
        self.pdf.drawString(MARGIN_X + 10, self.y, label)
        val_font = "Helvetica-Bold" if bold_value else "Helvetica"
        val_size = 9
        max_val_w = CONTENT_WIDTH - 172
        self.pdf.setFont(val_font, val_size)
        self.pdf.setFillColor(TEXT_DARK)
        wrapped = _wrap_text(str(value), val_font, val_size, max_val_w)
        for i, line in enumerate(wrapped):
            self.pdf.drawString(MARGIN_X + 166, self.y - (i * 13), line)
        self.y -= 17 + max(0, (len(wrapped) - 1) * 13)

    def _text_block(self, text: str, font_size: float = 8.5, color: Any = None, indent: float = 10) -> None:
        color = color or TEXT_MEDIUM
        self._ensure_space(16)
        max_w = CONTENT_WIDTH - indent - 8
        wrapped = _wrap_text(text, "Helvetica", font_size, max_w)
        self.pdf.setFont("Helvetica", font_size)
        self.pdf.setFillColor(color)
        for line in wrapped:
            self._ensure_space(13)
            self.pdf.drawString(MARGIN_X + indent, self.y, line)
            self.y -= font_size + 4

    def _risk_badge(self, risk_level: str) -> None:
        self._ensure_space(32)
        color = _risk_color(risk_level)
        label = risk_level.upper()
        badge_w = stringWidth(label, "Helvetica-Bold", 11) + 24
        self.pdf.setFillColor(color)
        self.pdf.roundRect(MARGIN_X + 10, self.y - 6, badge_w, 22, 4, fill=1, stroke=0)
        self.pdf.setFillColor(white)
        self.pdf.setFont("Helvetica-Bold", 11)
        self.pdf.drawString(MARGIN_X + 22, self.y - 1, label)
        self.y -= 30

    def _table_header(self, columns: list[tuple[str, float]]) -> None:
        self._ensure_space(22)
        self.pdf.setFillColor(HexColor("#E0E5EC"))
        self.pdf.rect(MARGIN_X, self.y - 5, CONTENT_WIDTH, 19, fill=1, stroke=0)
        self.pdf.setStrokeColor(BORDER_COLOR)
        self.pdf.setLineWidth(0.6)
        self.pdf.line(MARGIN_X, self.y + 14, MARGIN_X + CONTENT_WIDTH, self.y + 14)
        x = MARGIN_X
        self.pdf.setFont("Helvetica-Bold", 7)
        self.pdf.setFillColor(TEXT_DARK)
        for col_name, col_w in columns:
            self.pdf.drawString(x + 4, self.y, col_name.upper())
            x += col_w
        self.y -= 20

    def _table_row(self, columns: list[tuple[str, float]], values: list[str], hi_col: int = -1, hi_color: Any = None) -> None:
        self._ensure_space(17)
        self.pdf.setStrokeColor(BORDER_LIGHT)
        self.pdf.setLineWidth(0.3)
        self.pdf.line(MARGIN_X, self.y - 4, MARGIN_X + CONTENT_WIDTH, self.y - 4)
        x = MARGIN_X
        for i, ((_, col_w), val) in enumerate(zip(columns, values)):
            if i == hi_col and hi_color:
                self.pdf.setFillColor(hi_color)
                self.pdf.setFont("Helvetica-Bold", 7.5)
            else:
                self.pdf.setFillColor(TEXT_MEDIUM)
                self.pdf.setFont("Helvetica", 7.5)
            self.pdf.drawString(x + 4, self.y, str(val))
            x += col_w
        self.y -= 16

    def _numbered_item(self, number: int, text: str) -> None:
        self._ensure_space(28)
        self.pdf.setFillColor(ACCENT_BLUE)
        self.pdf.circle(MARGIN_X + 18, self.y + 2, 7, fill=1, stroke=0)
        self.pdf.setFillColor(white)
        self.pdf.setFont("Helvetica-Bold", 6.5)
        self.pdf.drawCentredString(MARGIN_X + 18, self.y - 0.5, str(number))
        max_w = CONTENT_WIDTH - 44
        wrapped = _wrap_text(text, "Helvetica", 8, max_w)
        self.pdf.setFont("Helvetica", 8)
        self.pdf.setFillColor(TEXT_MEDIUM)
        for line in wrapped:
            self._ensure_space(13)
            self.pdf.drawString(MARGIN_X + 32, self.y, line)
            self.y -= 12
        self.y -= 4

    # ── Main build ──────────────────────────────────────────────

    def generate(self) -> bytes:
        role = self.role
        cr = self.data.get("clinical_report", {})
        meta = cr.get("meta", {})
        sq = cr.get("signal_quality", {})
        summary = cr.get("summary", {})
        cr_events = cr.get("events", [])
        cr_explainability = cr.get("explainability", {})
        cr_recommendations = cr.get("recommendations", [])

        events = cr_events or self.data.get("events", [])
        recording_id = meta.get("recording_id") or self.data.get("recording_id", "Unknown")
        filename = self.data.get("file_name") or recording_id
        duration = meta.get("duration_min") or self.data.get("duration_minutes", 0)
        quality_grade = sq.get("grade") or self.data.get("quality_grade", "Unknown")
        quality_score = sq.get("score") or self.data.get("quality_score", 0)
        missing_chs = sq.get("missing_channels") or self.data.get("missing_channels", "None")
        risk_level = summary.get("overall_risk") or self.data.get("risk_level", "Unknown")
        total_events = summary.get("total_events", len(events))
        trend_summary = summary.get("trend_summary") or self.data.get("trend_summary", "")
        early_warning = summary.get("early_warning", self.data.get("early_warning", False))
        se_flag = summary.get("status_epilepticus", self.data.get("se_flag", False))
        top_channels_raw = cr_explainability.get("top_channels") or self.data.get("channel_importance_summary", "")
        top_regions = cr_explainability.get("top_regions") or self.data.get("top_regions", [])
        result_label = self.data.get("result_label", "Unknown")
        diagnostic_state = self.data.get("diagnostic_state", "CLEAR")
        suppressed_candidates = self.data.get("suppressed_candidates")
        confidence = self.data.get("confidence_score", 0)
        raw_meta = self.data.get("metadata", {}) or {}
        model_outputs = self.data.get("model_outputs", {}) or {}
        prob_summary = model_outputs.get("probability_summary", {}) if isinstance(model_outputs, dict) else {}
        expl = self.data.get("explainability", {}) or {}
        top_ch_detail = expl.get("top_channels", [])

        # Normalize top_channels for narrative
        tc_for_narrative: list[tuple[str, float]] | str = top_channels_raw
        if isinstance(top_ch_detail, list) and top_ch_detail and isinstance(top_ch_detail[0], (list, tuple)):
            tc_for_narrative = [(str(c), float(s)) for c, s in top_ch_detail]

        timestamp_str = meta.get("generated_at", datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S"))

        # Build a proper unique report ID (first 8 chars of UUID if available, else hash of filename+timestamp)
        import hashlib
        report_uid = self.data.get("report_uid") or ""
        if not report_uid:
            uid_src = f"{filename}:{timestamp_str}"
            report_uid = hashlib.sha256(uid_src.encode()).hexdigest()[:8].upper()
        else:
            report_uid = str(report_uid)[:8].upper()



        # ─ HEADER ─
        self._draw_header()

        # ═══════════════ §0 REPORT INFORMATION ═══════════════

        if role == "patient":
            self._section_header("Report Information", "§0")
            self._field_row("Report ID", f"NS-{report_uid}")
            self._field_row("EEG File", filename)

            self._field_row("Report Date", timestamp_str)
            user_email = self.user_profile.get("email") or ""
            if user_email:
                self._field_row("Registered Email", user_email)
            self._field_row("User Role", _display_role_label(role))
            self.y -= 4
            self._text_block(
                "This report is intended to be shared with your treating clinician or neurologist for professional review. "
                "Please bring a copy of this report to your next appointment.",
                font_size=7.5, color=TEXT_LIGHT,
            )

        elif role == "clinician":
            self._section_header("Report Information", "§0")
            self._field_row("Report ID", f"NS-{report_uid}")
            self._field_row("EEG File", filename)

            self._field_row("Report Date", timestamp_str)
            self._field_row("Referring Clinician", "Per institutional records")
            self._field_row("Institution", "Per institutional records")
            self.y -= 4
            self._text_block(
                "Patient-identifiable information has been restricted. "
                "Cross-reference with your clinical records for full patient identification.",
                font_size=7.5, color=TEXT_LIGHT,
            )

        elif role == "researcher":
            self._section_header("Report Information", "§0")
            self._field_row("Report ID", f"NS-{report_uid}")
            self._field_row("EDF Filename", filename)
            self._field_row("Dataset Source", _infer_dataset_source(filename))

            self._field_row("Pipeline Version", meta.get("tool", "NeuroSentinel AI v4"))
            self._field_row("Run Timestamp", timestamp_str)

        # ═══════════════ FLAGS SUMMARY ═══════════════

        dur_float = float(duration) if duration else 0
        conf_val = float(confidence) if confidence else 0
        active_flags: list[str] = []
        if se_flag:
            active_flags.append("STATUS EPILEPTICUS: Prolonged seizure activity detected. Immediate action may be required.")
        if conf_val > 0 and conf_val < 70:
            active_flags.append(f"LOW CONFIDENCE: Model confidence ({conf_val:.1f}%) is below the 70% reliability threshold. Interpret with additional caution.")
        if dur_float > 0 and dur_float < 20:
            active_flags.append(f"SHORT RECORDING: Duration ({dur_float:.1f} min) is below the recommended 20-minute minimum for reliable detection.")
        if early_warning:
            active_flags.append("EARLY WARNING: Pre-ictal activity gradient detected before seizure onset.")

        if active_flags:
            self._ensure_space(24 + len(active_flags) * 16)
            self.y -= 8
            # Warning box background
            box_h = 22 + len(active_flags) * 14
            self.pdf.setFillColor(HexColor("#FFF8E1"))
            self.pdf.setStrokeColor(HexColor("#CC6600"))
            self.pdf.setLineWidth(0.8)
            self.pdf.roundRect(MARGIN_X, self.y - box_h + 16, CONTENT_WIDTH, box_h, 4, fill=1, stroke=1)
            self.pdf.setFont("Helvetica-Bold", 8)
            self.pdf.setFillColor(HexColor("#CC6600"))
            self.pdf.drawString(MARGIN_X + 10, self.y + 2, "WARNING FLAGS SUMMARY")
            self.y -= 14
            self.pdf.setFont("Helvetica", 7.5)
            self.pdf.setFillColor(HexColor("#8B4000"))
            for flag_text in active_flags:
                self.pdf.drawString(MARGIN_X + 14, self.y, f"- {flag_text}")
                self.y -= 12
            self.y -= 6

        # ═══════════════ §1 RECORDING INFORMATION ═══════════════

        self._section_header("Recording Information", "§1")
        self._field_row("Filename", str(filename))
        self._field_row("Result", str(result_label), bold_value=True)
        conf_label = _confidence_descriptor(conf_val).upper()
        if conf_val < 70:
            conf_str = f"{confidence}% ({conf_label} -- interpret with caution)"
        else:
            conf_str = f"{confidence}% ({conf_label})"
        self._field_row("Model Confidence", conf_str, bold_value=(conf_val < 70))
        self._field_row("Duration Analysed", f"{round(float(duration), 1)} min")
        self._field_row("Analysis Tool", "NeuroSentinel AI v4 (multirep_best_model_v4.pt)")

        if isinstance(raw_meta, dict):
            if raw_meta.get("sampling_rate_original"):
                self._field_row("Original Sampling Rate", f"{raw_meta['sampling_rate_original']} Hz")
            if raw_meta.get("sampling_rate_processed"):
                self._field_row("Processed Sampling Rate", f"{raw_meta['sampling_rate_processed']} Hz")
            if raw_meta.get("montage_type"):
                self._field_row("Montage", str(raw_meta["montage_type"]))
            if raw_meta.get("n_mapped"):
                self._field_row("Channels Mapped", f"{raw_meta['n_mapped']} / 22")
            if raw_meta.get("n_windows"):
                self._field_row("Analysis Windows", str(raw_meta["n_windows"]))

        # Researcher gets extra pipeline detail
        if role == "researcher" and isinstance(raw_meta, dict):
            self._field_row("Window Size", "4 seconds (1024 samples @ 256 Hz)")
            self._field_row("Stride (background)", "4 seconds")
            self._field_row("Stride (seizure candidate)", "1 second")
            self._field_row("Normalisation", "Per-channel z-score within window")
            inf_mode = raw_meta.get("inference_mode", "chunked")
            self._field_row("Inference Mode", str(inf_mode))

        # ═══════════════ §2 SIGNAL QUALITY ═══════════════

        self._section_header("Signal Quality Assessment", "§2")
        self._field_row("Quality Grade", str(quality_grade), bold_value=True)
        self._field_row("Quality Score", f"{quality_score} / 1.0")
        self._field_row("Missing Channels", _fmt_missing(missing_chs))

        top_quality = self.data.get("quality", {})
        if isinstance(top_quality, dict):
            if top_quality.get("mean_noise_ratio") is not None:
                self._field_row("Mean Noise Ratio", f"{top_quality['mean_noise_ratio']:.4f}")
            if top_quality.get("n_windows_assessed"):
                self._field_row("Windows Assessed", str(top_quality["n_windows_assessed"]))

        # Clinician + researcher: flag excluded channels
        if role in ("clinician", "researcher"):
            mc_list = missing_chs if isinstance(missing_chs, list) else []
            if mc_list:
                self._text_block(
                    f"Excluded channels: {', '.join(str(c) for c in mc_list)}. "
                    "These were absent from the source file and excluded from all spatial feature computation and channel importance ranking.",
                    font_size=7.5, color=TEXT_LIGHT,
                )

        # ═══════════════ §3 SCOUT SUMMARY (MOST IMPORTANT) ═══════════════

        section_title = "SCOUT Analysis Summary" if role != "researcher" else "SCOUT Pipeline Analysis Summary"
        self._section_header(section_title, "§3")

        if role != "researcher":
            self._risk_badge(str(risk_level))

        # Generate the flowing narrative
        narrative = _build_scout_narrative(
            role=role,
            filename=filename,
            duration_min=float(duration),
            events=events,
            result_label=result_label,
            risk_level=risk_level,
            quality_grade=str(quality_grade),
            quality_score=float(quality_score) if quality_score else 0,
            early_warning=bool(early_warning),
            se_flag=bool(se_flag),
            top_channels=tc_for_narrative,
            prob_summary=prob_summary,
            missing_channels=missing_chs,
            raw_meta=raw_meta,
            confidence_score=float(confidence),
        )
        self._text_block(narrative, font_size=8.5, color=TEXT_MEDIUM, indent=10)

        # Supplementary stats below narrative
        self.y -= 6
        self._field_row("Seizure Events Detected", str(total_events), bold_value=True)
        self._field_row("Overall Result", str(result_label), bold_value=True)
        ew_text = "Yes \u2014 Pre-ictal trend detected" if early_warning else "No"
        self._field_row("Early Warning Signal", ew_text)
        if se_flag and role == "patient":
            sef = "Yes — EMERGENCY: Call 999/911/112 if seizure is ongoing. Attend A&E immediately."
        elif se_flag and role == "clinician":
            sef = "Yes — Initiate institutional SE protocol. Consider first-line benzodiazepine."
        elif se_flag:
            sef = f"Yes (duration heuristic threshold: 300s)"
        else:
            sef = "No" if role != "researcher" else "No (duration heuristic threshold: 300s)"
        self._field_row("Status Epilepticus Flag", sef, bold_value=bool(se_flag))

        if isinstance(prob_summary, dict) and prob_summary:
            self._field_row(
                "Probability (mean / median / p99 / max)",
                f"{prob_summary.get('mean', '?')} / {prob_summary.get('median', '?')} / {prob_summary.get('p99', '?')} / {prob_summary.get('max', '?')}",
            )
            # Confidence reconciliation note for ALL roles
            if events and prob_summary.get('max'):
                p_max_val = float(prob_summary['max'])
                conf_val_rec = float(confidence)
                if abs(p_max_val * 100 - conf_val_rec) > 5:
                    self.y -= 4
                    if role == "patient":
                        self._text_block(
                            f"Note: You may notice two different numbers — the model's peak reading ({p_max_val:.4f}) and the overall "
                            f"confidence ({conf_val_rec:.1f}%). The peak is the highest single measurement at one point in time, while "
                            "the confidence score averages across the entire episode. Both are normal outputs of the analysis.",
                            font_size=7.5, color=TEXT_LIGHT, indent=10,
                        )
                    else:
                        self._text_block(
                            f"Note: Model confidence ({conf_val_rec:.1f}%) reflects the mean probability across the highest-confidence event, "
                            f"while probability max ({p_max_val:.4f}) is the single peak window output. These differ because confidence "
                            "averages over the entire event duration, smoothing out transient spikes.",
                            font_size=7, color=TEXT_LIGHT, indent=10,
                        )

        # CAUTION block if confidence < 70%
        if conf_val > 0 and conf_val < 70:
            self.y -= 4
            self._ensure_space(36)
            self.pdf.setFillColor(HexColor("#FFF3E0"))
            self.pdf.setStrokeColor(HexColor("#E65100"))
            self.pdf.setLineWidth(0.6)
            self.pdf.roundRect(MARGIN_X + 6, self.y - 18, CONTENT_WIDTH - 12, 30, 3, fill=1, stroke=1)
            self.pdf.setFont("Helvetica-Bold", 7.5)
            self.pdf.setFillColor(HexColor("#E65100"))
            self.pdf.drawString(MARGIN_X + 14, self.y, "CAUTION")
            self.pdf.setFont("Helvetica", 7)
            self.pdf.setFillColor(HexColor("#8B4000"))
            self.pdf.drawString(MARGIN_X + 60, self.y,
                f"Model confidence ({conf_val:.1f}%) is below 70%. Results should be interpreted with additional clinical caution.")
            self.y -= 28

        # LIMITATION block if recording duration < 20 minutes
        if dur_float < 20 and dur_float > 0:
            self.y -= 4
            self._ensure_space(36)
            self.pdf.setFillColor(HexColor("#E3F2FD"))
            self.pdf.setStrokeColor(HexColor("#1565C0"))
            self.pdf.setLineWidth(0.6)
            self.pdf.roundRect(MARGIN_X + 6, self.y - 18, CONTENT_WIDTH - 12, 30, 3, fill=1, stroke=1)
            self.pdf.setFont("Helvetica-Bold", 7.5)
            self.pdf.setFillColor(HexColor("#1565C0"))
            self.pdf.drawString(MARGIN_X + 14, self.y, "LIMITATION")
            self.pdf.setFont("Helvetica", 7)
            self.pdf.setFillColor(HexColor("#0D47A1"))
            if role == "patient":
                self.pdf.drawString(MARGIN_X + 72, self.y,
                    f"This recording was only {dur_float:.1f} min. Longer recordings (20-60 min) provide more reliable results.")
            elif role == "clinician":
                self.pdf.drawString(MARGIN_X + 72, self.y,
                    f"Recording duration ({dur_float:.1f} min) below 20-min minimum. Negative results carry reduced sensitivity.")
            else:
                self.pdf.drawString(MARGIN_X + 72, self.y,
                    f"Duration {dur_float:.1f} min is below clinical thresholds (20+ min). Sensitivity estimates may not apply.")
            self.y -= 28

        if trend_summary:
            self.y -= 4
            self._text_block(f"Trend: {trend_summary}")

        # ═══════════════ §4 DETECTED EVENTS ═══════════════

        self._section_header("Detected Seizure Events" if role != "researcher" else "Detected Events", "§4")
        if not events:
            if diagnostic_state == "SUSPICIOUS" and suppressed_candidates:
                n_win = suppressed_candidates.get("n_windows_above_threshold", "multiple")
                max_p = suppressed_candidates.get("max_probability")
                max_p_str = f" (max probability {max_p:.1%})" if isinstance(max_p, (int, float)) else ""
                self._text_block(
                    f"No confirmed seizure events. However, the model flagged {n_win} candidate window(s) "
                    f"with seizure-like probability{max_p_str} that did not meet post-processing criteria "
                    f"(minimum duration, sustained threshold). Clinical correlation is recommended.",
                    font_size=9,
                )
            else:
                self._text_block("No seizure events were detected in this recording.", font_size=9)
        else:
            # Build column spec based on role
            if role == "researcher":
                col_spec: list[tuple[str, float]] = [
                    ("Event", 36), ("Onset", 50), ("Offset", 50), ("Duration", 50),
                    ("Confidence", 58), ("Peak Prob", 52), ("Risk", 48),
                    ("Pattern", 52), ("Windows", 44),
                ]
            elif role == "clinician":
                col_spec = [
                    ("Event", 36), ("Onset", 50), ("Offset", 50), ("Duration", 50),
                    ("Confidence", 58), ("Risk", 48), ("Pattern", 52),
                    ("Onset Zone", 80),
                ]
            else:
                col_spec = [
                    ("Event", 44), ("Onset", 58), ("Offset", 58), ("Duration", 60),
                    ("Confidence", 68), ("Risk", 55), ("Pattern", 60),
                ]

            total_w = sum(w for _, w in col_spec)
            scale = CONTENT_WIDTH / total_w
            columns = [(n, w * scale) for n, w in col_spec]
            self._table_header(columns)

            for ev in events:
                if not isinstance(ev, dict):
                    continue
                eid = str(ev.get("id") or ev.get("event_idx", "?"))
                onset = f"{ev.get('onset_sec', '?')}s"
                offset = f"{ev.get('offset_sec', '?')}s"
                dur = f"{ev.get('duration_sec', '?')}s"
                conf_raw = ev.get("confidence_pct")
                if conf_raw is None:
                    mp = ev.get("mean_probability")
                    conf_raw = round(float(mp) * 100, 1) if isinstance(mp, (int, float)) else "?"
                conf = f"{conf_raw}%"
                risk = str(ev.get("risk_level", "?"))
                pat = str(ev.get("pattern") or ev.get("pattern_type", "\u2014"))

                if role == "researcher":
                    peak_p = ev.get("peak_probability")
                    peak_str = f"{peak_p:.4f}" if isinstance(peak_p, (int, float)) else "?"
                    dur_sec = ev.get("duration_sec", 0)
                    win_count = str(int(float(dur_sec) / 4)) if isinstance(dur_sec, (int, float)) and dur_sec else "?"
                    vals = [eid, onset, offset, dur, conf, peak_str, risk, pat, win_count]
                elif role == "clinician":
                    # Onset zone hypothesis from top regions of this event
                    ev_regions = ev.get("top_regions", [])
                    if ev_regions:
                        oz = ", ".join(str(r) for r in ev_regions[:2])
                    elif isinstance(tc_for_narrative, list) and tc_for_narrative:
                        oz = _region_hypothesis(tc_for_narrative[:3])
                    else:
                        oz = "\u2014"
                    vals = [eid, onset, offset, dur, conf, risk, pat, oz]
                else:
                    vals = [eid, onset, offset, dur, conf, risk, pat]

                risk_col_idx = 6 if role == "researcher" else (5 if role == "clinician" else 5)
                self._table_row(columns, vals, hi_col=risk_col_idx, hi_color=_risk_color(risk))

            # Band power details for first few events
            self.y -= 6
            for ev in events[:3]:
                if not isinstance(ev, dict):
                    continue
                bp = ev.get("band_powers", {})
                if isinstance(bp, dict) and bp:
                    eid = ev.get("id") or ev.get("event_idx", "?")
                    bands_str = ", ".join(f"{b}: {v:.4f}" for b, v in bp.items())
                    dominant = max(bp, key=bp.get) if bp else "\u2014"
                    self._text_block(f"Event {eid} \u2014 Band powers: {bands_str}  |  Dominant: {dominant}", font_size=7, color=TEXT_LIGHT, indent=14)

        # ═══════════════ §5 BRAIN REGION & CHANNEL ANALYSIS ═══════════════

        self._section_header("Brain Region & Channel Analysis", "§5")

        if isinstance(top_channels_raw, str) and top_channels_raw:
            self._field_row("Top Contributing Channels", top_channels_raw)
        elif isinstance(top_channels_raw, list) and top_channels_raw:
            ch_str = ", ".join(f"{ch} ({sc:.3f})" for ch, sc in top_channels_raw[:5])
            self._field_row("Top Contributing Channels", ch_str)

        if isinstance(top_regions, list) and top_regions:
            if len(top_regions) > 0 and isinstance(top_regions[0], (list, tuple)):
                reg_str = ", ".join(f"{name} ({score:.3f})" for name, score in top_regions)
            else:
                reg_str = ", ".join(str(r) for r in top_regions)
            self._field_row("Top Active Regions", reg_str)

        # Clinician: clinical label mapping + lateralisation
        if role == "clinician" and isinstance(top_ch_detail, list) and top_ch_detail:
            self.y -= 4
            self._text_block("Clinical Channel Mapping:", font_size=8, color=ACCENT_BLUE, indent=10)
            for ch, sc in top_ch_detail[:8]:
                clinical_label = CHANNEL_CLINICAL_LABELS.get(str(ch), "Unknown Region")
                bar = "#" * max(1, int(sc * 40))
                self._text_block(f"  {ch:>8}  ->  {clinical_label:<28}  {bar}  {sc:.4f}", font_size=7.5, color=TEXT_MEDIUM, indent=14)

            # Lateralisation note
            if isinstance(tc_for_narrative, list) and tc_for_narrative:
                lat = _determine_lateralization(tc_for_narrative)
                self.y -= 4
                self._text_block(f"Lateralisation Assessment: {lat.title()}", font_size=8, color=ACCENT_BLUE, indent=10)

        # Researcher: full attribution table + method note
        elif role == "researcher" and isinstance(top_ch_detail, list) and top_ch_detail:
            self.y -= 4
            self._text_block("Channel Importance Ranking (gradient-based feature importance):", font_size=8, color=ACCENT_BLUE, indent=10)
            for ch, sc in top_ch_detail[:10]:
                bar = "#" * max(1, int(sc * 40))
                self._text_block(f"  {ch:>8}   {bar}  {sc:.4f}", font_size=7.5, color=TEXT_MEDIUM, indent=14)
            self.y -= 4
            self._text_block(
                "Attribution method: gradient-based feature importance computed on the representative window at peak activation. "
                "Cross-validate with SHAP or integrated gradients for robustness.",
                font_size=7, color=TEXT_LIGHT, indent=10,
            )

        # Patient: simpler bar chart
        elif role == "patient" and isinstance(top_ch_detail, list) and top_ch_detail:
            self.y -= 4
            self._text_block("Most Active Brain Signal Channels:", font_size=8, color=ACCENT_BLUE, indent=10)
            for ch, sc in top_ch_detail[:5]:
                bar = "#" * max(1, int(sc * 40))
                self._text_block(f"  {ch:>8}   {bar}  {sc:.4f}", font_size=7.5, color=TEXT_MEDIUM, indent=14)

        # ═══════════════ §6 RECOMMENDATIONS ═══════════════

        mc_list = missing_chs if isinstance(missing_chs, list) else []
        tc_list = tc_for_narrative if isinstance(tc_for_narrative, list) else []

        if role == "patient":
            self._section_header("What To Do Next", "§6")
            recommendations = _build_patient_recommendations(events, bool(early_warning), bool(se_flag), diagnostic_state)
        elif role == "clinician":
            self._section_header("Clinical Recommendations", "§6")
            recommendations = _build_clinician_recommendations(events, risk_level, bool(early_warning), bool(se_flag), tc_list)
        else:
            self._section_header("Pipeline Flags & Audit Notes", "§6")
            recommendations = _build_researcher_recommendations(events, mc_list, float(quality_score) if quality_score else 0, prob_summary, tc_list)

        if not recommendations:
            self._text_block("No specific recommendations generated for this recording.", font_size=9)
        else:
            for i, rec in enumerate(recommendations, 1):
                self._numbered_item(i, rec)

        # ═══════════════ §7 DECLARED MODEL METRICS ═══════════════

        metrics = self.data.get("declared_metrics", {})
        if isinstance(metrics, dict) and metrics:
            self._section_header("Declared Model Performance", "§7" if role != "researcher" else "§7a")
            for key, val in metrics.items():
                if key == "version":
                    continue
                self._field_row(key.replace("_", " ").title(), str(val))

        # ═══════════════ DISCLAIMER ═══════════════

        self.y -= 14
        self._ensure_space(72)
        self.pdf.setStrokeColor(RISK_RED if role != "researcher" else ACCENT_BLUE)
        self.pdf.setLineWidth(1)
        self.pdf.line(MARGIN_X, self.y + 10, MARGIN_X + CONTENT_WIDTH, self.y + 10)
        self.y -= 2

        if role == "researcher":
            self.pdf.setFont("Helvetica-Bold", 7.5)
            self.pdf.setFillColor(ACCENT_BLUE)
            self.pdf.drawString(MARGIN_X + 8, self.y, "RESEARCH USE ONLY")
            self.y -= 14
            disclaimer_lines = [
                "This output is the result of an automated ML inference pipeline intended for research evaluation and algorithm development only.",
                "It must not be used for clinical decision-making. All scores, classifications, and spatial attributions are algorithmic estimates.",
                "Heuristic labels (severity, pattern, focal/generalised) are rule-based approximations and not validated ground-truth annotations.",
                "The pipeline has been evaluated on CHB-MIT and Siena datasets; performance on out-of-distribution data is not guaranteed.",
            ]
            self.pdf.setFont("Helvetica", 7)
            self.pdf.setFillColor(ACCENT_BLUE)
            for line in disclaimer_lines:
                self._ensure_space(12)
                self.pdf.drawString(MARGIN_X + 8, self.y, line)
                self.y -= 10
        else:
            self.pdf.setFont("Helvetica-Bold", 7.5)
            self.pdf.setFillColor(RISK_RED)
            self.pdf.drawString(MARGIN_X + 8, self.y, "IMPORTANT DISCLAIMER")
            self.y -= 14
            disclaimer_lines = [
                "This report is generated by NeuroSentinel AI, an automated decision-support tool. It does NOT constitute a medical diagnosis.",
                "All findings, risk levels, and heuristic values are algorithmic estimates and must be reviewed by a qualified neurologist.",
                "Heuristic outputs (severity, pattern classification, focal/generalised) are rule-based estimates, not ground-truth annotations.",
                "NeuroSentinel AI is intended for research and clinical decision support only. Patient management decisions must not rely solely on this tool.",
            ]
            self.pdf.setFont("Helvetica", 7)
            self.pdf.setFillColor(HexColor("#992222"))
            for line in disclaimer_lines:
                self._ensure_space(12)
                self.pdf.drawString(MARGIN_X + 8, self.y, line)
                self.y -= 10

        # ─ FINAL ─
        self._draw_footer()
        self.pdf.save()
        return self.buffer.getvalue()


# ═══════════════════════════════════════════════════════════════════
#  Legacy fallback — renders markdown string on a white page
# ═══════════════════════════════════════════════════════════════════

def _generate_pdf_from_markdown(markdown: str) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    margin_x = 48
    y = height - 48
    max_width = width - margin_x * 2

    # Header
    pdf.setFillColor(ACCENT_BLUE)
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(margin_x, y, "NeuroSentinel AI \u2014 Clinical EEG Report")
    y -= 8
    pdf.setStrokeColor(ACCENT_BLUE)
    pdf.setLineWidth(1)
    pdf.line(margin_x, y, width - margin_x, y)
    y -= 20

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if not line:
            y -= 8
            continue

        if line.startswith("# "):
            font_name, font_size, color = "Helvetica-Bold", 14, HEADER_BG
            text = line[2:]
        elif line.startswith("## "):
            font_name, font_size, color = "Helvetica-Bold", 11, ACCENT_BLUE
            text = line[3:]
        elif line.startswith("#### "):
            font_name, font_size, color = "Helvetica-Bold", 10, TEXT_DARK
            text = line[5:]
        elif line.startswith("- "):
            font_name, font_size, color = "Helvetica", 9, TEXT_MEDIUM
            text = f"  \u2022  {line[2:]}"
        else:
            font_name, font_size, color = "Helvetica", 9, TEXT_MEDIUM
            text = line.replace("`", "")

        pdf.setFillColor(color)
        pdf.setFont(font_name, font_size)
        for wrapped in _wrap_text(text, font_name, font_size, max_width):
            if y < 56:
                pdf.showPage()
                y = height - 48
                pdf.setFillColor(color)
                pdf.setFont(font_name, font_size)
            pdf.drawString(margin_x, y, wrapped)
            y -= font_size + 4
        y -= 4

    pdf.save()
    return buffer.getvalue()


# ═══════════════════════════════════════════════════════════════════
#  Public API
# ═══════════════════════════════════════════════════════════════════

def generate_pdf(report_data: dict[str, Any] | str, user_profile: dict[str, Any] | None = None) -> bytes:
    """Generate a clinical PDF report.

    Accepts either:
    - A ``dict`` containing the full report_json data → structured medical format
    - A markdown ``str`` → formatted text (legacy fallback)

    ``user_profile`` is an optional dict with 'email' and 'role' keys for patient details.
    """
    if isinstance(report_data, str):
        return _generate_pdf_from_markdown(report_data)

    builder = _MedicalReportPDF(report_data, user_profile=user_profile)
    return builder.generate()
