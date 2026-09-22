from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

from app.config import Settings
from app.pipeline.config import SCOUT_FULL_NAME
from app.services.scout.product_guide import select_product_snippets
from app.services.scout.providers import (
    GeminiScoutProvider,
    GroqScoutProvider,
    HuggingFaceScoutProvider,
    ProviderUnavailableError,
    ScoutProvider,
)
from app.services.supabase import SupabaseService

logger = logging.getLogger(__name__)

AUTO_SUMMARY_PREFIX = "__SCOUT_AUTO_SUMMARY__"
TRUNCATION_MARKERS = (
    "too lengthy",
    "too long",
    "continue if you want",
    "continue and i can",
    "i couldn't send",
    "i could not send",
    "rest of the response",
    "token limit",
    "length limit",
)


@dataclass
class ScoutContext:
    user_id: str
    message: str
    page: str
    role: str | None
    report_id: str | None
    current_report: dict[str, Any] | None
    page_data: dict[str, Any] | None = None
    session_history: list[dict[str, str]] | None = None


def _normalize_role(role: str | None) -> str:
    if role in {"clinician", "researcher", "patient"}:
        return role
    return "clinician"


def _safe_report_summary(report: dict[str, Any] | None) -> str:
    if not report:
        return "No current report is open."
    summary = report.get("summary") or "No summary is available."
    result_label = report.get("result_label") or "unknown"
    risk_level = report.get("risk_level") or "unknown"
    confidence = report.get("confidence_score")
    confidence_text = f"{confidence:.1f}%" if isinstance(confidence, (int, float)) else "unknown"
    diagnostic_state = (report.get("report_json") or {}).get("diagnostic_state") or "unknown"
    return (
        f"Current report: {result_label} (diagnostic state: {diagnostic_state}), "
        f"risk {risk_level}, confidence {confidence_text}. Summary: {summary}"
    )


def _format_pct(value: Any) -> str:
    if isinstance(value, (int, float)):
        return f"{value:.1f}%"
    return "unknown"


def _format_minutes(value: Any) -> str:
    if isinstance(value, (int, float)):
        return f"{value:.1f} min"
    return "unknown"


