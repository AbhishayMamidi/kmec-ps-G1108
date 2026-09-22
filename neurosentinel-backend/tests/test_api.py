import os
from pathlib import Path

from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "service-key")
os.environ.setdefault("INTERNAL_API_SECRET", "test-secret")

from app.config import Settings
from app.main import create_app


def _settings(tmp_path: Path) -> Settings:
    """Build a minimal Settings instance pointing at a non-existent model file."""
    return Settings(
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SERVICE_KEY="service-key",
        INTERNAL_API_SECRET="test-secret",
        MODEL_PATH=tmp_path / "missing.pt",  # cross-platform via pytest tmp_path
    )


def test_health_reports_model_not_ready(tmp_path: Path) -> None:
    app = create_app(settings=_settings(tmp_path), load_model_on_startup=False)
    with TestClient(app) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["model_ready"] is False
