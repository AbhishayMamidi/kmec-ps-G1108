from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch

from app.services.analysis_service import AnalysisService


class DummySupabaseService:
    def __init__(self) -> None:
        self.inserted: list[dict[str, object]] = []
        self.updated: list[tuple[str, dict[str, object]]] = []
        self.uploaded: list[tuple[str, str, bytes]] = []

    def insert_report(self, values: dict[str, object]) -> None:
        self.inserted.append(values)

    def update_report(self, report_id: str, values: dict[str, object]) -> None:
        self.updated.append((report_id, values))

    def upload_report_pdf(self, user_id: str, report_id: str, pdf_bytes: bytes) -> str:
        self.uploaded.append((user_id, report_id, pdf_bytes))
        return f"{user_id}/{report_id}.pdf"


def test_analysis_service_retries_cpu_safe_mode(tmp_path: Path) -> None:
    supabase = DummySupabaseService()
    service = AnalysisService(supabase)  # type: ignore[arg-type]
    model = torch.nn.Linear(4, 2)
    edf_path = tmp_path / "fixture.edf"
    edf_path.write_bytes(b"fixture")
    windows = np.zeros((12, 22, 1024), dtype=np.float32)
    channel_mask = np.ones(22, dtype=bool)
    metadata = {"duration_sec": 120.0}
    analysis_result = {
        "raw_probabilities": np.array([0.1, 0.9], dtype=np.float32),
        "events": [],
        "n_events": 0,
    }
    report_payload = {
        "report_json": {"clinical_report_markdown": "Clinical EEG Report", "metadata": {}},
        "summary_text": "Ready",
        "result_label": "No seizure activity",
        "event_count": 0,
        "confidence_score": 91.2,
        "risk_level": "Low",
        "quality_grade": "Good",
        "duration_minutes": 2.0,
    }

    call_count = {"count": 0}

    def fake_analyze(*args, **kwargs):
        call_count["count"] += 1
        if call_count["count"] == 1:
            raise RuntimeError("could not execute a primitive")
        return analysis_result

    with (
        patch("app.services.analysis_service.preprocess_any_edf", return_value=(windows, channel_mask, metadata)),
        patch("app.services.analysis_service.analyze_preprocessed_windows", side_effect=fake_analyze),
        patch("app.services.analysis_service.compute_channel_importance", return_value=np.zeros(22, dtype=np.float32)),
        patch("app.services.analysis_service.extract_attention_maps", return_value=np.zeros((1, 1), dtype=np.float32)),
        patch("app.services.analysis_service.build_full_report_payload", return_value=report_payload),
        patch("app.services.analysis_service.generate_pdf", return_value=b"pdf"),
    ):
        result = service.run_analysis_upload(model=model, device=torch.device("cpu"), user_id="user-1", file_name="fixture.edf", edf_path=str(edf_path))

    assert result["status"] == "completed"
    assert call_count["count"] == 2
    assert report_payload["report_json"]["metadata"]["inference_mode"] == "cpu-safe-retry"
