from __future__ import annotations

import contextlib
import gc
import logging
from uuid import uuid4

import numpy as np
import torch

from app.config import Settings
from app.pipeline.explainability import compute_channel_importance, extract_attention_maps
from app.pipeline.inference import GuardFn, JobAborted, analyze_preprocessed_windows as analyze_windows_batch, infer_from_data_chunked
from app.pipeline.preprocessing import preprocess_edf_to_data, extract_window_at
from app.pipeline.reporting import build_full_report_payload
from app.services.email import (
    send_report_notification, 
    send_timeout_notification,
    send_failure_notification,
    send_aborted_notification,
    send_size_exceeded_notification
)
from app.services.pdf import generate_pdf
from app.services.supabase import SupabaseService

logger = logging.getLogger(__name__)


def preprocess_any_edf(edf_path: str):
    """Compatibility wrapper for tests and legacy call sites."""
    return preprocess_edf_to_data(edf_path)


def analyze_preprocessed_windows(
    model: torch.nn.Module,
    windows: np.ndarray,
    channel_mask: np.ndarray,
    metadata: dict,
    *,
    device: torch.device,
    batch_size: int,
    max_windows_per_chunk: int = 50,
    guard_fn: GuardFn | None = None,
):
    """Route legacy window-based calls and current chunked calls through one patchable hook."""
    if isinstance(windows, np.ndarray) and windows.ndim == 3:
        return analyze_windows_batch(model, windows, channel_mask, metadata, device=device, batch_size=batch_size)
    return infer_from_data_chunked(
        model,
        windows,
        channel_mask,
        metadata,
        device=device,
        batch_size=batch_size,
        max_windows_per_chunk=max_windows_per_chunk,
        guard_fn=guard_fn,
    )


