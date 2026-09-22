from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "NeuroSentinel Backend"
    environment: str = "development"
    log_level: str = "INFO"

    supabase_url: str = Field(alias="SUPABASE_URL")
    supabase_service_key: str = Field(alias="SUPABASE_SERVICE_KEY")
    supabase_storage_bucket: str = "eeg-uploads"
    supabase_report_pdfs_bucket: str = Field(default="report-pdfs", alias="SUPABASE_REPORT_PDF_BUCKET")

    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    google_gemini_api_key: str | None = Field(default=None, alias="GOOGLE_GEMINI_API_KEY")
    gemini_model: str = "gemini-2.5-flash"
    gemini_api_base: str = "https://generativelanguage.googleapis.com/v1beta"
    groq_api_key: str | None = Field(default=None, alias="GROQ_API_KEY")
    groq_model: str = "llama-3.3-70b-versatile"
    groq_api_base: str = "https://api.groq.com/openai/v1"
    huggingface_api_key: str | None = Field(default=None, alias="HUGGINGFACE_API_KEY")
    huggingface_model: str = "meta-llama/Llama-3.2-3B-Instruct"
    huggingface_api_base: str = "https://api-inference.huggingface.co/models"

    model_path: Path | None = Field(default=None, alias="MODEL_PATH")
    scout_max_history: int = 20
    scout_report_limit: int = 8

    backend_timeout_seconds: float = 60.0
    analysis_batch_size: int = 4  # Ultra-low for Render free-tier (512MB RAM)

    # Email notification settings (optional — set RESEND_API_KEY or SMTP_* to enable)
    resend_api_key: str | None = Field(default=None, alias="RESEND_API_KEY")
    resend_from_email: str = Field(default="NeuroSentinel AI <noreply@neurosentinel.app>", alias="RESEND_FROM_EMAIL")
    
    # Relay settings (Vercel proxy)
    relay_api_url: str | None = Field(default=None, alias="RELAY_API_URL")
    internal_api_secret: str = Field(alias="INTERNAL_API_SECRET")

    smtp_host: str | None = Field(default=None, alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_user: str | None = Field(default=None, alias="SMTP_USER")
    smtp_password: str | None = Field(default=None, alias="SMTP_PASSWORD")
    smtp_from_email: str | None = Field(default=None, alias="SMTP_FROM_EMAIL")

    # App URL for email links
    app_url: str = Field(default="https://neuro-sentinel-ai-6vfv.vercel.app", alias="APP_URL")

    @property
    def resolved_gemini_api_key(self) -> str | None:
        return self.gemini_api_key or self.google_gemini_api_key


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
