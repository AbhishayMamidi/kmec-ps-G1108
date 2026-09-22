from __future__ import annotations

import asyncio
import gc
import logging
import os
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

import torch
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.schemas import AnalyzeUrlRequest, ScoutChatRequest
from app.config import Settings, get_settings
from app.pipeline.config import PRODUCTION_METRICS
from app.pipeline.inference import JobAborted
from app.pipeline.model import build_model, download_model_if_needed, parameter_count
from app.services.analysis_service import AnalysisService
from app.services.scout.service import ScoutContext, ScoutService
from app.services.supabase import AuthenticatedUser, SupabaseService

logger = logging.getLogger(__name__)

# ── Hard limits ──────────────────────────────────────────────────────────────
MAX_UPLOAD_BYTES = 1000 * 1024 * 1024     # 1GB file cap (Raw backend spooling)
JOB_TIMEOUT_SECONDS = 3600                  # 1 hour max per job
MEMORY_THRESHOLD_MB = 450                  # Abort job if RSS exceeds this
STALE_JOB_CLEANUP_SECONDS = 300            # Clean up "processing" jobs older than 5 min on startup


# ── Inference Lock ───────────────────────────────────────────────────────────
_inference_lock = threading.Lock()

_current_job: dict[str, Any] = {
    "report_id": None,
    "filename": None,
    "started_at": None,
    "status": "idle",
}
_cancel_requested = threading.Event()


def _get_memory_mb() -> float:
    """Get actual non-reclaimable memory in MB (what causes Render OOM kills).

    memory.current includes page cache (reclaimable) → inflated number.
    memory.stat → anon field = actual anonymous allocations (non-reclaimable).
    This is the REAL metric that determines whether Render will kill us.
    """
    # Priority 1: cgroup v2 memory.stat → anon (BEST metric)
    try:
        with open("/sys/fs/cgroup/memory.stat") as f:
            for line in f:
                if line.startswith("anon "):
                    return int(line.split()[1]) / (1024 * 1024)
    except (FileNotFoundError, OSError, ValueError):
        pass

    # Priority 2: cgroup v1 → usage - cache
    try:
        usage = 0
        cache = 0
        with open("/sys/fs/cgroup/memory/memory.usage_in_bytes") as f:
            usage = int(f.read().strip())
        with open("/sys/fs/cgroup/memory/memory.stat") as f:
            for line in f:
                if line.startswith("cache "):
                    cache = int(line.split()[1])
                    break
        return (usage - cache) / (1024 * 1024)
    except (FileNotFoundError, OSError, ValueError):
        pass

    # Priority 3: psutil fallback (Windows dev)
    try:
        import psutil
        return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)
    except ImportError:
        return -1.0


# Baseline memory after model load — set once, used for delta tracking
_baseline_memory_mb: float = 0.0


def _make_guard_fn(job_start_time: float) -> "Callable[[], None]":
    """Create a guard callback that checks memory, cancel, and timeout.

    Called at EVERY chunk and batch during inference. If any check fails,
    raises JobAborted — which safely aborts the job before Render kills us.
    """
    from typing import Callable  # noqa: F811

    def guard() -> None:
        # 1. CANCEL CHECK — user requested abort
        if _cancel_requested.is_set():
            raise JobAborted("Job cancelled by user")

        # 2. TIMEOUT CHECK — recording too long/complex
        elapsed = time.time() - job_start_time
        if elapsed > JOB_TIMEOUT_SECONDS:
            raise JobAborted(f"Job timeout: exceeded {JOB_TIMEOUT_SECONDS}s")

        # 3. MEMORY LOGGING (informational only — NOT an abort trigger)
        #    PyTorch + model baseline is ~460MB anon. The real protection against
        #    memory blowout is the batch/chunk size caps (max 4 / max 50), not
        #    a hard threshold that false-positives on every request.
        mem = _get_memory_mb()
        if mem > 0 and mem > MEMORY_THRESHOLD_MB:
            gc.collect()
            mem = _get_memory_mb()
            if mem > MEMORY_THRESHOLD_MB:
                logger.warning("Memory high: %.0fMB (threshold %dMB) — continuing with gc", mem, MEMORY_THRESHOLD_MB)

    return guard