class AnalysisService:
    def __init__(self, supabase_service: SupabaseService, settings: Settings | None = None) -> None:
        self.supabase_service = supabase_service
        self.settings = settings

    def _set_stage(self, report_id: str, summary: str) -> None:
        self.supabase_service.update_report(report_id, {"status": "processing", "error_message": None, "summary": summary})

    @contextlib.contextmanager
    def _mkldnn_disabled(self):
        previous = torch.backends.mkldnn.enabled
        torch.backends.mkldnn.enabled = False
        try:
            yield
        finally:
            torch.backends.mkldnn.enabled = previous

    def _resolve_chunk_batch_size(self, n_windows: int, requested_batch_size: int) -> int:
        """Aggressively reduce batch size to survive 512MB RAM limit."""
        if n_windows >= 1500:
            return 1
        if n_windows >= 800:
            return 2
        if n_windows >= 300:
            return 2
        return min(requested_batch_size, 4)

    def _send_completion_email(
        self,
        user_id: str,
        filename: str,
        report_updates: dict,
        pdf_bytes: bytes | None,
    ) -> None:
        """Send email notification after report completion (non-fatal)."""
        if not self.settings:
            return
        if not self.settings.resend_api_key and not self.settings.smtp_host:
            logger.debug("No email provider configured — skipping notification for %s.", filename)
            return
        # Skip if SMTP credentials are still placeholder values
        if self.settings.smtp_user and "your.email" in self.settings.smtp_user:
            logger.info("SMTP credentials are still placeholder values — skipping email for %s.", filename)
            return

        try:
            user_profile = self.supabase_service.fetch_user_profile(user_id)
            user_email = (user_profile or {}).get("email")
            user_role = (user_profile or {}).get("role")

            if not user_email:
                logger.warning("No email found for user %s — skipping notification.", user_id)
                return

            report_data = {
                "result_label": report_updates.get("result_label"),
                "risk_level": report_updates.get("risk_level"),
                "event_count": report_updates.get("event_count"),
                "confidence_score": report_updates.get("confidence_score"),
                "quality_grade": report_updates.get("quality_grade"),
            }

            sent, err = send_report_notification(
                to_email=user_email,
                report=report_data,
                filename=filename,
                role=user_role,
                pdf_bytes=pdf_bytes,
                resend_api_key=self.settings.resend_api_key,
                resend_from_email=self.settings.resend_from_email,
                smtp_host=self.settings.smtp_host,
                smtp_port=self.settings.smtp_port,
                smtp_user=self.settings.smtp_user,
                smtp_password=self.settings.smtp_password,
                smtp_from_email=self.settings.smtp_from_email,
                relay_api_url=self.settings.relay_api_url,
                internal_api_secret=self.settings.internal_api_secret,
                app_url=self.settings.app_url,
            )
            if sent:
                logger.info("Report completion email sent for %s to %s", filename, user_email)
            else:
                logger.info("Email notification skipped or failed for %s: %s", filename, err)
        except Exception as email_exc:
            logger.warning("Email notification failed for %s (non-fatal): %s", filename, email_exc)

    def send_timeout_notification(self, user_id: str, filename: str) -> None:
        """Send notification when analysis times out."""
        if not self.settings:
            return
        try:
            user_profile = self.supabase_service.fetch_user_profile(user_id)
            user_email = (user_profile or {}).get("email")
            if not user_email:
                return

            send_timeout_notification(
                to_email=user_email,
                filename=filename,
                resend_api_key=self.settings.resend_api_key,
                resend_from_email=self.settings.resend_from_email,
                smtp_host=self.settings.smtp_host,
                smtp_port=self.settings.smtp_port,
                smtp_user=self.settings.smtp_user,
                smtp_password=self.settings.smtp_password,
                smtp_from_email=self.settings.smtp_from_email,
                app_url=self.settings.app_url,
                relay_api_url=self.settings.relay_api_url,
                internal_api_secret=self.settings.internal_api_secret,
            )
            logger.info("Timeout notification sent for %s to %s", filename, user_email)
        except Exception as exc:
            logger.warning("Timeout notification failed (non-fatal): %s", exc)

    def send_failure_notification(self, user_id: str, filename: str, error_msg: str | None = None) -> None:
        """Send notification when analysis fails."""
        if not self.settings: return
        try:
            user_profile = self.supabase_service.fetch_user_profile(user_id)
            user_email = (user_profile or {}).get("email")
            if not user_email: return

            send_failure_notification(
                to_email=user_email,
                filename=filename,
                error_msg=error_msg,
                app_url=self.settings.app_url,
                resend_api_key=self.settings.resend_api_key,
                resend_from_email=self.settings.resend_from_email,
                smtp_host=self.settings.smtp_host,
                smtp_port=self.settings.smtp_port,
                smtp_user=self.settings.smtp_user,
                smtp_password=self.settings.smtp_password,
                smtp_from_email=self.settings.smtp_from_email,
                relay_api_url=self.settings.relay_api_url,
                internal_api_secret=self.settings.internal_api_secret,
            )
            logger.info("Failure notification sent for %s to %s", filename, user_email)
        except Exception as exc:
            logger.warning("Failure notification failed (non-fatal): %s", exc)

    def send_aborted_notification(self, user_id: str, filename: str) -> None:
        """Send notification when analysis is aborted."""
        if not self.settings: return
        try:
            user_profile = self.supabase_service.fetch_user_profile(user_id)
            user_email = (user_profile or {}).get("email")
            if not user_email: return

            send_aborted_notification(
                to_email=user_email,
                filename=filename,
                app_url=self.settings.app_url,
                resend_api_key=self.settings.resend_api_key,
                resend_from_email=self.settings.resend_from_email,
                smtp_host=self.settings.smtp_host,
                smtp_port=self.settings.smtp_port,
                smtp_user=self.settings.smtp_user,
                smtp_password=self.settings.smtp_password,
                smtp_from_email=self.settings.smtp_from_email,
                relay_api_url=self.settings.relay_api_url,
                internal_api_secret=self.settings.internal_api_secret,
            )
            logger.info("Abortion notification sent for %s to %s", filename, user_email)
        except Exception as exc:
            logger.warning("Abortion notification failed (non-fatal): %s", exc)

    def send_size_exceeded_notification(self, user_id: str, filename: str, limit_mb: int) -> None:
        """Send notification when file size exceeds limit."""
        if not self.settings: return
        try:
            user_profile = self.supabase_service.fetch_user_profile(user_id)
            user_email = (user_profile or {}).get("email")
            if not user_email: return

            send_size_exceeded_notification(
                to_email=user_email,
                filename=filename,
                limit_mb=limit_mb,
                app_url=self.settings.app_url,
                resend_api_key=self.settings.resend_api_key,
                resend_from_email=self.settings.resend_from_email,
                smtp_host=self.settings.smtp_host,
                smtp_port=self.settings.smtp_port,
                smtp_user=self.settings.smtp_user,
                smtp_password=self.settings.smtp_password,
                smtp_from_email=self.settings.smtp_from_email,
                relay_api_url=self.settings.relay_api_url,
                internal_api_secret=self.settings.internal_api_secret,
            )
            logger.info("Size exceeded notification sent for %s to %s", filename, user_email)
        except Exception as exc:
            logger.warning("Size exceeded notification failed (non-fatal): %s", exc)

    def run_analysis_upload(
        self,
        model: torch.nn.Module,
        device: torch.device,
        user_id: str,
        file_name: str,
        edf_path: str,
        batch_size: int = 64,
    ) -> dict[str, object]:
        """Full upload flow: create report record + run pipeline. Used for synchronous calls."""
        report_id = str(uuid4())
        self.supabase_service.insert_report(
            {
                "id": report_id,
                "user_id": user_id,
                "filename": file_name,
                "storage_path": None,
                "status": "processing",
                "error_message": None,
                "summary": "Analysing the uploaded EEG recording.",
                "report_json": None,
            }
        )
        return self._run_pipeline(model, device, user_id, file_name, edf_path, report_id, batch_size)

    def run_analysis_upload_for_report(
        self,
        model: torch.nn.Module,
        device: torch.device,
        user_id: str,
        file_name: str,
        edf_path: str,
        report_id: str,
        batch_size: int = 64,
        guard_fn: GuardFn | None = None,
    ) -> dict[str, object]:
        """Run pipeline for a pre-created report record. Used by background tasks."""
        return self._run_pipeline(model, device, user_id, file_name, edf_path, report_id, batch_size, guard_fn=guard_fn)

    def _run_pipeline(
        self,
        model: torch.nn.Module,
        device: torch.device,
        user_id: str,
        file_name: str,
        edf_path: str,
        report_id: str,
        batch_size: int = 64,
        guard_fn: GuardFn | None = None,
    ) -> dict[str, object]:
        """Core analysis pipeline. Assumes report record already exists in DB."""
        try:
            # --- Stage 1: Preprocess ---
            self._set_stage(report_id, "Loading and preprocessing the uploaded EEG recording.")
            if guard_fn:
                guard_fn()
            analysis_input, channel_mask, metadata = preprocess_any_edf(edf_path)
            if analysis_input is None:
                raise RuntimeError(metadata.get("error") or "No usable EEG windows were extracted from the uploaded EDF.")

            n_windows = metadata.get("n_windows", 0)
            if not n_windows and isinstance(analysis_input, np.ndarray):
                if analysis_input.ndim == 3:
                    n_windows = int(analysis_input.shape[0])
                elif analysis_input.ndim == 2:
                    n_windows = int(metadata.get("n_windows") or 0)
            if n_windows == 0:
                raise RuntimeError("Recording is too short to extract any analysis windows.")

            effective_batch_size = self._resolve_chunk_batch_size(n_windows, batch_size)

            # --- Stage 2: Inference ---
            self._set_stage(report_id, f"Running model inference across {n_windows} EEG window(s) in memory-safe mode.")
            if guard_fn:
                guard_fn()
            inference_mode = "primary"

            try:
                inference_result = analyze_preprocessed_windows(
                    model, analysis_input, channel_mask, metadata,
                    device=device, batch_size=effective_batch_size,
                    max_windows_per_chunk=50,
                    guard_fn=guard_fn,
                )
            except RuntimeError as exc:
                if "could not execute a primitive" not in str(exc).lower():
                    raise
                logger.warning("Primary chunked inference failed with CPU primitive error. Retrying with mkldnn disabled.")
                self._set_stage(report_id, "Retrying model inference with CPU-safe compatibility mode.")
                inference_mode = "cpu-safe-retry"
                with self._mkldnn_disabled():
                    inference_result = analyze_preprocessed_windows(
                        model, analysis_input, channel_mask, metadata,
                        device=device, batch_size=max(1, effective_batch_size // 2),
                        max_windows_per_chunk=30,
                        guard_fn=guard_fn,
                    )

            if inference_result.get("status") not in (None, "ok") and "raw_probabilities" not in inference_result:
                raise RuntimeError("Inference produced no results.")

            # --- Stage 3: Explainability (uses one window only) ---
            self._set_stage(report_id, "Generating explainability outputs and assembling the report.")
            if guard_fn:
                guard_fn()

            representative_window = inference_result.get("representative_window")
            if representative_window is None:
                # Fallback: extract window at peak probability
                raw_probs = inference_result["raw_probabilities"]
                peak_idx = int(np.argmax(raw_probs))
                if isinstance(analysis_input, np.ndarray) and analysis_input.ndim == 3:
                    representative_window = analysis_input[min(peak_idx, analysis_input.shape[0] - 1)]
                else:
                    representative_window = extract_window_at(analysis_input, peak_idx)

            # Done with the large data array
            quality_samples = inference_result.get("quality_samples")
            del analysis_input
            gc.collect()

            tensor_window = torch.from_numpy(representative_window[None, :, :]).to(device)
            channel_importance = compute_channel_importance(model, tensor_window)
            attention_weights = extract_attention_maps(model, tensor_window)

            # Free explainability intermediaries
            del tensor_window
            gc.collect()

            # --- Stage 4: Report generation ---
            # build_full_report_payload expects `windows` for quality assessment.
            # We provide the sampled quality windows instead of all 7000+ windows.
            report_windows = quality_samples if quality_samples is not None else representative_window[None, :, :]

            report_payload = build_full_report_payload(
                filename=file_name,
                inference_result=inference_result,
                windows=report_windows,
                channel_mask=channel_mask,
                channel_importance=channel_importance,
                attention_weights=attention_weights,
            )

            # Free large intermediaries now that report is built
            del inference_result, report_windows, quality_samples, representative_window
            del channel_importance, attention_weights, channel_mask
            gc.collect()

            # --- Stage 5: PDF generation + upload (non-fatal) ---
            self._set_stage(report_id, "Rendering the NeuroSentinel AI report PDF and finalising results.")
            pdf_bytes: bytes | None = None
            try:
                # Fetch user profile for patient details in PDF
                user_profile = self.supabase_service.fetch_user_profile(user_id)
                pdf_bytes = generate_pdf(report_payload["report_json"], user_profile=user_profile)
                self.supabase_service.upload_report_pdf(user_id=user_id, report_id=report_id, pdf_bytes=pdf_bytes)
            except Exception as pdf_exc:
                logger.warning("PDF generation/upload failed for report %s (non-fatal): %s", report_id, pdf_exc)
                report_payload["report_json"].setdefault("metadata", {})
                if isinstance(report_payload["report_json"]["metadata"], dict):
                    report_payload["report_json"]["metadata"]["pdf_error"] = str(pdf_exc)

            report_payload["report_json"].setdefault("metadata", {})
            if isinstance(report_payload["report_json"]["metadata"], dict):
                report_payload["report_json"]["metadata"]["inference_mode"] = inference_mode

            updates = {
                "status": "completed",
                "error_message": None,
                "report_json": report_payload["report_json"],
                "summary": report_payload["summary_text"],
                "result_label": report_payload["result_label"],
                "event_count": report_payload["event_count"],
                "confidence_score": report_payload["confidence_score"],
                "risk_level": report_payload["risk_level"],
                "quality_grade": report_payload["quality_grade"],
                "duration_minutes": report_payload["duration_minutes"],
            }
            self.supabase_service.update_report(report_id, updates)
            logger.info("Report %s completed using %s inference mode.", report_id, inference_mode)

            # --- Stage 6: Email notification (non-fatal) ---
            self._send_completion_email(user_id, file_name, updates, pdf_bytes)

            # Final cleanup — free PDF bytes and report payload
            del pdf_bytes
            gc.collect()

            return {
                "report_id": report_id,
                "status": "completed",
                "report_json": report_payload["report_json"],
                "summary": report_payload["summary_text"],
            }
        except Exception as exc:  # pragma: no cover - exercised by integration tests with mocks
            logger.exception("Report %s failed during analysis.", report_id)
            self.supabase_service.update_report(report_id, {"status": "failed", "error_message": str(exc), "report_json": {"error": str(exc)}})
            gc.collect()  # Clean up even on failure
            raise