def _normalize_confidence_value(value: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    return value / 100 if value > 1 else float(value)


def _compute_reliability(quality_grade: Any, duration_minutes: Any, confidence_score: Any) -> tuple[str, list[str]]:
    reasons: list[str] = []
    duration_value = float(duration_minutes) if isinstance(duration_minutes, (int, float)) else None
    quality_value = str(quality_grade).lower() if quality_grade else "unknown"
    normalized_conf = _normalize_confidence_value(confidence_score)

    # Confidence checked FIRST — very low confidence always = Low
    if normalized_conf is not None and normalized_conf < 0.30:
        reasons.append(f"model confidence is very low at {normalized_conf * 100:.1f}%")
        return ("Low", reasons)

    if quality_value in {"poor", "unreliable"}:
        reasons.append(f"signal quality is {quality_grade}")
    if duration_value is not None and duration_value > 0 and duration_value < 10:
        reasons.append(f"recording duration is very short at {duration_value:.1f} minutes")
    elif duration_value is not None and duration_value > 0 and duration_value < 20:
        reasons.append(f"recording duration is short at {duration_value:.1f} minutes")
    if normalized_conf is not None and normalized_conf < 0.8:
        reasons.append(f"model confidence is below target at {normalized_conf * 100:.1f}%")

    if reasons:
        # Low if quality is poor or very short duration
        if quality_value in {"poor", "unreliable"} or (duration_value is not None and duration_value < 10):
            return ("Low", reasons)
        return ("Moderate", reasons)

    if normalized_conf is not None and normalized_conf < 0.9:
        return ("Moderate", [f"model confidence is acceptable but not ideal at {normalized_conf * 100:.1f}%"])

    return ("High", ["recording duration, signal quality, and confidence are all in a reliable range"])


def _format_event_brief(event: dict[str, Any]) -> str:
    onset = event.get("onset_sec") or event.get("start_sec") or "?"
    duration = event.get("duration_sec") or "?"
    risk = event.get("risk_level") or "unknown"
    confidence = event.get("confidence_pct")
    if confidence is None:
        probability = event.get("mean_probability")
        confidence = round(float(probability) * 100, 1) if isinstance(probability, (int, float)) else "unknown"
    pattern = event.get("pattern") or event.get("pattern_type") or "unknown"
    return f"onset {onset}s, duration {duration}s, confidence {confidence}%, risk {risk}, pattern {pattern}"


def _collect_report_details(report: dict[str, Any]) -> dict[str, Any]:
    report_json = report.get("report_json") or {}
    report_json = report_json if isinstance(report_json, dict) else {}
    clinical_report = report_json.get("clinical_report") if isinstance(report_json.get("clinical_report"), dict) else {}
    summary = clinical_report.get("summary") if isinstance(clinical_report.get("summary"), dict) else {}
    quality = report_json.get("quality") if isinstance(report_json.get("quality"), dict) else {}
    signal_quality = clinical_report.get("signal_quality") if isinstance(clinical_report.get("signal_quality"), dict) else {}
    explainability = report_json.get("explainability") if isinstance(report_json.get("explainability"), dict) else {}
    model_outputs = report_json.get("model_outputs") if isinstance(report_json.get("model_outputs"), dict) else {}
    events = clinical_report.get("events") if isinstance(clinical_report.get("events"), list) else report_json.get("events", [])
    recommendations = clinical_report.get("recommendations") if isinstance(clinical_report.get("recommendations"), list) else []
    probability_summary = model_outputs.get("probability_summary") if isinstance(model_outputs.get("probability_summary"), dict) else {}
    top_channels = explainability.get("top_channels") if isinstance(explainability.get("top_channels"), list) else []
    top_regions = explainability.get("top_regions") if isinstance(explainability.get("top_regions"), list) else report_json.get("top_regions", [])
    confidence_value = report.get("confidence_score")
    duration_value = report.get("duration_minutes") or report_json.get("duration_minutes")
    quality_grade = report.get("quality_grade") or report_json.get("quality_grade") or signal_quality.get("grade") or quality.get("dominant_grade") or quality.get("grade") or "unknown"
    explicit_reliability = report.get("reliability")
    explicit_reliability_reasons = report.get("reliability_reasons")
    reliability_level, reliability_reasons = _compute_reliability(quality_grade, duration_value, confidence_value)
    if isinstance(explicit_reliability, str) and explicit_reliability.strip():
        reliability_level = explicit_reliability.strip().title()
    if isinstance(explicit_reliability_reasons, list) and explicit_reliability_reasons:
        reliability_reasons = [str(reason) for reason in explicit_reliability_reasons if str(reason).strip()]
    report_keywords = report.get("report_keywords") if isinstance(report.get("report_keywords"), list) else []
    diagnostic_state = report_json.get("diagnostic_state") or "unknown"
    suppressed = report_json.get("suppressed_candidates") if isinstance(report_json.get("suppressed_candidates"), dict) else None
    pattern_alert_level = (suppressed or {}).get("pattern_alert_level") or "unknown"

    return {
        "filename": report.get("filename") or report_json.get("file_name") or "this report",
        "result_label": report.get("result_label") or report_json.get("result_label") or "unknown",
        "diagnostic_state": diagnostic_state,
        "suppressed_candidates": suppressed,
        "pattern_alert_level": pattern_alert_level,
        "risk_level": report.get("risk_level") or report_json.get("risk_level") or summary.get("overall_risk") or "unknown",
        "confidence_text": _format_pct(confidence_value),
        "duration_text": _format_minutes(duration_value),
        "quality_grade": quality_grade,
        "quality_score": quality.get("mean_quality_score") or signal_quality.get("score") or report_json.get("quality_score") or "unknown",
        "event_count": report.get("event_count") or len(events) or report_json.get("event_count") or 0,
        "events": events if isinstance(events, list) else [],
        "trend": report_json.get("trend_summary") or summary.get("trend_summary") or report.get("summary") or "No trend summary available.",
        "early_warning": bool(report_json.get("early_warning") or summary.get("early_warning")),
        "se_flag": bool(report_json.get("se_flag") or summary.get("status_epilepticus")),
        "probability_summary": probability_summary,
        "events_per_hour": model_outputs.get("events_per_hour"),
        "domain_shift": model_outputs.get("shift_label") or report_json.get("domain_shift_label") or report_json.get("shift_label") or "not reported",
        "top_channels": top_channels if isinstance(top_channels, list) else [],
        "top_regions": top_regions if isinstance(top_regions, list) else [],
        "channel_summary": report_json.get("channel_importance_summary") or "not reported",
        "recommendations": recommendations if isinstance(recommendations, list) else [],
        "reliability_level": reliability_level,
        "reliability_reasons": reliability_reasons,
        "report_keywords": [str(keyword) for keyword in report_keywords if str(keyword).strip()],
    }


def _format_reliability_block(details: dict[str, Any]) -> str:
    reasons = details.get("reliability_reasons") or []
    if reasons:
        return f"{details['reliability_level']} reliability because " + "; ".join(reasons) + "."
    return f"{details['reliability_level']} reliability."


def _summarize_user_preferences(user_profile: dict[str, Any] | None) -> list[str]:
    if not isinstance(user_profile, dict):
        return ["User profile preferences are not available."]

    preferences = user_profile.get("preferences") if isinstance(user_profile.get("preferences"), dict) else {}
    lines: list[str] = []
    if user_profile.get("email"):
        lines.append(f"Signed-in account email: {user_profile['email']}")
    if preferences:
        preference_pairs = [f"{key}={value}" for key, value in preferences.items() if value not in (None, "", [], {})]
        if preference_pairs:
            lines.append("User preferences: " + ", ".join(preference_pairs[:8]))
    return lines or ["User profile preferences are empty."]


def _build_recent_report_context_lines(
    recent_reports: list[dict[str, Any]],
    current_report: dict[str, Any] | None,
    role: str,
) -> list[str]:
    if not recent_reports:
        return ["No recent reports are available for this account."]

    current_report_id = str(current_report.get("id")) if isinstance(current_report, dict) and current_report.get("id") is not None else None

    # For clinicians, reports may be from different patients
    if role == "clinician":
        lines = [
            f"Recent report count on this account: {len(recent_reports)}.",
            "IMPORTANT: As this user is a clinician, these reports likely belong to DIFFERENT patients. Do NOT assume continuity, trends, or compare them as a patient history. Each report is independent unless the clinician explicitly states otherwise.",
        ]
    else:
        lines = [
            f"Recent report count on this account: {len(recent_reports)}.",
            "These reports belong to this user's account. For patients and researchers, you may compare trends, track patterns over time, and reference past results when relevant.",
        ]

    comparable_reports = 0
    for report in recent_reports:
        if current_report_id and str(report.get("id")) == current_report_id:
            continue
        details = _collect_report_details(report)
        comparable_reports += 1
        events = details.get("events", [])
        event_summary = f"{len(events)} event(s) detected" if events else "no seizure events"

        lines.append(
            f"Past report #{comparable_reports}: "
            f"\"{details['filename']}\" | result: {details['result_label']} | "
            f"risk: {details['risk_level']} | confidence: {details['confidence_text']} | "
            f"reliability: {details['reliability_level']} | duration: {details['duration_text']} | "
            f"quality: {details['quality_grade']} | {event_summary} | "
            f"created: {report.get('created_at') or 'unknown'}"
        )
        # Include key recommendations for each past report
        if details.get("recommendations") and comparable_reports <= 3:
            lines.append(f"  → Recommendation: {details['recommendations'][0]}")
        if details.get("top_regions") and comparable_reports <= 3:
            if isinstance(details["top_regions"][0], (list, tuple)):
                region_text = ", ".join(name for name, _ in details["top_regions"][:3])
            else:
                region_text = ", ".join(str(r) for r in details["top_regions"][:3])
            lines.append(f"  → Active regions: {region_text}")

        if comparable_reports >= 8:
            break

    if comparable_reports == 0:
        lines.append("No prior reports beyond the current report are available for comparison.")

    # For patients/researchers, add trend summary across reports
    if role != "clinician" and comparable_reports >= 2:
        seizure_count = sum(1 for r in recent_reports if (r.get("result_label") or "").lower().startswith("seizure"))
        no_seizure_count = sum(1 for r in recent_reports if (r.get("result_label") or "").lower().startswith("no seizure"))
        lines.append(
            f"TREND OVERVIEW: Out of {len(recent_reports)} total reports, "
            f"{seizure_count} detected seizures and {no_seizure_count} found no seizures. "
            f"Use this to discuss patterns and progress with the user when relevant."
        )

    return lines


def _build_page_data_context_lines(page_data: dict[str, Any] | None) -> list[str]:
    if not isinstance(page_data, dict):
        return ["No structured page context was provided."]

    lines: list[str] = []
    summary = page_data.get("summary")
    stats = page_data.get("stats") if isinstance(page_data.get("stats"), dict) else {}
    latest_report = page_data.get("latest_report") if isinstance(page_data.get("latest_report"), dict) else None
    recent_reports = page_data.get("recent_reports") if isinstance(page_data.get("recent_reports"), list) else []
    active_analysis = page_data.get("active_analysis") if isinstance(page_data.get("active_analysis"), dict) else None

    if active_analysis:
        status = active_analysis.get("status", "unknown")
        filename = active_analysis.get("filename", "unknown file")
        progress = active_analysis.get("progress", 0)
        if status == "uploading":
            lines.append(f"ACTIVE JOB: The user is currently uploading \"{filename}\" ({progress}% complete). The file has not been analyzed yet.")
        elif status == "processing":
            lines.append(f"ACTIVE JOB: The file \"{filename}\" has been uploaded and is currently being processed by NeuroSentinel AI. The report is not ready yet.")
        else:
            lines.append(f"ACTIVE JOB: \"{filename}\" is in state \"{status}\".")
    else:
        lines.append("ACTIVE JOB: No file is currently being uploaded or processed.")

    if summary:
        lines.append(f"Page summary: {summary}")

    if stats:
        lines.append(
            "Page stats: "
            f"total={stats.get('totalReports', 'unknown')}, "
            f"completed={stats.get('completedReports', 'unknown')}, "
            f"processing={stats.get('processingReports', 'unknown')}, "
            f"failed={stats.get('failedReports', 'unknown')}"
        )

    if latest_report:
        latest_details = _collect_report_details(latest_report)
        lines.extend(
            [
                f"Latest page report: {latest_details['filename']}",
                f"Latest page result: {latest_details['result_label']}",
                f"Latest page risk: {latest_details['risk_level']}",
                f"Latest page confidence: {latest_details['confidence_text']}",
                f"Latest page reliability: {latest_details['reliability_level']}",
            ]
        )

    if recent_reports:
        lines.append(f"Recent reports available in page context: {len(recent_reports)}")

    return lines or ["Structured page context is empty."]


def _answer_page_question(page_data: dict[str, Any] | None, message: str) -> str | None:
    if not isinstance(page_data, dict):
        return None

    query = message.lower()
    latest_report = page_data.get("latest_report") if isinstance(page_data.get("latest_report"), dict) else None
    stats = page_data.get("stats") if isinstance(page_data.get("stats"), dict) else {}
    recent_reports = page_data.get("recent_reports") if isinstance(page_data.get("recent_reports"), list) else []
    latest_details = _collect_report_details(latest_report) if latest_report else None

    if latest_details and any(term in query for term in ["latest", "last report", "recent report", "current report"]):
        return (
            f"Your latest report is {latest_details['filename']} with result {latest_details['result_label']}, "
            f"risk {latest_details['risk_level']}, confidence {latest_details['confidence_text']}, "
            f"and {latest_details['reliability_level'].lower()} reliability."
        )

    if latest_details and any(term in query for term in ["reliability", "reliable", "confidence", "quality"]) and "report" not in query:
        return (
            f"The latest report has {latest_details['reliability_level'].lower()} reliability, "
            f"confidence {latest_details['confidence_text']}, and quality grade {latest_details['quality_grade']}."
        )

    if any(term in query for term in ["history", "how many", "count", "reports"]):
        if stats:
            return (
                f"You currently have {stats.get('totalReports', len(recent_reports))} report(s) in this page context, "
                f"with {stats.get('completedReports', 0)} completed, "
                f"{stats.get('processingReports', 0)} processing, and "
                f"{stats.get('failedReports', 0)} failed."
            )
        if recent_reports:
            return f"You currently have {len(recent_reports)} recent report(s) available in this page context."

    return None


def _answer_history_comparison_question(
    current_report: dict[str, Any] | None,
    recent_reports: list[dict[str, Any]],
    role: str,
    message: str,
) -> str | None:
    if not isinstance(current_report, dict):
        return None

    query = message.lower()
    comparison_terms = ["compare", "comparison", "previous", "prior", "past", "history", "historical", "trend"]
    if not any(term in query for term in comparison_terms):
        return None

    current_details = _collect_report_details(current_report)
    current_report_id = current_report.get("id")
    prior_reports = [report for report in recent_reports if report.get("id") != current_report_id]
    caution = (
        "Use historical comparison cautiously: prior account reports may belong to different patients, encounters, or recording contexts unless continuity is explicitly confirmed."
        if role == "clinician"
        else "Historical comparison should be interpreted cautiously unless the prior report is confirmed to be from the same person and clinical context."
    )

    if not prior_reports:
        return (
            f"The current report shows {current_details['result_label']} with {current_details['reliability_level'].lower()} reliability. "
            f"No prior report is available in this account context for comparison. {caution}"
        )

    prior_details = _collect_report_details(prior_reports[0])
    return (
        f"Current report: {current_details['result_label']}, reliability {current_details['reliability_level']}, "
        f"confidence {current_details['confidence_text']}. "
        f"Most recent prior account report: {prior_details['result_label']}, reliability {prior_details['reliability_level']}, "
        f"confidence {prior_details['confidence_text']}. {caution}"
    )


# ═══════════════════════════════════════════════════════════════════
# Clinical knowledge base — causes, health tips, diet, lifestyle
# ═══════════════════════════════════════════════════════════════════

_REGION_ETIOLOGY: dict[str, str] = {
    "temporal": "Temporal lobe involvement is the most common origin of focal seizures. Common causes include mesial temporal sclerosis, hippocampal abnormalities, tumors, or vascular malformations. Temporal lobe epilepsy can cause auras, deja vu, or emotional shifts before a seizure.",
    "frontal": "Frontal lobe seizures often present with brief, nocturnal episodes and may include unusual motor movements. Common causes include cortical dysplasia, traumatic injury, or tumors. They can sometimes be mistaken for sleep disorders.",
    "parietal": "Parietal lobe involvement may cause sensory symptoms such as tingling, numbness, or spatial disorientation. Causes can include structural lesions, post-traumatic changes, or cortical dysplasia.",
    "occipital": "Occipital lobe seizures typically cause visual symptoms like flashing lights, visual loss, or eye movement changes. Common causes include cortical malformations, posterior cerebral artery infarctions, or migraine-related conditions.",
    "central": "Central region involvement suggests activity near the motor or sensory cortex. This can cause contralateral motor or sensory symptoms. Causes may include structural lesions, cortical dysplasia, or post-surgical changes.",
    "generalized": "Generalized patterns suggest widespread cortical involvement rather than a focal origin. Common causes include genetic/idiopathic generalized epilepsies, metabolic disturbances, or medication-related factors.",
}

_GENERAL_SEIZURE_CAUSES = (
    "Seizures can arise from many causes including genetic predisposition, head injuries, "
    "brain infections (meningitis, encephalitis), stroke, brain tumors, metabolic imbalances "
    "(low blood sugar, electrolyte disturbances), sleep deprivation, high fever, drug or "
    "alcohol withdrawal, and certain medications. In many cases, the exact cause is not "
    "immediately identifiable and requires further clinical investigation."
)


def _get_severity_guidance_patient(risk: str, event_count: int | Any, se_flag: bool, diagnostic_state: str = "unknown") -> str:
    """Return warm, plain-language guidance based on severity for patients.

    When diagnostic_state is SUSPICIOUS, guidance is calibrated to unconfirmed
    findings — no emergency seizure precautions, focus on follow-up monitoring.
    """
    risk_lower = (risk or "").lower()

    # SUSPICIOUS state: no confirmed events — avoid emergency escalation
    if diagnostic_state == "SUSPICIOUS":
        if risk_lower in ("medium", "moderate"):
            return (
                "The analysis found suspicious patterns in your recording, but no confirmed seizure events. "
                "We recommend sharing this report with your neurologist so they can decide whether further "
                "evaluation — such as a repeat or extended EEG — is warranted. In the meantime, keep track "
                "of any symptoms, maintain a regular sleep schedule, and manage stress. There is no need "
                "for emergency action, but a follow-up consultation within the next few weeks is a good idea."
            )
        return (
            "Some transient patterns were flagged in your recording, but they were not strong or sustained "
            "enough to be classified as seizure events. This is worth mentioning to your doctor at your "
            "next visit. Continue your usual routine and monitor for any new symptoms."
        )

    if se_flag or risk_lower in ("critical", "high"):
        return (
            "Given the severity of these findings, it is very important that you contact your "
            "healthcare provider or neurologist as soon as possible — ideally within the next "
            "24 to 48 hours. Do not drive or operate heavy machinery until you have been "
            "evaluated. If you experience a prolonged seizure (lasting more than 5 minutes), "
            "repeated seizures without recovery, or difficulty breathing, call emergency "
            "services immediately. Keep someone informed about your condition and avoid being "
            "alone near water, heights, or open flames until you have medical guidance."
        )
    elif risk_lower in ("moderate", "medium"):
        return (
            "These findings suggest a moderate level of concern. You should schedule a follow-up "
            "appointment with your neurologist within the next one to two weeks to review these "
            "results in detail. In the meantime, prioritize getting adequate sleep, managing "
            "stress, and avoiding known triggers. Make sure someone close to you knows about "
            "your condition and what to do if a seizure occurs."
        )
    elif risk_lower == "low":
        return (
            "The findings suggest a low level of concern, which is reassuring. However, it is "
            "still a good idea to share this report with your doctor at your next scheduled "
            "visit. Continue maintaining healthy habits — regular sleep, stress management, "
            "and consistent medication (if prescribed) remain your best ongoing protections."
        )
    else:
        return (
            "Please share this report with your healthcare provider at your next appointment "
            "so they can review the results alongside your clinical history and determine "
            "whether any further evaluation is needed."
        )


def _get_health_tips_patient(risk: str, event_count: int | Any, diagnostic_state: str = "unknown") -> str:
    """Comprehensive health, diet, and lifestyle tips for patients.

    Safety precautions (avoid swimming alone, medical ID) only added when
    confirmed events exist or high/critical risk. SUSPICIOUS state gets
    monitoring-focused tips instead of emergency precautions.
    """
    risk_lower = (risk or "").lower()
    has_events = isinstance(event_count, int) and event_count > 0

    tips = (
        "Here are some important health and lifestyle tips that can help manage your neurological well-being. "
        "Sleep is one of the most powerful factors — aim for 7 to 9 hours of consistent sleep each night and "
        "try to maintain a regular sleep schedule, as sleep deprivation is a well-known seizure trigger. "
        "Stress management is equally important; consider practices like deep breathing, meditation, gentle "
        "yoga, or regular walks in nature."
    )

    diet = (
        "When it comes to diet, focus on balanced, regular meals — skipping meals can lower blood sugar "
        "and increase seizure risk. Stay well hydrated throughout the day. Some studies suggest that a "
        "Mediterranean-style diet rich in vegetables, fruits, whole grains, lean proteins, and healthy fats "
        "(like olive oil and omega-3 fatty acids from fish) may support brain health. Limit excessive caffeine "
        "and avoid alcohol, as both can lower the seizure threshold. If you are on anti-seizure medication, "
        "be aware that grapefruit can interact with some medications — check with your pharmacist."
    )

    lifestyle = (
        "From a lifestyle perspective, regular moderate exercise such as walking, swimming, or cycling is "
        "beneficial for overall brain health and mood. Avoid extreme exhaustion and overheating. Keep a "
        "seizure diary to track any episodes, missed medications, sleep patterns, or unusual stress — this "
        "information is invaluable for your doctor when adjusting your treatment plan."
    )

    # SUSPICIOUS state: monitoring tips, NOT emergency safety precautions
    if diagnostic_state == "SUSPICIOUS":
        monitoring = (
            "Since suspicious patterns were flagged, keeping a symptom diary can be especially helpful. "
            "Note any unusual sensations, brief episodes of confusion, or other neurological symptoms — even "
            "subtle ones — along with the date, time, and what you were doing. This information can help your "
            "neurologist decide whether further testing is needed."
        )
        return f"{tips}\n\n{diet}\n\n{lifestyle}\n\n{monitoring}"

    # DETECTED with confirmed events: include full safety precautions
    if has_events or risk_lower in ("critical", "high", "moderate", "medium"):
        safety = (
            "For safety, let family members or housemates know what to do during a seizure: keep the person "
            "safe from injury, do not put anything in their mouth, time the seizure, and call emergency services "
            "if it lasts longer than 5 minutes. Avoid swimming alone, and take showers rather than baths when possible. "
            "Consider wearing a medical ID bracelet that notes your condition."
        )
        return f"{tips}\n\n{diet}\n\n{lifestyle}\n\n{safety}"

    return f"{tips}\n\n{diet}\n\n{lifestyle}"


def _get_etiology_context(top_regions: list) -> str:
    """Derive likely etiology notes based on active brain regions."""
    if not top_regions:
        return _GENERAL_SEIZURE_CAUSES

    parts: list[str] = []
    seen_regions: set[str] = set()

    for item in top_regions[:4]:
        if isinstance(item, (list, tuple)):
            region_name = str(item[0]).lower()
        else:
            region_name = str(item).lower()

        for key, explanation in _REGION_ETIOLOGY.items():
            if key in region_name and key not in seen_regions:
                seen_regions.add(key)
                parts.append(explanation)

    if not parts:
        return _GENERAL_SEIZURE_CAUSES

    return " ".join(parts) + " " + _GENERAL_SEIZURE_CAUSES


def _get_severity_guidance_clinician(risk: str, event_count: int | Any, se_flag: bool) -> str:
    """Concise clinical management considerations for clinicians."""
    risk_lower = (risk or "").lower()

    if se_flag:
        return "Management: SE protocol — IV access, benzodiazepine loading, continuous EEG monitoring. Urgent neurology consult."
    if risk_lower in ("critical", "high"):
        return "Management: urgent neurology review within 24-48h. Consider AED optimization, extended EEG monitoring, MRI if not recent."
    if risk_lower in ("moderate", "medium"):
        return "Management: schedule neurology follow-up 1-2 weeks. Review AED compliance, sleep hygiene, trigger avoidance."
    if risk_lower == "low":
        return "Management: routine follow-up. Continue current regimen. Reinforce lifestyle factors — sleep, stress, medication adherence."
    return "Management: clinical correlation recommended."


def _get_etiology_clinician(top_regions: list) -> str:
    """Brief differential/etiology for clinicians based on regions."""
    if not top_regions:
        return "Etiology: consider structural, metabolic, genetic, or idiopathic causes. MRI + clinical correlation recommended."

    region_labels: list[str] = []
    for item in top_regions[:3]:
        if isinstance(item, (list, tuple)):
            region_labels.append(str(item[0]))
        else:
            region_labels.append(str(item))

    region_text = ", ".join(region_labels)
    differentials: list[str] = []

    combined = " ".join(r.lower() for r in region_labels)
    if "temporal" in combined:
        differentials.append("MTS/hippocampal sclerosis")
    if "frontal" in combined:
        differentials.append("cortical dysplasia/FLE")
    if "occipital" in combined:
        differentials.append("posterior cortical lesion")

    diff_text = ", ".join(differentials) if differentials else "structural/metabolic/genetic"
    return f"Etiology: prominent regions {region_text}. Differential: {diff_text}. MRI correlation advised."


def _get_researcher_context(top_regions: list, risk: str) -> str:
    """Epidemiological and clinical context for researchers."""
    risk_lower = (risk or "").lower()

    epi = (
        "Clinical context: epilepsy affects approximately 50 million people worldwide (WHO). "
        "Temporal lobe epilepsy is the most common form of focal epilepsy, accounting for ~60% of cases. "
        "Drug-resistant epilepsy occurs in ~30% of patients. "
    )

    if risk_lower in ("critical", "high"):
        epi += "High-risk findings correlate with increased morbidity and SUDEP risk, warranting aggressive management and monitoring protocols."
    elif risk_lower in ("moderate", "medium"):
        epi += "Moderate-risk profiles may indicate subclinical activity warranting longitudinal monitoring and AED optimization studies."
    else:
        epi += "Low-risk profiles are consistent with benign variants or well-controlled seizure disorders."

    return epi


def _get_clinician_counseling_block(risk: str, event_count: int | Any, diagnostic_state: str = "unknown", se_flag: bool = False) -> str:
    """Concise patient counseling points for clinician auto-summaries — immediate actions, sleep, diet, lifestyle."""
    risk_lower = (risk or "").lower()
    has_events = isinstance(event_count, int) and event_count > 0
    parts: list[str] = []

    # Immediate actions
    if se_flag:
        parts.append(
            "  Immediate: initiate SE protocol, ensure IV access, benzodiazepine loading. "
            "Patient/family should call emergency services for seizures >5 min."
        )
    elif risk_lower in ("critical", "high") or (has_events and diagnostic_state == "DETECTED"):
        parts.append(
            "  Immediate: advise patient to avoid driving, swimming alone, and operating machinery until cleared. "
            "Urgent neurology review within 24–48h. Advise family on seizure first aid (protect from injury, "
            "do not restrain, time the event, call 911 if >5 min). Consider medical ID bracelet."
        )
    elif risk_lower in ("moderate", "medium"):
        parts.append(
            "  Immediate: schedule neurology follow-up within 1–2 weeks. Reinforce seizure precautions "
            "(avoid unsupervised swimming/bathing, inform household contacts). Verify AED adherence."
        )
    elif diagnostic_state == "SUSPICIOUS":
        parts.append(
            "  Immediate: no emergency action required. Recommend follow-up consultation within 2–4 weeks. "
            "Advise patient to keep a symptom diary (any unusual sensations, brief confusion episodes)."
        )
    else:
        parts.append(
            "  Immediate: routine follow-up. No urgent action required. Continue current regimen."
        )

    # Sleep
    parts.append(
        "  Sleep: reinforce 7–9h consistent sleep schedule. Sleep deprivation is the #1 modifiable seizure trigger. "
        "Screen for sleep disorders if recurrent events."
    )

    # Diet
    parts.append(
        "  Diet: balanced regular meals (avoid fasting/hypoglycemia). Mediterranean-style diet supports neurological health. "
        "Limit caffeine, avoid alcohol (both lower seizure threshold). "
        "Check grapefruit interactions with current AEDs. Consider ketogenic diet referral for drug-resistant cases."
    )

    # Lifestyle
    parts.append(
        "  Lifestyle: moderate exercise (walking, cycling) is beneficial. Avoid extreme exhaustion/overheating. "
        "Stress management (mindfulness, CBT) reduces seizure frequency. "
        "Medication adherence is critical — counsel patient never to skip or self-adjust AED dosing."
    )

    return "\n".join(parts)


def _get_researcher_clinical_implications(risk: str, event_count: int | Any, diagnostic_state: str = "unknown", se_flag: bool = False) -> str:
    """Clinical implications and modifiable factors section for researcher auto-summaries."""
    risk_lower = (risk or "").lower()
    has_events = isinstance(event_count, int) and event_count > 0
    sections: list[str] = ["Clinical implications and modifiable factors:"]

    # Immediate actions
    if se_flag or risk_lower in ("critical", "high"):
        sections.append(
            "Immediate actions: high-risk findings warrant urgent clinical review (24–48h). "
            "Standard seizure precautions apply (driving restrictions, supervised water activities, "
            "seizure first aid education for household contacts, medical ID bracelet)."
        )
    elif risk_lower in ("moderate", "medium"):
        sections.append(
            "Immediate actions: moderate-risk profile suggests neurology follow-up within 1–2 weeks. "
            "Verify AED compliance and reinforce seizure precautions."
        )
    elif diagnostic_state == "SUSPICIOUS":
        sections.append(
            "Immediate actions: suspicious but unconfirmed patterns — no emergency intervention required. "
            "Symptom diary recommended; repeat or extended EEG may clarify subclinical burden."
        )
    else:
        sections.append(
            "Immediate actions: low-risk profile — routine follow-up at next scheduled visit."
        )

    # Sleep, diet, lifestyle — evidence-based context
    sections.append(
        "Sleep: sleep deprivation is the most significant modifiable seizure trigger (literature-supported). "
        "7–9h consistent schedule recommended; sleep disorder screening warranted for recurrent events."
    )
    sections.append(
        "Diet and nutrition: Mediterranean-style dietary pattern shows positive association with neurological outcomes. "
        "Hypoglycemia from meal-skipping is a documented seizure precipitant. Caffeine and alcohol lower seizure threshold. "
        "Ketogenic diet is evidence-based for drug-resistant epilepsy (Cochrane review–supported)."
    )
    sections.append(
        "Lifestyle and stress: moderate aerobic exercise correlates with reduced seizure frequency in observational studies. "
        "Stress reduction techniques (mindfulness-based stress reduction, CBT) have demonstrated efficacy in seizure diary studies. "
        "AED adherence is the single largest controllable variable in seizure recurrence prevention."
    )

    return " ".join(sections)


# ═══════════════════════════════════════════════════════════════════
# Report summary builders
# ═══════════════════════════════════════════════════════════════════

def _build_report_reply(report: dict[str, Any], role: str) -> str:
    """Build a detailed, role-aware summary of a report.

    Patient  -> warm, multi-paragraph narrative; no numbered points.
    Clinician -> concise, metric-dense structured output.
    Researcher -> hybrid narrative with embedded metrics and methodology notes.
    """
    details = _collect_report_details(report)
    events = [event for event in details["events"] if isinstance(event, dict)]
    top_channels = details["top_channels"]
    top_regions = details["top_regions"]
    recommendations = details["recommendations"]
    probability_summary = details["probability_summary"]
    normalized_role = _normalize_role(role)

    if normalized_role == "patient":
        return _build_patient_summary(details, events, top_channels, top_regions, recommendations, probability_summary)
    elif normalized_role == "researcher":
        return _build_researcher_summary(details, events, top_channels, top_regions, recommendations, probability_summary)
    else:
        return _build_clinician_summary(details, events, top_channels, top_regions, recommendations, probability_summary)


def _answer_report_question(report: dict[str, Any], role: str, message: str) -> str | None:
    details = _collect_report_details(report)
    query = message.lower()
    keywords = details.get("report_keywords") or [f"Reliability: {details['reliability_level']}"]

    if "reliability" in query and any(term in query for term in ["keyword", "mentioned", "present", "see", "find"]):
        return (
            f"Yes. The report explicitly includes the keyword \"Reliability\" and it is shown as "
            f"\"{keywords[0]}\"."
        )

    if any(term in query for term in ["keyword", "keywords", "label", "labels", "field", "fields"]) and any(
        term in query for term in ["report", "shown", "visible", "screen", "page"]
    ):
        return "Visible report labels include " + ", ".join(f"\"{keyword}\"" for keyword in keywords[:6]) + "."

    if any(term in query for term in ["reliability", "reliable", "confidence factor", "how reliable"]):
        base = f'The report explicitly shows "Reliability: {details["reliability_level"]}".'
        reasons = details["reliability_reasons"]
        if role == "patient":
            if reasons:
                return base + " The main reasons are that " + ", and ".join(reasons) + "."
            return base + " The supporting factors look strong."
        return base + " " + _format_reliability_block(details)

    if any(term in query for term in ["quality", "signal quality", "recording quality"]):
        return (
            f"Signal quality is graded as {details['quality_grade']} "
            f"with a quality score of {details['quality_score']}. "
            f"Reliability is {details['reliability_level'].lower()}."
        )

    if any(term in query for term in ["duration", "length", "how long"]):
        return f"The analyzed recording duration is {details['duration_text']}."

    if any(term in query for term in ["confidence", "certain", "how sure"]):
        return f"Model confidence for this report is {details['confidence_text']}."

    if any(term in query for term in ["risk", "danger", "severity"]):
        return f"The report risk level is {details['risk_level']}."

    if any(term in query for term in ["recommendation", "next step", "what should i do", "what do i do next"]):
        if details["recommendations"]:
            return "Top recommendation: " + str(details["recommendations"][0])
        if role == "patient":
            return _get_severity_guidance_patient(details["risk_level"], details["event_count"], details["se_flag"], details.get("diagnostic_state", "unknown"))
        return _get_severity_guidance_clinician(details["risk_level"], details["event_count"], details["se_flag"])

    if any(term in query for term in ["event", "seizure", "segment", "episode"]):
        if details["events"]:
            return f"The report flagged {details['event_count']} event(s). Representative event: {_format_event_brief(details['events'][0])}."
        if details.get("diagnostic_state") == "SUSPICIOUS":
            suppressed = details.get("suppressed_candidates", {})
            n_win = suppressed.get("n_windows_above_threshold", "multiple")
            return (
                f"No confirmed seizure events after post-processing. However, the model flagged {n_win} "
                f"candidate window(s) with seizure-like probability that did not meet duration or sustained "
                f"threshold criteria. Clinical correlation is recommended."
            )
        return "No seizure events were detected in this recording."

    if any(term in query for term in ["region", "brain region", "where", "channel"]):
        parts: list[str] = []
        if details["top_regions"]:
            if isinstance(details["top_regions"][0], (list, tuple)):
                region_text = ", ".join(f"{name} ({score:.3f})" for name, score in details["top_regions"][:3])
            else:
                region_text = ", ".join(str(region) for region in details["top_regions"][:3])
            parts.append(f"Top regions: {region_text}.")
        if details["top_channels"]:
            channel_text = ", ".join(f"{name} ({score:.3f})" for name, score in details["top_channels"][:3])
            parts.append(f"Top channels: {channel_text}.")
        if parts:
            return " ".join(parts)
        return "Regional and channel explainability details are not available for this report."

    if any(term in query for term in ["summary", "overall", "full report", "explain this"]):
        return _build_report_reply(report, role)

    return None


def _build_patient_summary(
    details: dict[str, Any],
    events: list[dict[str, Any]],
    top_channels: list,
    top_regions: list,
    recommendations: list,
    probability_summary: dict,
) -> str:
    """Warm, paragraph-based narrative for patients — no numbered lists."""
    filename = details["filename"]
    result = details["result_label"]
    risk = details["risk_level"]
    confidence = details["confidence_text"]
    quality = details["quality_grade"]
    duration = details["duration_text"]
    event_count = details["event_count"]
    trend = details["trend"]

    paragraphs: list[str] = []

    # Opening — state-aware: never say 'seizure detected' when state is SUSPICIOUS
    diagnostic_state = details.get("diagnostic_state", "unknown")
    suppressed = details.get("suppressed_candidates")

    if diagnostic_state == "DETECTED" or (diagnostic_state == "unknown" and isinstance(event_count, int) and event_count > 0):
        paragraphs.append(
            f"I have finished reviewing your EEG recording \"{filename}\". "
            f"The analysis has detected seizure-like activity in the recording. "
            f"Specifically, the system flagged {event_count} segment(s) that show patterns consistent with seizure events, "
            f"and the overall risk level has been assessed as {risk}. "
            f"The model's confidence in this finding is {confidence}."
        )
    elif diagnostic_state == "SUSPICIOUS":
        n_windows = (suppressed or {}).get("n_windows_above_threshold", "multiple")
        max_prob = (suppressed or {}).get("max_probability")
        max_prob_text = f" (highest probability: {max_prob:.1%})" if isinstance(max_prob, (int, float)) else ""
        alert_level = details.get("pattern_alert_level", "low")
        alert_word = "significant" if alert_level == "elevated" else "some"
        paragraphs.append(
            f"I have finished reviewing your EEG recording \"{filename}\". "
            f"The analysis found {alert_word} suspicious patterns — the model flagged {n_windows} segment(s) "
            f"with seizure-like probability{max_prob_text}. However, none of these segments met the strict "
            f"post-processing criteria required to be classified as confirmed seizure events. "
            f"This means the recording shows activity that warrants attention, but no definitive seizure events were identified. "
            f"The overall risk level is {risk} and the model's confidence is {confidence}."
        )
    else:
        paragraphs.append(
            f"I have finished reviewing your EEG recording \"{filename}\". "
            f"The good news is that the analysis did not detect any seizure activity in this recording. "
            f"The overall risk level is {risk} and the model's confidence in this assessment is {confidence}."
        )

    reliability_reasons = details["reliability_reasons"]
    if reliability_reasons:
        paragraphs.append(
            f"Overall report reliability is {details['reliability_level'].lower()}. "
            f"This is mainly because " + ", and ".join(reliability_reasons) + "."
        )
    else:
        paragraphs.append(
            f"Overall report reliability is {details['reliability_level'].lower()} based on the available recording quality, duration, and confidence signals."
        )

    # Quality & duration
    paragraphs.append(
        f"The recording was {duration} long and the signal quality was graded as {quality}. "
        f"Good signal quality means the system had clear data to work with, which makes the results more reliable. "
        f"If the quality had been poor, the results would need to be interpreted more cautiously."
    )

    # Events detail
    if events:
        first = events[0]
        onset = first.get("onset_sec") or first.get("start_sec") or "unknown"
        dur = first.get("duration_sec") or "unknown"
        paragraphs.append(
            f"The most notable event was detected at around {onset} seconds into the recording and lasted approximately {dur} seconds. "
            + (f"There were {len(events) - 1} additional segment(s) that also showed unusual patterns. " if len(events) > 1 else "")
            + "These flagged segments represent areas where the brainwave patterns looked different from what would typically be expected during normal activity."
        )
    elif diagnostic_state == "SUSPICIOUS":
        suppressed = details.get("suppressed_candidates", {})
        n_win = suppressed.get("n_windows_above_threshold", "multiple")
        paragraphs.append(
            f"Although no confirmed seizure events were identified after filtering, the system did flag {n_win} "
            f"segment(s) where the brainwave patterns showed brief, seizure-like characteristics. These segments "
            f"were too short or intermittent to meet the strict criteria for a confirmed seizure event, but they "
            f"suggest the presence of transient epileptiform-like activity that is worth mentioning to your doctor."
        )
    else:
        paragraphs.append(
            "No segments in the recording showed patterns that the system considers concerning. "
            "This means the brainwave activity throughout the entire recording appeared within normal expected ranges."
        )

    # Brain regions
    if top_regions:
        if isinstance(top_regions[0], (list, tuple)):
            region_names = [name for name, _ in top_regions[:3]]
        else:
            region_names = [str(r) for r in top_regions[:3]]
        region_text = ", ".join(region_names)
        paragraphs.append(
            f"The brain regions that showed the most activity during the recording were {region_text}. "
            "Think of this as a map showing where the system focused its attention most. "
            "This information can help your doctor understand which part of the brain might need closer monitoring."
        )

    # Likely causes
    paragraphs.append(
        "Understanding what might cause these patterns can be helpful. " + _get_etiology_context(top_regions)
    )

    # Trend & flags
    flag_parts: list[str] = []
    if details["se_flag"]:
        flag_parts.append("the system has raised a status epilepticus flag, which means it detected prolonged or rapidly recurring seizure-like activity that may need urgent attention")
    if details["early_warning"]:
        flag_parts.append("an early warning signal was detected, suggesting there may be patterns that precede seizure activity")

    if flag_parts:
        paragraphs.append(
            "There are some important flags to be aware of: " + ", and ".join(flag_parts) + ". "
            "Please make sure to discuss these flags with your healthcare provider as soon as possible."
        )

    # Overall trend
    if trend and trend.lower() != "no trend summary available.":
        paragraphs.append(f"Overall trend: {trend}")

    # Severity-based what-to-do guidance
    paragraphs.append(
        _get_severity_guidance_patient(risk, event_count, details["se_flag"], diagnostic_state)
    )

    # Health, diet, and lifestyle tips
    paragraphs.append(
        _get_health_tips_patient(risk, event_count, diagnostic_state)
    )

    # Recommendations & disclaimer
    if recommendations:
        rec_text = ". ".join(recommendations[:3])
        paragraphs.append(
            f"The clinical recommendations from this analysis include: {rec_text}. "
            "Remember, this report is generated by an AI system and is meant to support your doctor in making decisions — it is not a diagnosis on its own. "
            "Please share this report with your healthcare provider so they can review the findings alongside your clinical history."
        )
    else:
        paragraphs.append(
            "This report is generated by an AI system and is meant to support clinical decisions, not replace them. "
            "Please share it with your healthcare provider so they can review the findings in the context of your overall health."
        )

    return "\n\n".join(paragraphs)


def _build_clinician_summary(
    details: dict[str, Any],
    events: list[dict[str, Any]],
    top_channels: list,
    top_regions: list,
    recommendations: list,
    probability_summary: dict,
) -> str:
    """Concise, metric-dense structured summary for clinicians formatted for Markdown."""
    lines: list[str] = []

    lines.append(f"- **Report:** {details['filename']}")
    lines.append(f"- **Diagnostic State:** {details.get('diagnostic_state', 'unknown')}")
    lines.append(f"- **Result:** {details['result_label']} | **Risk:** {details['risk_level']} | **Confidence:** {details['confidence_text']} | **Events:** {details['event_count']}")
    lines.append(f"- **Duration:** {details['duration_text']} | **Quality:** {details['quality_grade']} ({details['quality_score']}/1.0)")
    lines.append(f"- **Reliability:** {_format_reliability_block(details)}")

    if probability_summary:
        lines.append(
            f"- **Probability:** mean {probability_summary.get('mean', '?')}, "
            f"median {probability_summary.get('median', '?')}, "
            f"p99 {probability_summary.get('p99', '?')}, "
            f"max {probability_summary.get('max', '?')}"
        )

    if events:
        lines.append(f"- **Primary event:** {_format_event_brief(events[0])}")
        if len(events) > 1:
            lines.append(f"- **Additional events:** {len(events) - 1} segment(s) flagged for review")
    elif details.get("diagnostic_state") == "SUSPICIOUS":
        suppressed = details.get("suppressed_candidates")
        n_win = (suppressed or {}).get("n_windows_above_threshold", "?")
        alert_level = details.get("pattern_alert_level", "low")
        lines.append(f"- **Event burden:** zero confirmed | {n_win} suppressed candidate window(s) | alert level: {alert_level}")
    else:
        lines.append("- **Event burden:** zero for the analyzed recording window")

    if top_channels:
        channel_text = ", ".join(f"{ch} ({sc:.3f})" for ch, sc in top_channels[:5])
        lines.append(f"- **Top channels:** {channel_text}")
    elif details["channel_summary"] and details["channel_summary"] != "not reported":
        lines.append(f"- **Channel summary:** {details['channel_summary']}")

    if top_regions:
        if isinstance(top_regions[0], (list, tuple)):
            region_text = ", ".join(f"{name} ({score:.3f})" for name, score in top_regions[:4])
        else:
            region_text = ", ".join(str(r) for r in top_regions[:4])
        lines.append(f"- **Active regions:** {region_text}")

    lines.append(f"- **Domain shift:** {details['domain_shift']}")

    flags: list[str] = []
    if details["se_flag"]:
        flags.append("SE flag raised")
    if details["early_warning"]:
        flags.append("early warning signal")
    if details["events_per_hour"] is not None:
        flags.append(f"events/hr: {details['events_per_hour']}")
    lines.append(f"- **Critical flags:** {', '.join(flags) if flags else 'none'}")

    if details["trend"] and details["trend"].lower() != "no trend summary available.":
        lines.append(f"- **Clinical summary:** {details['trend']}")

    # Etiology & differential
    lines.append(f"- **{_get_etiology_clinician(top_regions)}**")

    # Management guidance
    lines.append(f"- **{_get_severity_guidance_clinician(details['risk_level'], details['event_count'], details['se_flag'])}**")

    if recommendations:
        for i, rec in enumerate(recommendations[:3], 1):
            lines.append(f"- **Rec {i}:** {rec}")

    # Patient counseling points — immediate actions, sleep, diet, lifestyle
    lines.append(f"- **Patient Counseling Points:**")
    lines.append(_get_clinician_counseling_block(details['risk_level'], details['event_count'], details.get('diagnostic_state', 'unknown'), details['se_flag']))

    return "\n\n".join(lines)


def _build_researcher_summary(
    details: dict[str, Any],
    events: list[dict[str, Any]],
    top_channels: list,
    top_regions: list,
    recommendations: list,
    probability_summary: dict,
) -> str:
    """Hybrid narrative with embedded metrics for researchers."""
    lines: list[str] = []

    lines.append(
        f"Analysis of \"{details['filename']}\" is complete. "
        f"Result: {details['result_label']}, risk level {details['risk_level']}, "
        f"model confidence {details['confidence_text']}, "
        f"event count {details['event_count']}."
    )
    lines.append(
        f"Recording duration was {details['duration_text']} with signal quality graded {details['quality_grade']} "
        f"(score {details['quality_score']}/1.0)."
    )
    lines.append(
        f"Reliability is {details['reliability_level'].lower()} because " + "; ".join(details["reliability_reasons"]) + "."
    )
    lines.append(f"Domain shift: {details['domain_shift']}.")

    if probability_summary:
        lines.append(
            f"Probability profile: mean {probability_summary.get('mean', '?')}, "
            f"median {probability_summary.get('median', '?')}, "
            f"p99 {probability_summary.get('p99', '?')}, "
            f"max {probability_summary.get('max', '?')}."
        )

    if events:
        lines.append(f"Primary event: {_format_event_brief(events[0])}.")
        if len(events) > 1:
            lines.append(f"Additional events: {len(events) - 1} segment(s) require cross-validation against raw traces.")
    elif details.get("diagnostic_state") == "SUSPICIOUS":
        suppressed = details.get("suppressed_candidates")
        n_win = (suppressed or {}).get("n_windows_above_threshold", "?")
        max_p = (suppressed or {}).get("max_probability")
        max_p_text = f", peak probability {max_p:.1%}" if isinstance(max_p, (int, float)) else ""
        lines.append(f"Event burden: zero confirmed after post-processing. {n_win} candidate window(s) suppressed{max_p_text}.")
        lines.append("Post-processing filters (min duration, sustained threshold) removed all candidate events. Cross-validate with raw traces.")
    else:
        lines.append("Event burden: zero after post-processing filters for the analyzed window.")

    if top_channels:
        channel_text = ", ".join(f"{ch} ({sc:.3f})" for ch, sc in top_channels[:5])
        lines.append(f"Top channels by importance: {channel_text}.")
    if top_regions:
        if isinstance(top_regions[0], (list, tuple)):
            region_text = ", ".join(f"{name} ({score:.3f})" for name, score in top_regions[:4])
        else:
            region_text = ", ".join(str(r) for r in top_regions[:4])
        lines.append(f"Active regions: {region_text}.")

    flags: list[str] = []
    if details["se_flag"]:
        flags.append("status epilepticus flag")
    if details["early_warning"]:
        flags.append("early warning signal")
    if details["events_per_hour"] is not None:
        flags.append(f"events/hr: {details['events_per_hour']}")
    if flags:
        lines.append(f"Critical flags: {', '.join(flags)}.")

    if details["trend"] and details["trend"].lower() != "no trend summary available.":
        lines.append(f"Trend summary: {details['trend']}")

    lines.append(_get_researcher_context(top_regions, details["risk_level"]))

    lines.append(
        "Methodological note: all [HEURISTIC] labels are rule-based estimates, not ground-truth annotations. "
        "Cross-validate flagged segments against raw EEG traces before drawing conclusions. "
        "Model outputs are decision-support evidence and should not be treated as definitive clinical annotations."
    )

    if recommendations:
        rec_text = "; ".join(recommendations[:3])
        lines.append(f"Recommendations: {rec_text}.")

    # Clinical implications — immediate actions, sleep, diet, lifestyle
    lines.append(_get_researcher_clinical_implications(details['risk_level'], details['event_count'], details.get('diagnostic_state', 'unknown'), details['se_flag']))

    return "\n".join(lines)


def _is_auto_summary_request(message: str) -> bool:
    return message.strip().startswith(AUTO_SUMMARY_PREFIX)


def _is_report_summary_intent(message: str, report: dict[str, Any] | None) -> bool:
    if not report:
        return False
    if _is_auto_summary_request(message):
        return True
    query = message.lower()
    summary_terms = [
        "summarize",
        "summarise",
        "summary",
        "walk through",
        "walk me through",
        "review this report",
        "review the report",
        "explain this report",
        "explain the report",
        "technical summary",
        "clinical summary",
    ]
    return any(term in query for term in summary_terms)


def _needs_response_normalization(message: str) -> bool:
    lowered = message.lower()
    return any(marker in lowered for marker in TRUNCATION_MARKERS)


def _deterministic_fallback(context: ScoutContext, user_profile: dict[str, Any] | None, recent_reports: list[dict[str, Any]], report: dict[str, Any] | None) -> str:
    query = context.message.lower()
    role = _normalize_role(context.role or (user_profile or {}).get("role"))

    # Active analysis awareness
    page_data = context.page_data if isinstance(context.page_data, dict) else {}
    active_analysis = page_data.get("active_analysis") if isinstance(page_data.get("active_analysis"), dict) else None

    if active_analysis and any(term in query for term in ["upload", "uploading", "processing", "status", "happening", "progress", "file", "current"]):
        status = active_analysis.get("status", "unknown")
        filename = active_analysis.get("filename", "your file")
        progress = active_analysis.get("progress", 0)
        if status == "uploading":
            return f"I can see \"{filename}\" is currently uploading — it's at {progress}% right now. The file is being securely streamed to the analysis server. Keep the tab open for the best experience."
        elif status == "processing":
            return f"\"{filename}\" has been uploaded and is now being analyzed by NeuroSentinel AI. The report should be ready shortly. You can safely navigate away — I'll let you know when it's done."
        else:
            return f"\"{filename}\" is currently in \"{status}\" state."

    if any(term in query for term in ["diagnose", "treat", "medication", "prescribe"]):
        return "I can explain NeuroSentinel AI results and provide general health guidance, but I cannot diagnose, prescribe, or recommend specific treatment changes. Please consult your healthcare provider."

    if any(term in query for term in ["upload", "start", "tour", "dashboard"]) and not active_analysis:
        return "Start on the dashboard, upload an EDF file, and NeuroSentinel AI will create a pending report immediately while the backend analyzes the recording asynchronously."

    # Past results / history queries
    if any(term in query for term in ["past", "history", "previous", "old report", "my results", "my reports", "trend"]):
        if recent_reports:
            latest = recent_reports[0]
            latest_details = _collect_report_details(latest)
            count = len(recent_reports)
            if role == "clinician":
                return (
                    f"You have {count} report(s) in your account history. "
                    f"Most recent: \"{latest_details['filename']}\" — {latest_details['result_label']}, "
                    f"risk {latest_details['risk_level']}, confidence {latest_details['confidence_text']}. "
                    f"Note: as a clinician, these may belong to different patients."
                )
            else:
                seizure_count = sum(1 for r in recent_reports if (r.get("result_label") or "").lower().startswith("seizure"))
                return (
                    f"You have {count} report(s) on your account. "
                    f"Most recent: \"{latest_details['filename']}\" — {latest_details['result_label']}, "
                    f"risk {latest_details['risk_level']}, confidence {latest_details['confidence_text']}. "
                    f"Across all reports, {seizure_count} detected seizure activity. "
                    f"Would you like me to go into more detail about any specific report?"
                )
        else:
            return "You don't have any reports yet. Upload an EEG file from the dashboard to get started."

    history_comparison_answer = _answer_history_comparison_question((report or context.current_report), recent_reports, role, context.message)
    if history_comparison_answer:
        return history_comparison_answer
    if any(term in query for term in ["memory", "remember", "chat history", "conversation history", "chat reset"]):
        return "SCOUT keeps chat messages for this session only. When you log out or start a new session, the conversation resets."
    report_specific_answer = _answer_report_question((report or context.current_report), role, context.message) if (report or context.current_report) else None
    if report_specific_answer:
        return report_specific_answer
    page_specific_answer = _answer_page_question(context.page_data, context.message)
    if page_specific_answer:
        return page_specific_answer
    if _is_report_summary_intent(context.message, report or context.current_report):
        return _build_report_reply((report or context.current_report), role)  # type: ignore[arg-type]

    recent_count = len(recent_reports)
    active_note = ""
    if active_analysis:
        status = active_analysis.get("status", "unknown")
        filename = active_analysis.get("filename", "a file")
        active_note = f" I can see \"{filename}\" is currently {status}."

    return (
        f"{SCOUT_FULL_NAME} is online in {role} mode. "
        f"I can help with onboarding, uploads, report explanation, and health guidance. "
        f"You have {recent_count} recent report(s).{active_note}"
    )


def _normalize_provider_message(
    message: str,
    context: ScoutContext,
    user_profile: dict[str, Any] | None,
    recent_reports: list[dict[str, Any]],
    report: dict[str, Any] | None,
) -> tuple[str, bool]:
    cleaned = message.strip()
    if cleaned and not _needs_response_normalization(cleaned):
        return cleaned, False

    if report:
        role = _normalize_role(context.role or (user_profile or {}).get("role"))
        return _build_report_reply(report, role), True

    return _deterministic_fallback(context, user_profile, recent_reports, report), True


class ScoutService:
    def __init__(self, settings: Settings, supabase_service: SupabaseService) -> None:
        self.settings = settings
        self.supabase_service = supabase_service
        providers: list[ScoutProvider] = []
        if settings.resolved_gemini_api_key:
            providers.append(GeminiScoutProvider(settings))
        if settings.groq_api_key:
            providers.append(GroqScoutProvider(settings))
        if settings.huggingface_api_key:
            providers.append(HuggingFaceScoutProvider(settings))
        self.providers = providers

    async def chat(self, context: ScoutContext) -> dict[str, Any]:
        user_profile = self.supabase_service.fetch_user_profile(context.user_id)
        if context.session_history:
            history = context.session_history
        else:
            history = self.supabase_service.fetch_recent_chat_messages(context.user_id, self.settings.scout_max_history)
        current_report = self.supabase_service.fetch_report(context.user_id, context.report_id) if context.report_id else None
        if current_report and context.current_report:
            active_report = {**current_report, **context.current_report}
        else:
            active_report = current_report or context.current_report
        recent_reports = self.supabase_service.fetch_recent_reports(context.user_id, self.settings.scout_report_limit)
        product_snippets = select_product_snippets(context.page, context.message)
        resolved_role = _normalize_role(context.role or (user_profile or {}).get("role"))

        tool_outputs = {
            "fetch_user_role_profile": user_profile,
            "fetch_last_20_chat_messages": history,
            "fetch_current_report": current_report,
            "fetch_recent_reports_list": recent_reports,
            "fetch_static_product_snippets": product_snippets,
        }

        if _is_report_summary_intent(context.message, active_report):
            return {
                "message": _build_report_reply(active_report, resolved_role),  # type: ignore[arg-type]
                "provider": "deterministic-report",
                "tools_used": list(tool_outputs.keys()),
                "fallback": False,
                "provider_failures": [],
            }

        history_comparison_answer = _answer_history_comparison_question(active_report, recent_reports, resolved_role, context.message)
        if history_comparison_answer:
            return {
                "message": history_comparison_answer,
                "provider": "deterministic-report",
                "tools_used": list(tool_outputs.keys()),
                "fallback": False,
                "provider_failures": [],
            }

        report_specific_answer = _answer_report_question(active_report, resolved_role, context.message) if active_report else None
        if report_specific_answer:
            return {
                "message": report_specific_answer,
                "provider": "deterministic-report",
                "tools_used": list(tool_outputs.keys()),
                "fallback": False,
                "provider_failures": [],
            }

        system_prompt = self._build_system_prompt(context, user_profile, history, active_report, recent_reports, product_snippets)
        provider_failures: list[str] = []
        for provider in self.providers:
            try:
                logger.info("Attempting SCOUT provider: %s", provider.name)
                result = await provider.generate(system_prompt=system_prompt, user_message=context.message)
                normalized_message, normalized = _normalize_provider_message(
                    result.message,
                    context,
                    user_profile,
                    recent_reports,
                    active_report,
                )
                return {
                    "message": normalized_message,
                    "provider": result.provider if not normalized else "deterministic-fallback",
                    "tools_used": list(tool_outputs.keys()),
                    "fallback": normalized,
                    "provider_failures": provider_failures,
                }
            except ProviderUnavailableError as exc:
                logger.warning("SCOUT provider %s unavailable: %s", provider.name, exc)
                provider_failures.append(f"{provider.name}: {exc}")
                continue
            except Exception as exc:
                logger.warning("SCOUT provider %s failed: %s", provider.name, exc)
                provider_failures.append(f"{provider.name}: {exc}")
                continue

        return {
            "message": _deterministic_fallback(context, user_profile, recent_reports, active_report),
            "provider": "deterministic-fallback",
            "tools_used": list(tool_outputs.keys()),
            "fallback": True,
            "provider_failures": provider_failures,
        }

    def _build_system_prompt(
        self,
        context: ScoutContext,
        user_profile: dict[str, Any] | None,
        history: list[dict[str, Any]],
        current_report: dict[str, Any] | None,
        recent_reports: list[dict[str, Any]],
        product_snippets: list[dict[str, Any]],
    ) -> str:
        role = _normalize_role(context.role or (user_profile or {}).get("role"))
        role_instructions = {
            "clinician": (
                "Be clinical, structured, and metric-dense. Provide concise paragraph-style responses. Do not use bulleted lists or pipe-separated lines for regular responses unless explicitly requested. "
                "MANDATORY: Provide strict HEALTH INTERPRETATION (explain significance of findings) and ACTIONABLE GUIDANCE (suggest what to do next, e.g., 'consider video-EEG monitoring'). "
                "MANDATORY: Include patient counseling considerations — immediate actions, sleep hygiene, dietary guidance, lifestyle modifications, and medication adherence reminders. "
                "Focus purely on interpretation and next steps. "
                "When a current report is open, explicitly account for reliability, confidence, duration, and signal quality. "
                "If the user explicitly requests a specific number of lines, points, or level of detail, you MUST fulfill that exact request — do not shorten or truncate."
            ),
            "researcher": (
                "Be technical and methodological. Use a hybrid of narrative context and embedded metrics. Include confidence bounds, methodology cues, and domain shift notes. Balance readability with data density. "
                "MANDATORY: When discussing report findings, include clinical implications such as immediate recommended actions, lifestyle considerations (sleep, diet, stress), and follow-up guidance relevant to the research context. "
                "If the user explicitly requests a specific number of lines, points, or level of detail, you MUST fulfill that exact request — do not shorten or truncate."
            ),
            "patient": (
                "Be warm, calm, and conversational. Write in flowing paragraphs — NEVER use numbered lists, bullet points, or structured metric dumps. Explain everything in plain language. "
                "MANDATORY: Provide clear HEALTH INTERPRETATION (explain in simple terms what the result means and possible reasons like abnormal electrical activity or seizure patterns). "
                "MANDATORY: Provide ACTIONABLE GUIDANCE (suggest what to do next and what kind of follow-up is needed, e.g., 'Consult your neurologist'). "
                "MANDATORY: Include health tips about medication adherence, sleep hygiene, stress management, and trigger avoidance. "
                "If past reports/trends are available, compare trends (e.g., 'Compared to your previous reports, activity appears stable'). "
                "When a current report is open, explicitly explain reliability in plain language and say why it is low, moderate, or high."
            ),
        }
        history_lines = [f"{message['role']}: {message['content']}" for message in history[-8:]]
        reports_summary = _build_recent_report_context_lines(recent_reports, current_report, role)
        snippet_text = [f"{snippet['title']}: {snippet['body']}" for snippet in product_snippets]
        user_profile_lines = _summarize_user_preferences(user_profile)

        report_context_lines: list[str] = []
        if current_report:
            details = _collect_report_details(current_report)
            diagnostic_state = details.get("diagnostic_state", "unknown")
            report_context_lines.extend(
                [
                    _safe_report_summary(current_report),
                    f"Diagnostic state: {diagnostic_state}",
                    f"Result: {details['result_label']}",
                    f"Risk: {details['risk_level']}",
                    f"Confidence: {details['confidence_text']}",
                    f"Duration: {details['duration_text']}",
                    f"Quality: {details['quality_grade']} ({details['quality_score']}/1.0)",
                    f"Reliability: {details['reliability_level']}",
                    f"Reliability reasons: {'; '.join(details['reliability_reasons'])}",
                    f"Visible report labels: {'; '.join(details['report_keywords']) if details['report_keywords'] else 'not provided'}",
                    f"Trend: {details['trend']}",
                    f"Domain shift: {details['domain_shift']}",
                ]
            )
            # Suppressed candidate context for SUSPICIOUS state
            suppressed = details.get("suppressed_candidates")
            if diagnostic_state == "SUSPICIOUS" and suppressed:
                report_context_lines.extend([
                    f"Pattern alert level: {details.get('pattern_alert_level', 'unknown')}",
                    f"Suppressed candidates: {suppressed.get('n_windows_above_threshold', '?')} window(s) above threshold",
                    f"Max suppressed probability: {suppressed.get('max_probability', '?')}",
                    f"Seizure ratio: {suppressed.get('seizure_ratio', '?')}",
                    f"Filter reason: {suppressed.get('reason', 'unknown')}",
                    "CRITICAL: diagnostic_state is SUSPICIOUS. This means NO confirmed seizure events exist. "
                    "NEVER say 'seizure detected' or 'seizure events were found'. "
                    "Say 'suspicious patterns' or 'seizure-like patterns flagged but not confirmed'.",
                ])
            elif diagnostic_state == "CLEAR":
                report_context_lines.append(
                    "CRITICAL: diagnostic_state is CLEAR. NO seizure activity was detected. Do not suggest otherwise."
                )
            if details["events"]:
                report_context_lines.append(f"Representative event: {_format_event_brief(details['events'][0])}.") 
            if details["top_channels"]:
                channel_text = ", ".join(f"{channel} ({score:.3f})" for channel, score in details["top_channels"][:3])
                report_context_lines.append(f"Top channels: {channel_text}")
            elif details["channel_summary"]:
                report_context_lines.append(f"Channel summary: {details['channel_summary']}")
            if details["top_regions"]:
                if isinstance(details["top_regions"][0], (list, tuple)):
                    region_text = ", ".join(f"{name} ({score:.3f})" for name, score in details["top_regions"][:3])
                else:
                    region_text = ", ".join(str(region) for region in details["top_regions"][:3])
                report_context_lines.append(f"Top regions: {region_text}")
            if details["recommendations"]:
                report_context_lines.append(f"Primary recommendation: {details['recommendations'][0]}")
        else:
            report_context_lines.append("No current report is open.")

        page_context_lines = _build_page_data_context_lines(context.page_data)

        # Role-specific formatting rules
        format_rules = {
            "patient": (
                "FORMATTING RULES FOR PATIENT MODE:\n"
                "- Write in warm, clear language. NEVER use numbered lists, bullet points, or structured data dumps.\n"
                "- Explain medical terms in simple words. Use analogies when helpful.\n"
                "- Keep a calm and reassuring tone throughout.\n"
                "- For normal chat, keep responses extremely precise and brief (1-3 sentences maximum) UNLESS the user explicitly requests more detail or a specific number of lines/points."
            ),
            "clinician": (
                "FORMATTING RULES FOR CLINICIAN MODE:\n"
                "- Write in a professional, concise, and highly clinical tone.\n"
                "- No excessive narrative — lead with core insights and data.\n"
                "- NEVER format responses using pipe characters (|). Write in natural sentences.\n"
                "- For normal chat, keep responses to 1-3 concise lines maximum UNLESS the user explicitly requests more detail or a specific number of lines/points.\n"
                "- When the user asks for a specific length (e.g. '10 lines', '5 points', 'detailed'), you MUST produce at least that many lines or points."
            ),
            "researcher": (
                "FORMATTING RULES FOR RESEARCHER MODE:\n"
                "- Focus on technical details, raw metrics, and methodology.\n"
                "- Include confidence bounds and statistical measures.\n"
                "- NEVER format responses using pipe characters (|). Write in natural sentences.\n"
                "- For normal chat, keep responses to 1-3 concise lines maximum UNLESS the user explicitly requests more detail or a specific number of lines/points.\n"
                "- When the user asks for a specific length (e.g. '10 lines', '5 points', 'detailed'), you MUST produce at least that many lines or points."
            ),
        }

        # Role-specific intelligence rules
        role_intelligence = {
            "patient": (
                "PATIENT INTELLIGENCE RULES:\n"
                "- You have FULL access to this user's past EEG analysis reports. Proactively reference them when relevant.\n"
                "- When asked about past results, trends, or history, use the RECENT REPORTS section below to give specific answers with filenames, dates, and outcomes.\n"
                "- Provide MEDICAL RECOMMENDATIONS based on the findings: sleep hygiene, stress management, medication adherence, dietary tips, trigger avoidance, when to see a neurologist.\n"
                "- Compare trends across reports: 'Your last 3 reports all showed no seizure activity — that's a positive trend.'\n"
                "- If seizures were detected, explain what brain regions were involved and what that might mean in simple terms.\n"
                "- Be proactive: if the user has a high-risk report, gently recommend urgent follow-up.\n"
                "- You are this patient's trusted health companion inside NeuroSentinel AI. Be supportive, knowledgeable, and actionable."
            ),
            "clinician": (
                "CLINICIAN INTELLIGENCE RULES:\n"
                "- This user is a clinician who may upload EEGs from DIFFERENT patients. Do NOT assume report continuity.\n"
                "- Do NOT compare past reports as if they belong to the same patient unless the clinician explicitly says so.\n"
                "- Focus on the CURRENT report's clinical significance, interpretation, and management considerations.\n"
                "- You may reference how many reports the clinician has processed and their overall statistics, but never personalize medical advice.\n"
                "- Provide differential diagnoses considerations, management protocols, and clinical decision support based on the current report findings.\n"
                "- MANDATORY: When summarizing or discussing a report, include patient counseling points: immediate actions, sleep hygiene, dietary guidance, lifestyle modifications, and medication adherence reminders.\n"
                "- Be efficient and metric-driven."
            ),
            "researcher": (
                "RESEARCHER INTELLIGENCE RULES:\n"
                "- You may compare past reports for methodological purposes (model performance, domain shift patterns, signal quality trends).\n"
                "- Provide statistical context: seizure detection rates, confidence distributions, reliability patterns across analyses.\n"
                "- Reference past reports to discuss model behavior and consistency.\n"
                "- Include epidemiological context when relevant.\n"
                "- MANDATORY: When summarizing or discussing a report, include clinical implications: immediate recommended actions, sleep/diet/lifestyle modifiable factors, and evidence-based context for seizure management.\n"
                "- If the user asks for a specific number of lines or points, you MUST produce at least that many — never truncate."
            ),
        }

        # Active analysis awareness rules
        active_analysis_rules = (
            "ACTIVE ANALYSIS AWARENESS:\n"
            "- The PAGE CONTEXT section below tells you if a file is currently being uploaded or processed.\n"
            "- If a file is UPLOADING: Tell the user you can see their upload in progress, mention the filename and progress. Reassure them the file is being securely streamed.\n"
            "- If a file is PROCESSING: Tell the user their file is being analyzed by the AI. Let them know the report will be ready soon and they can navigate away safely.\n"
            "- If NO active job: Do not mention uploading or processing unless asked.\n"
            "- When asked 'what's happening?' or 'is my file uploading?', check the ACTIVE JOB line in PAGE CONTEXT and respond accordingly."
        )

        return "\n".join(
            [
                f"You are {SCOUT_FULL_NAME}, the intelligent clinical assistant powering NeuroSentinel AI.",
                "You are NOT a generic chatbot. You are a specialized clinical intelligence layer that has deep access to the user's EEG analysis data, account history, active processing state, and profile.",
                "You help with onboarding, product guidance, report explanation, medical context, health recommendations, and real-time awareness of what the user is doing.",
                "Never diagnose, prescribe, or recommend specific treatment changes — but you CAN and SHOULD provide general medical guidance, health tips, lifestyle recommendations, and clinical context based on findings.",
                "If a value is missing from context, say it is unknown.",
                f"User role: {role}",
                f"Role instruction: {role_instructions[role]}",
                format_rules[role],
                role_intelligence[role],
                active_analysis_rules,
                f"CRITICAL: You MUST calibrate EVERY response for the '{role}' role. "
                f"{'Write in plain, calm, and brief language. Avoid jargon. No numbered lists or bullets ever.' if role == 'patient' else 'Use precise clinical terminology with structured metric-dense findings.' if role == 'clinician' else 'Use technical, methodological language with metrics and confidence bounds.'}",
                f"Current page: {context.page}",
                "PRIMARY CONTEXT RULE: When a current report is open, treat the CURRENT REPORT block below as the primary source of truth over general assumptions.",
                "REPORT RULE: If a current report is available, treat reliability as part of the core result and mention it whenever you summarize the report.",
                "RELIABILITY RULE: If the report explicitly includes a Reliability label, acknowledge that the label is present and state its exact value before elaborating.",
                "HISTORY AWARENESS: You have access to the user's recent reports in the RECENT REPORTS section. When the user asks about 'my past results', 'my history', 'previous reports', or 'trends', reference this data directly with specific filenames, dates, and outcomes. Do NOT say you cannot access past data — you CAN.",
                "MEDICAL RECOMMENDATIONS: When discussing seizure findings, provide appropriate health guidance based on severity. For patients: sleep, diet, stress, medication adherence, when to seek emergency care. For clinicians: management protocols, differential considerations, follow-up timelines.",
                "GLOBAL RULE: Unless you are generating the initial comprehensive auto-summary of a new EEG report, keep responses concise and focused. However, if the user EXPLICITLY requests a specific length, number of lines, number of points, or asks for 'detailed' or 'comprehensive' output, you MUST fully honor that request and produce the requested amount of content. Never truncate or shorten when the user specifies what they want.",
                "--- USER PROFILE ---",
                *user_profile_lines,
                "--- CURRENT REPORT ---",
                *report_context_lines,
                "--- PAGE CONTEXT ---",
                *page_context_lines,
                "--- RECENT REPORTS ---",
                *reports_summary,
                "--- CHAT HISTORY ---",
                *history_lines,
                "--- PRODUCT KNOWLEDGE ---",
                *snippet_text,
            ]
        )