# ── Model Singleton ──────────────────────────────────────────────────────────
_model_lock = threading.Lock()
_model_loaded = False


@dataclass
class BackendState:
    settings: Settings
    supabase_service: SupabaseService
    analysis_service: AnalysisService
    scout_service: ScoutService
    model: torch.nn.Module | None = None
    device: torch.device = field(default_factory=lambda: torch.device("cpu"))
    model_error: str | None = None
    model_parameter_count: int = 0


def _load_model(state: BackendState) -> None:
    """Load model weights ONCE. Thread-safe via _model_lock."""
    global _model_loaded, _baseline_memory_mb

    with _model_lock:
        # Double-check: another thread may have loaded while we waited
        if state.model is not None:
            logger.info("Model already loaded (skipping duplicate load)")
            return

        if _model_loaded:
            logger.warning("Model was previously loaded — refusing duplicate load")
            return

        logger.info("Loading model (this should happen EXACTLY ONCE)...")
        model = build_model()

        if state.settings.model_path and state.settings.model_path.exists():
            model_path = str(state.settings.model_path)
        else:
            model_path = download_model_if_needed()

        weights = torch.load(model_path, map_location="cpu", weights_only=True)
        model.load_state_dict(weights)
        del weights
        gc.collect()

        model.to(state.device)
        model.eval()
        state.model = model
        state.model_parameter_count = parameter_count(model)
        state.model_error = None
        _model_loaded = True

        _baseline_memory_mb = _get_memory_mb()
        logger.info(
            "✅ Model loaded ONCE (%d params). Baseline cgroup memory: %.1fMB (threshold: %dMB)",
            state.model_parameter_count, _baseline_memory_mb, MEMORY_THRESHOLD_MB
        )


def _ensure_model(state: BackendState) -> None:
    """Lazy-load model on first request. Fully thread-safe singleton."""
    if state.model is not None:
        return
    if state.model_error:
        raise RuntimeError(f"Model previously failed to load: {state.model_error}")
    try:
        _load_model(state)
    except Exception as exc:
        state.model_error = str(exc)
        logger.exception("Model load failed")
        raise


def _cleanup_stale_jobs(supabase_service: SupabaseService) -> None:
    """On startup, mark any leftover 'processing' jobs as failed.
    This handles the case where the container crashed mid-analysis."""
    try:
        stale = supabase_service.client.table("reports").select("id,filename,status").eq(
            "status", "processing"
        ).execute()
        if stale.data:
            for report in stale.data:
                logger.warning("Cleaning up stale job: %s (%s)", report["id"], report.get("filename"))
                supabase_service.update_report(report["id"], {
                    "status": "failed",
                    "error_message": "Server restarted during processing. Please re-upload your file.",
                    "report_json": {"error": "Server crash recovery — job was interrupted."},
                })
            logger.info("Cleaned up %d stale processing jobs", len(stale.data))
    except Exception as exc:
        logger.warning("Failed to clean up stale jobs (non-fatal): %s", exc)


# ── Background analysis runner ──────────────────────────────────────────────

