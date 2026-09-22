from __future__ import annotations

import logging

from dataclasses import dataclass
from typing import Any

import httpx
from supabase import Client, create_client

from app.config import Settings


@dataclass
class AuthenticatedUser:
    id: str
    email: str | None


class SupabaseService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client: Client = create_client(settings.supabase_url, settings.supabase_service_key)

    def verify_access_token(self, access_token: str) -> AuthenticatedUser:
        response = httpx.get(
            f"{self.settings.supabase_url}/auth/v1/user",
            headers={
                "apikey": self.settings.supabase_service_key,
                "Authorization": f"Bearer {access_token}",
            },
            timeout=self.settings.backend_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        return AuthenticatedUser(id=payload["id"], email=payload.get("email"))

    # Columns that exist in the base schema
    _BASE_REPORT_COLS = {"id", "user_id", "filename", "status", "report_json", "created_at", "updated_at"}

    def update_report(self, report_id: str, values: dict[str, Any]) -> None:
        try:
            self.client.table("reports").update(values).eq("id", report_id).execute()
        except Exception:
            # Retry with only base columns if extended columns don't exist yet
            safe = {k: v for k, v in values.items() if k in self._BASE_REPORT_COLS}
            if safe:
                self.client.table("reports").update(safe).eq("id", report_id).execute()

    def insert_report(self, values: dict[str, Any]) -> None:
        try:
            self.client.table("reports").insert(values).execute()
        except Exception:
            safe = {k: v for k, v in values.items() if k in self._BASE_REPORT_COLS}
            if safe:
                self.client.table("reports").insert(safe).execute()

    def fetch_report(self, user_id: str, report_id: str) -> dict[str, Any] | None:
        response = (
            self.client.table("reports")
            .select("*")
            .eq("id", report_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        return response.data[0] if response.data else None

    def fetch_recent_reports(self, user_id: str, limit: int) -> list[dict[str, Any]]:
        try:
            response = (
                self.client.table("reports")
                .select("id, filename, status, summary, result_label, event_count, confidence_score, quality_grade, risk_level, duration_minutes, created_at")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
        except Exception:
            # Fallback if extended columns don't exist yet
            response = (
                self.client.table("reports")
                .select("id, filename, status, created_at")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
        return response.data or []

    def fetch_user_profile(self, user_id: str) -> dict[str, Any] | None:
        try:
            response = self.client.table("users").select("id, email, role, onboarding_complete, preferences").eq("id", user_id).limit(1).execute()
        except Exception:
            # Fallback if 'preferences' column doesn't exist yet
            response = self.client.table("users").select("id, email, role, onboarding_complete").eq("id", user_id).limit(1).execute()
        if not response.data:
            return None
        profile = response.data[0]
        profile.setdefault("preferences", {})
        return profile

    def fetch_recent_chat_messages(self, user_id: str, limit: int) -> list[dict[str, Any]]:
        try:
            response = (
                self.client.table("chat_messages")
                .select("id, role, content, report_id, page_context, metadata, created_at")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
        except Exception:
            # Fallback if extended columns don't exist yet
            response = (
                self.client.table("chat_messages")
                .select("id, role, content, created_at")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
        messages = response.data or []
        return list(reversed(messages))

    def upload_report_pdf(self, user_id: str, report_id: str, pdf_bytes: bytes) -> str:
        path = f"{user_id}/{report_id}.pdf"
        self.client.storage.from_(self.settings.supabase_report_pdfs_bucket).upload(
            path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        return path

    def download_report_pdf(self, user_id: str, report_id: str) -> bytes:
        path = f"{user_id}/{report_id}.pdf"
        return self.client.storage.from_(self.settings.supabase_report_pdfs_bucket).download(path)

    def remove_report_pdfs(self, user_id: str, report_ids: list[str]) -> None:
        if not report_ids:
            return
        paths = [f"{user_id}/{report_id}.pdf" for report_id in report_ids]
        self.client.storage.from_(self.settings.supabase_report_pdfs_bucket).remove(paths)
