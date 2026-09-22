from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.services.pdf import _display_role_label
from app.services.scout.service import (
    ScoutContext,
    ScoutService,
    _build_report_reply,
    _normalize_provider_message,
)


def _sample_report() -> dict:
    return {
        "id": "report-1",
        "filename": "example.edf",
        "result_label": "Possible seizure activity",
        "risk_level": "High",
        "confidence_score": 92.4,
        "quality_grade": "Good",
        "duration_minutes": 12.5,
        "event_count": 2,
        "summary": "Two high-confidence events were flagged.",
        "report_json": {
            "trend_summary": "Two clustered events with elevated risk.",
            "early_warning": True,
            "quality": {
                "mean_quality_score": 0.93,
                "grade": "Good",
            },
            "channel_importance_summary": "F7 (0.412), T3 (0.377), P3 (0.264)",
            "top_regions": [["Left Temporal", 0.51], ["Left Frontal", 0.33]],
            "model_outputs": {
                "probability_summary": {"mean": 0.18, "median": 0.04, "p99": 0.91, "max": 0.97},
                "events_per_hour": 9.6,
                "shift_label": "Low shift",
            },
            "explainability": {
                "top_channels": [["F7", 0.412], ["T3", 0.377], ["P3", 0.264]],
            },
            "clinical_report": {
                "summary": {"overall_risk": "High"},
                "events": [
                    {
                        "onset_sec": 32.5,
                        "duration_sec": 18.0,
                        "confidence_pct": 95.1,
                        "risk_level": "High",
                        "pattern_type": "focal",
                    },
                    {
                        "onset_sec": 118.0,
                        "duration_sec": 11.5,
                        "confidence_pct": 88.3,
                        "risk_level": "Medium",
                        "pattern_type": "focal",
                    },
                ],
                "recommendations": [
                    "Review the flagged temporal segments against raw EEG.",
                    "Correlate these findings with symptoms and medication timing.",
                ],
            },
        },
    }


class DummySupabaseService:
    def fetch_user_profile(self, user_id: str) -> dict:
        return {"id": user_id, "role": "researcher", "email": "user@example.com"}

    def fetch_recent_chat_messages(self, user_id: str, limit: int) -> list[dict]:
        return []

    def fetch_report(self, user_id: str, report_id: str | None) -> dict | None:
        return _sample_report() if report_id else None

    def fetch_recent_reports(self, user_id: str, limit: int) -> list[dict]:
        return [_sample_report()]


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        resolved_gemini_api_key=None,
        groq_api_key=None,
        huggingface_api_key=None,
        scout_max_history=8,
        scout_report_limit=5,
    )


def test_build_report_reply_is_role_aware_and_bounded() -> None:
    reply = _build_report_reply(_sample_report(), "researcher")
    lines = reply.splitlines()
    assert 10 <= len(lines) <= 15
    assert "Probability profile" in reply
    assert "Top channels" in reply


def test_truncation_marker_replaces_partial_provider_output() -> None:
    context = ScoutContext(
        user_id="user-1",
        message="Explain this report",
        page="report",
        role="researcher",
        report_id="report-1",
        current_report=_sample_report(),
        session_history=[],
    )
    reply, normalized = _normalize_provider_message(
        "I couldn't send a lengthy message due to constraints.",
        context,
        {"role": "researcher"},
        [_sample_report()],
        _sample_report(),
    )
    assert normalized is True
    assert 10 <= len(reply.splitlines()) <= 15
    assert "constraints" not in reply.lower()


def test_chat_uses_deterministic_summary_for_auto_prompt() -> None:
    service = ScoutService(_settings(), DummySupabaseService())  # type: ignore[arg-type]
    context = ScoutContext(
        user_id="user-1",
        message="__SCOUT_AUTO_SUMMARY__ Summarize this report for a researcher in 10-15 short lines.",
        page="report",
        role="researcher",
        report_id="report-1",
        current_report=_sample_report(),
        session_history=[],
    )

    payload = asyncio.run(service.chat(context))

    assert payload["provider"] == "deterministic-report"
    assert payload["fallback"] is False
    assert 10 <= len(payload["message"].splitlines()) <= 15


def test_display_role_label_never_defaults_to_patient() -> None:
    assert _display_role_label("researcher") == "Researcher"
    assert _display_role_label("user") == "Unknown"