def _run_analysis_sync(
    state: BackendState,
    user_id: str,
    file_name: str,
    edf_path: str,
    report_id: str,
) -> None:
    """Run analysis synchronously, holding the inference lock.
    Handles all cleanup on success, failure, and cancellation."""
    global _current_job

    acquired = _inference_lock.acquire(blocking=False)
    if not acquired:
        # Another job is running — mark this one as failed immediately
        logger.warning("Inference lock busy — rejecting job %s", report_id)
        state.analysis_service.supabase_service.update_report(report_id, {
            "status": "failed",
            "error_message": "Another analysis is already running. Please wait and try again.",
        })
        return

    try:
        _current_job = {
            "report_id": report_id,
            "filename": file_name,
            "started_at": time.time(),
            "status": "running",
        }
        _cancel_requested.clear()

        mem = _get_memory_mb()
        logger.info("Starting analysis for %s (report=%s, RSS=%.1fMB)", file_name, report_id, mem)

        # Create guard function — checks memory/cancel/timeout at every chunk
        guard_fn = _make_guard_fn(time.time())

        state.analysis_service.run_analysis_upload_for_report(
            model=state.model,
            device=state.device,
            user_id=user_id,
            file_name=file_name,
            edf_path=edf_path,
            report_id=report_id,
            batch_size=state.settings.analysis_batch_size,
            guard_fn=guard_fn,
        )

        mem = _get_memory_mb()
        logger.info("✅ Analysis completed for %s (RSS=%.1fMB)", file_name, mem)

    except Exception as exc:
        logger.exception("Analysis failed for report %s", report_id)
        
        # Determine error message
        error_msg = str(exc)
        is_timeout = "timeout" in error_msg.lower()
        
        try:
            state.analysis_service.supabase_service.update_report(report_id, {
                "status": "failed",
                "error_message": error_msg[:500],
                "report_json": {"error": error_msg[:500]},
            })
            
            # If it was a timeout, send a specific email notification
            if is_timeout:
                state.analysis_service.send_timeout_notification(user_id, file_name)
            else:
                # Check if it was a manual abort
                from app.pipeline.inference import JobAborted
                if isinstance(exc, JobAborted) or "cancelled" in error_msg.lower():
                    state.analysis_service.send_aborted_notification(user_id, file_name)
                else:
                    state.analysis_service.send_failure_notification(user_id, file_name, error_msg=error_msg)
                
        except Exception as internal_err:
            logger.error("Failed to update report status or send email for %s: %s", report_id, internal_err)

    finally:
        # Always clean up — no matter what
        if edf_path and os.path.exists(edf_path):
            try:
                os.remove(edf_path)
            except OSError:
                pass

        _current_job = {
            "report_id": None,
            "filename": None,
            "started_at": None,
            "status": "idle",
        }
        _cancel_requested.clear()

        # Force memory cleanup
        gc.collect()
        _inference_lock.release()

        mem = _get_memory_mb()
        logger.info("Job finished. Lock released. RSS=%.1fMB", mem)


# ── App Factory ──────────────────────────────────────────────────────────────

