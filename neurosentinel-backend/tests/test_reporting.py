from app.pipeline.reporting import generate_clinical_report


def test_generate_clinical_report_contains_summary_fields() -> None:
    report = generate_clinical_report(
        {
            "recording_id": "fixture.edf",
            "quality_grade": "Good",
            "quality_score": 0.91,
            "duration_minutes": 12.4,
            "missing_channels": [],
            "risk_level": "High",
            "trend_summary": "2 event(s) detected with high overall heuristic risk.",
            "events": [
                {
                    "event_idx": 1,
                    "onset_sec": 10.0,
                    "offset_sec": 30.0,
                    "duration_sec": 20.0,
                    "mean_probability": 0.94,
                    "severity_score": 6.3,
                    "risk_level": "High",
                    "pattern_type": "focal",
                    "focal_vs_gen": "focal",
                    "band_powers": {"gamma": 1.0},
                }
            ],
            "top_regions": [("Left Temporal", 0.42)],
            "channel_importance_summary": "FP1-F7 (0.420)",
        }
    )
    assert report["dict"]["summary"]["total_events"] == 1
    assert "Clinical EEG Report" in report["markdown"]