def create_app(settings: Settings | None = None, load_model_on_startup: bool = False) -> FastAPI:
    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        supabase_service = SupabaseService(resolved_settings)
        app_state = BackendState(
            settings=resolved_settings,
            supabase_service=supabase_service,
            analysis_service=AnalysisService(supabase_service, settings=resolved_settings),
            scout_service=ScoutService(resolved_settings, supabase_service),
        )
        app.state.backend = app_state

        # Clean up any jobs left in "processing" from a previous crash
        _cleanup_stale_jobs(supabase_service)

        if load_model_on_startup:
            try:
                _load_model(app_state)
            except Exception as exc:  # pragma: no cover
                app_state.model_error = str(exc)

        logger.info("NeuroSentinel backend started (model loads on first request)")
        yield

    app = FastAPI(title="NeuroSentinel Backend", lifespan=lifespan)

    # CORS — only allow the known frontend origins
    from fastapi.middleware.cors import CORSMiddleware
    _allowed_origins = [
        o.strip()
        for o in (resolved_settings.app_url + "," + os.environ.get("EXTRA_CORS_ORIGINS", "")).split(",")
        if o.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    security = HTTPBearer(auto_error=False)

    def get_backend_state(request: Request) -> BackendState:
        return request.app.state.backend

    def get_authenticated_user(
        credentials: HTTPAuthorizationCredentials | None = Depends(security),
        state: BackendState = Depends(get_backend_state),
    ) -> AuthenticatedUser:
        if credentials is None or not credentials.credentials:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")
        try:
            return state.supabase_service.verify_access_token(credentials.credentials)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid session: {exc}") from exc

    # ── Health ───────────────────────────────────────────────────────────
    @app.get("/health")
    async def health(state: BackendState = Depends(get_backend_state)) -> dict[str, Any]:
        mem = _get_memory_mb()
        return {
            "service": "ok",
            "model_ready": state.model is not None,
            "model_error": state.model_error,
            "memory_mb": round(mem, 1),
            "inference_busy": _current_job["status"] == "running",
            "current_job": _current_job.get("report_id"),
        }

    # ── Config Diagnostics (no auth, no secret values exposed) ───────────
    @app.get("/api/v1/debug/config")
    async def debug_config(state: BackendState = Depends(get_backend_state)) -> dict[str, Any]:
        """Shows which env vars are set (True/False only). Safe to call publicly."""
        s = state.settings
        return {
            "email": {
                "resend_api_key":    bool(s.resend_api_key),
                "resend_from_email": s.resend_from_email or None,
                "smtp_host":         s.smtp_host or None,
                "smtp_port":         s.smtp_port,
                "smtp_user":         bool(s.smtp_user),
                "smtp_password":     bool(s.smtp_password),
                "smtp_from_email":   s.smtp_from_email or None,
            },
            "auth": {
                "internal_api_secret": bool(s.internal_api_secret),
            },
            "inference": {
                "model_path_set": bool(s.model_path),
            },
        }

    @app.get("/api/v1/model/info")
    async def model_info(state: BackendState = Depends(get_backend_state)) -> dict[str, Any]:
        return {
            "version": PRODUCTION_METRICS["version"],
            "ready": state.model is not None,
            "parameter_count": state.model_parameter_count,
            "declared_metrics": PRODUCTION_METRICS,
            "error": state.model_error,
        }

    # ── Job Status ───────────────────────────────────────────────────────
    @app.get("/api/v1/job/status")
    async def job_status() -> dict[str, Any]:
        """Check if the backend is busy with a job."""
        elapsed = None
        if _current_job["started_at"]:
            elapsed = round(time.time() - _current_job["started_at"], 1)
        return {
            "status": _current_job["status"],
            "report_id": _current_job.get("report_id"),
            "filename": _current_job.get("filename"),
            "elapsed_seconds": elapsed,
            "memory_mb": round(_get_memory_mb(), 1),
        }

    # ── OTP Email Relay ──────────────────────────────────────────────────────
    # Called by Vercel's signup-otp-store.ts to send OTP emails.
    # Uses the EXACT same email sending code as report notifications,
    # so if reports work, OTP works too.
    @app.post("/api/v1/internal/send-otp-email")
    async def send_otp_email(
        request: Request,
        state: BackendState = Depends(get_backend_state),
    ) -> dict[str, Any]:
        # Validate internal secret — no user auth token here (called server-side)
        secret_header = request.headers.get("X-Internal-Secret", "")
        if secret_header != state.settings.internal_api_secret:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal secret.")

        body = await request.json()
        to_email: str | None = body.get("to")
        subject: str | None = body.get("subject")
        html: str | None = body.get("html")
        text: str | None = body.get("text", "")

        if not to_email or not subject or not html:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing required fields: to, subject, html.")

        # Use the SAME email function that successfully sends report emails.
        from app.services.email import _send_generic_notification

        sent = _send_generic_notification(
            to_email=to_email,
            subject=subject,
            html=html,
            resend_api_key=state.settings.resend_api_key,
            resend_from_email=state.settings.resend_from_email,
            smtp_host=state.settings.smtp_host,
            smtp_port=state.settings.smtp_port,
            smtp_user=state.settings.smtp_user,
            smtp_password=state.settings.smtp_password,
            smtp_from_email=state.settings.smtp_from_email,
            relay_api_url=None,  # Don't relay to ourselves
            internal_api_secret=state.settings.internal_api_secret,
        )

        if not sent:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Email sending failed. Check SMTP_* or RESEND_API_KEY configuration.",
            )

        return {"status": "sent", "to": to_email}

    # ── Debug Email ──────────────────────────────────────────────────────────
    @app.get("/api/v1/debug/email")
    async def debug_email(
        email: str,
        user: AuthenticatedUser = Depends(get_authenticated_user),
        state: BackendState = Depends(get_backend_state),
    ) -> dict[str, Any]:
        """Send a test email to verify SMTP configuration."""
        if not state.settings.smtp_host:
            return {"status": "error", "message": "SMTP_HOST is not configured."}
        
        try:
            from app.services.email import send_report_notification
            test_report = {
                "result_label": "TEST - NO SEIZURE",
                "risk_level": "Low",
                "event_count": 0,
                "confidence_score": 99.9,
                "quality_grade": "Excellent",
            }
            
            sent, err = send_report_notification(
                to_email=email,
                report=test_report,
                filename="test_connection.edf",
                role="clinician",
                pdf_bytes=None,
                smtp_host=state.settings.smtp_host,
                smtp_port=state.settings.smtp_port,
                smtp_user=state.settings.smtp_user,
                smtp_password=state.settings.smtp_password,
                smtp_from_email=state.settings.smtp_from_email,
                relay_api_url=state.settings.relay_api_url,
                internal_api_secret=state.settings.internal_api_secret,
            )
            
            if sent:
                return {
                    "status": "success", 
                    "message": f"Test email sent to {email}. Check your inbox and 'Sent' folder.",
                    "config": {
                        "host": state.settings.smtp_host,
                        "port": state.settings.smtp_port,
                        "user": state.settings.smtp_user,
                        "from": state.settings.smtp_from_email
                    }
                }
            else:
                return {
                    "status": "failed", 
                    "message": f"SMTP sending failed: {err}",
                    "details": "Check your SMTP_USER and SMTP_PASSWORD (if using Gmail, ensure it's a 16-character App Password)."
                }
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ── Cancel Job ───────────────────────────────────────────────────────────
    @app.post("/api/v1/job/cancel")
    async def cancel_job(
        user: AuthenticatedUser = Depends(get_authenticated_user),
        state: BackendState = Depends(get_backend_state),
    ) -> dict[str, Any]:
        """Cancel the current running job and release the system."""
        if _current_job["status"] != "running":
            return {"status": "no_job_running"}

        report_id = _current_job.get("report_id")
        _cancel_requested.set()

        # Mark the job as failed in DB
        if report_id:
            try:
                state.analysis_service.supabase_service.update_report(report_id, {
                    "status": "failed",
                    "error_message": "Analysis was cancelled by the user.",
                    "report_json": {"error": "Cancelled"},
                })
            except Exception:
                pass

        # Force garbage collection
        gc.collect()

        return {
            "status": "cancel_requested",
            "report_id": report_id,
            "note": "The current job will terminate shortly. You can upload a new file.",
        }

    # ── Analyze (direct upload) ──────────────────────────────────────────
    @app.post("/api/v1/analyze")
    async def analyze(
        file: UploadFile = File(...),
        user: AuthenticatedUser = Depends(get_authenticated_user),
        state: BackendState = Depends(get_backend_state),
    ) -> dict[str, Any]:
        # Check if system is busy
        if _current_job["status"] == "running":
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Another analysis is already running. Please wait for it to complete.",
            )

        # Lazy-load model
        try:
            _ensure_model(state)
        except Exception:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Model is not ready: {state.model_error or 'unknown error'}")

        if not file.filename or not file.filename.lower().endswith(".edf"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .edf files are supported.")

        file_name = file.filename

        # Stream upload to disk — never buffer in RAM
        temp_path: str | None = None
        total_written = 0
        with tempfile.NamedTemporaryFile(delete=False, suffix=".edf") as handle:
            temp_path = handle.name
            while True:
                chunk = await file.read(8192)
                if not chunk:
                    break
                total_written += len(chunk)
                if total_written > MAX_UPLOAD_BYTES:
                    handle.close()
                    os.remove(temp_path)
                    await file.close()
                    
                    # Send size exceeded email (non-blocking)
                    try:
                        limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
                        state.analysis_service.send_size_exceeded_notification(user.id, file_name, limit_mb)
                    except Exception:
                        pass
                        
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"File exceeds {MAX_UPLOAD_BYTES // (1024*1024)}MB limit.")
                handle.write(chunk)
        await file.close()

        # Create report record
        report_id = str(uuid4())
        state.analysis_service.supabase_service.insert_report({
            "id": report_id,
            "user_id": user.id,
            "filename": file_name,
            "storage_path": None,
            "status": "processing",
            "error_message": None,
            "summary": "Your EEG file has been received. Analysis is running in the background — you can safely close this page.",
            "report_json": None,
        })

        # Run in background thread (not asyncio task — avoids event loop issues)
        thread = threading.Thread(
            target=_run_analysis_sync,
            args=(state, user.id, file_name, temp_path, report_id),
            daemon=True,
        )
        thread.start()

        return {
            "report_id": report_id,
            "status": "processing",
            "summary": "Your EEG file has been received. Analysis is running in the background — you can safely close this page.",
        }

    # ── Analyze URL (Supabase Storage) ───────────────────────────────────
    @app.post("/api/v1/analyze-url")
    async def analyze_url(
        payload: AnalyzeUrlRequest,
        user: AuthenticatedUser = Depends(get_authenticated_user),
        state: BackendState = Depends(get_backend_state),
    ) -> dict[str, Any]:
        """Accept a Supabase Storage URL and run analysis."""
        # Check if system is busy
        if _current_job["status"] == "running":
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Another analysis is already running. Please wait for it to complete.",
            )

        # Lazy-load model
        try:
            _ensure_model(state)
        except Exception:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Model is not ready: {state.model_error or 'unknown error'}")

        file_url = payload.file_url
        file_name = payload.filename

        if not file_name.lower().endswith(".edf"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .edf files are supported.")

        # Stream download to disk
        import httpx as _httpx

        temp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".edf") as handle:
                temp_path = handle.name
                total_written = 0
                async with _httpx.AsyncClient(timeout=300) as client:
                    async with client.stream("GET", file_url) as dl_response:
                        dl_response.raise_for_status()
                        async for chunk in dl_response.aiter_bytes(chunk_size=8192):
                            total_written += len(chunk)
                            if total_written > MAX_UPLOAD_BYTES:
                                raise ValueError(f"File exceeds {MAX_UPLOAD_BYTES // (1024*1024)}MB limit")
                            handle.write(chunk)
        except Exception as dl_exc:
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to download file from storage: {dl_exc}",
            )

        # Create report record
        report_id = str(uuid4())
        state.analysis_service.supabase_service.insert_report({
            "id": report_id,
            "user_id": user.id,
            "filename": file_name,
            "storage_path": file_url,
            "status": "processing",
            "error_message": None,
            "summary": "Your EEG file has been received. Analysis is running in the background — you can safely close this page.",
            "report_json": None,
        })

        # Run in background thread
        thread = threading.Thread(
            target=_run_analysis_sync,
            args=(state, user.id, file_name, temp_path, report_id),
            daemon=True,
        )
        thread.start()

        return {
            "report_id": report_id,
            "status": "processing",
            "summary": "Your EEG file has been received. Analysis is running in the background — you can safely close this page.",
        }

    # ── SCOUT Chat ───────────────────────────────────────────────────────
    @app.post("/api/v1/scout/chat")
    async def scout_chat(
        payload: ScoutChatRequest,
        user: AuthenticatedUser = Depends(get_authenticated_user),
        state: BackendState = Depends(get_backend_state),
    ) -> dict[str, Any]:
        response = await state.scout_service.chat(
            ScoutContext(
                user_id=user.id,
                message=payload.message,
                page=payload.context.page,
                role=payload.context.role,
                report_id=payload.context.report_id,
                current_report=payload.context.current_report,
                page_data=payload.context.page_data,
                session_history=[{"role": h.role, "content": h.content} for h in payload.history],
            )
        )
        return response

    return app


app = create_app()
