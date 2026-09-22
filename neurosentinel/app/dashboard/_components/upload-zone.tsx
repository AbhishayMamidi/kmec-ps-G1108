'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { normalizeReport, normalizeReportStatus, type ReportRecord } from '@/lib/neurosentinel/types'
import { useReportNotification } from '@/app/components/report-notification-provider'

type State =
  | { s: 'idle' }
  | { s: 'drag' }
  | { s: 'ready'; file: File }
  | { s: 'uploading'; file: File; msg: string }
  | { s: 'processing'; file: File; msg: string; reportId: string }
  | { s: 'complete'; file: File; reportId: string; msg: string }
  | { s: 'error'; file: File | null; msg: string }

const MAX_FILE_SIZE_MB = 1000
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`

export type UploadState = 'idle' | 'drag' | 'ready' | 'uploading' | 'processing' | 'complete' | 'error'

import { useAnalysis, type CurrentAnalysis } from '@/lib/context/analysis-context'

export function UploadZone({
  onAnalysisComplete,
  onReset,
  onUploadStateChange,
  shouldAutoRedirect = false,
}: {
  onAnalysisComplete: (data: ReportRecord) => void
  onReset: () => void
  onUploadStateChange?: (state: UploadState, filename?: string) => void
  shouldAutoRedirect?: boolean
}) {
  const { currentAnalysis, setCurrentAnalysis, abortAnalysis: globalAbort, registerAbortHandler } = useAnalysis()
  const [state, setState] = useState<State>({ s: 'idle' })
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCount = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentJobIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const stateRef = useRef<State>({ s: 'idle' })
  const cancelledByUserRef = useRef(false)
  const router = useRouter()
  const { showNotification, dismissNotification, updateNotification } = useReportNotification()

  const updateState = useCallback((newState: State) => {
    stateRef.current = newState
    setState(newState)
    onUploadStateChange?.(newState.s, 'file' in newState ? (newState as any).file?.name : undefined)
  }, [onUploadStateChange])

  const isValid = (file: File) => /\.edf$/i.test(file.name)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const resetUploadState = useCallback(() => {
    stopPolling()
    onReset()
    setUploadProgress(null)
    updateState({ s: 'idle' })
    setCurrentAnalysis(null)
    registerAbortHandler(null)
  }, [onReset, registerAbortHandler, setCurrentAnalysis, stopPolling, updateState])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false
      stopPolling()
    }
  }, [stopPolling])



  const pickFile = useCallback(
    (file: File) => {
      resetUploadState()
      if (!isValid(file)) {
        updateState({ s: 'error', file: null, msg: 'Only .edf files are supported.' })
        return
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        updateState({ s: 'error', file: null, msg: `File must be less than ${MAX_FILE_SIZE_MB} MB. Your file is ${formatSize(file.size)}.` })
        return
      }
      updateState({ s: 'ready', file })
    },
    [resetUploadState, updateState]
  )

  const reset = () => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    cancelledByUserRef.current = false
    void globalAbort()
    resetUploadState()
    if (inputRef.current) inputRef.current.value = ''
  }

  const cancelUpload = useCallback(async () => {
    cancelledByUserRef.current = true

    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }

    const activeState = stateRef.current

    // Call the backend cancellation API if we are in the processing state.
    if (activeState.s === 'processing' && activeState.reportId) {
      const response = await fetch('/api/cancel', { method: 'POST' })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Failed to cancel analysis.')
      }
    }

    stopPolling()
    setUploadProgress(null)
    if (mountedRef.current) {
      updateState({ s: 'idle' })
    }
    setCurrentAnalysis(null)
    registerAbortHandler(null)

    if (currentJobIdRef.current) {
      updateNotification(currentJobIdRef.current, {
        status: 'aborted',
        reportId: activeState.s === 'processing' ? activeState.reportId : undefined,
        hasNotified: true,
      })
    }

    if (inputRef.current) inputRef.current.value = ''
  }, [registerAbortHandler, setCurrentAnalysis, stopPolling, updateNotification, updateState])

  /** Start polling supabase for report completion after backend returns processing */
  const startCompletionPolling = useCallback((reportId: string, file: File) => {
    stopPolling()
    const supabase = createClient()

    pollRef.current = setInterval(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: report } = await supabase
          .from('reports')
          .select('id, user_id, filename, status, summary, result_label, event_count, confidence_score, risk_level, quality_grade, duration_minutes, report_json, created_at, error_message')
          .eq('id', reportId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (!report) return

        const status = normalizeReportStatus(report.status)
        const jobId = currentJobIdRef.current || reportId

        if (status === 'completed') {
          stopPolling()
          const normalized = normalizeReport(report)
          if (mountedRef.current) {
            onAnalysisComplete(normalized)
          }
          setUploadProgress(null)
          registerAbortHandler(null)

          // Check if user is on dashboard
          const onDashboard = window.location.pathname.startsWith('/dashboard') && !window.location.pathname.includes('/eeg-reports') && !window.location.pathname.includes('/settings')

          if (shouldAutoRedirect && onDashboard) {
            // Auto-redirect to report page — dismiss toast if we know its jobId, else dismiss all matching
            dismissNotification(jobId)
            router.push(`/report/${normalized.id}`)
          } else {
            // Show "Report Ready" notification on other pages
            showNotification({
              jobId, // Use the original jobId to update the existing notification
              reportId: normalized.id,
              filename: file.name,
              status: 'completed',
              timestamp: Date.now(),
            })
            updateState({ s: 'complete', file, reportId: normalized.id, msg: normalized.summary || 'Your report is ready.' })
          }
        } else if (status === 'failed') {
          stopPolling()
          registerAbortHandler(null)
          if (mountedRef.current) {
            updateState({ s: 'error', file, msg: report.error_message || 'Analysis failed.' })
          }
        }
        // else still processing — keep polling
      } catch (err) {
        console.error('[UploadZone] Polling error:', err)
      }
    }, 4000)
  }, [dismissNotification, onAnalysisComplete, registerAbortHandler, router, shouldAutoRedirect, showNotification, stopPolling, updateState])

  // Sync state with global currentAnalysis to persist UI across navigation
  useEffect(() => {
    if (!currentAnalysis) return

    const s = stateRef.current.s
    const file = ('file' in stateRef.current && stateRef.current.file) ? stateRef.current.file : new File([], currentAnalysis.filename)

    if (currentAnalysis.stage === 'aborted') {
      updateState({ s: 'idle' })
      setUploadProgress(null)
      stopPolling()
      return
    }

    if (s === 'idle' || s === 'drag' || s === 'ready') {
      if (currentAnalysis.stage === 'processing' || currentAnalysis.stage === 'queued' || currentAnalysis.stage === 'upload_complete') {
        updateState({
          s: 'processing',
          file,
          msg: 'Analysis is running in the background.',
          reportId: currentAnalysis.reportId ?? currentAnalysis.id
        } as State)
        currentJobIdRef.current = currentAnalysis.reportId ?? currentAnalysis.id
        startCompletionPolling(currentAnalysis.reportId ?? currentAnalysis.id, file)
      } else if (currentAnalysis.stage === 'uploading') {

        updateState({
          s: 'uploading',
          file,
          msg: 'Uploading EDF to secure storage...',
        } as State)
        currentJobIdRef.current = currentAnalysis.id
        setUploadProgress(currentAnalysis.uploadProgress || 0)
      }
    } else if (s === 'uploading') {
      if (currentAnalysis.stage === 'processing' || currentAnalysis.stage === 'upload_complete' || currentAnalysis.stage === 'queued') {
        updateState({
          s: 'processing',
          file,
          msg: 'Analysis is running in the background.',
          reportId: currentAnalysis.reportId ?? currentAnalysis.id
        } as State)
        startCompletionPolling(currentAnalysis.reportId ?? currentAnalysis.id, file)
      } else if (currentAnalysis.stage === 'uploading') {
        setUploadProgress(currentAnalysis.uploadProgress || 0)
      }
    }
  }, [currentAnalysis, startCompletionPolling, updateState, stopPolling])

  /**
   * Listen for the custom 'submit-upload' event dispatched by the Retry button.
   * This lets the retry logic set state→ready and then trigger analyse() safely.
   */
  useEffect(() => {
    const handler = () => { void analyse() }
    document.addEventListener('submit-upload', handler)
    return () => document.removeEventListener('submit-upload', handler)
  // analyse dep is intentionally omitted here to avoid loop — it reads state via closure
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * DIRECT BACKEND UPLOAD ARCHITECTURE (Unlimited 1GB Bypassing Supabase)
   *   1. Fetch the HF backend URL from our secure proxy route.
   *   2. Upload the raw EDF file via multipart/form-data directly to FastAPI.
   */
  const analyse = async () => {
    if (state.s !== 'ready') return
    const file = state.file


    cancelledByUserRef.current = false
    updateState({ s: 'uploading', file, msg: 'Connecting to NeuroSentinel AI backend...' })
    setUploadProgress(0)

    const jobId = crypto.randomUUID()
    currentJobIdRef.current = jobId

    const startTime = Date.now()

    // Show notification immediately so it persists cross-page even if user navigates away
    showNotification({
      jobId,
      reportId: '',
      filename: file.name,
      status: 'uploading',
      timestamp: startTime,
      startTime: startTime,
    })

    setCurrentAnalysis({
      id: jobId,
      filename: file.name,
      stage: 'uploading',
      uploadProgress: 0,
      startedAt: new Date().toISOString()
    })
    registerAbortHandler(cancelUpload)

    try {
      const supabase = createClient()
      const { data: { session: sess } } = await supabase.auth.getSession()
      
      if (!sess) {
        throw new Error('You must be signed in to upload files.')
      }

      // ── Step 1: Securely get the backend URL ──
      const urlRes = await fetch('/api/backend-url')
      const urlData = await urlRes.json()
      if (!urlRes.ok || !urlData.url) {
        throw new Error('Backend URL is not configured. Please check deployment settings.')
      }
      const backendUrl = urlData.url

      // ── Step 2: Upload file directly to Hugging Face FastAPI backend ──
      updateState({ s: 'uploading', file, msg: 'Streaming file directly to AI server...' })
      
      const abortController = new AbortController()
      abortRef.current = abortController

      const result = await new Promise<{ report_id: string, status?: string, report_json?: unknown, summary?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          const percent = Math.round((event.loaded / event.total) * 100)
          setUploadProgress(percent)
          setCurrentAnalysis((prev: CurrentAnalysis) => prev ? { ...prev, uploadProgress: percent } : null)
          if (percent === 100) {
            updateState({ s: 'uploading', file, msg: 'Upload complete. Starting analysis...' })
            setCurrentAnalysis((prev: CurrentAnalysis) => prev ? { ...prev, stage: 'upload_complete', uploadProgress: 100 } : null)
          }
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const res = JSON.parse(xhr.responseText)
              resolve(res)
            } catch {
              resolve({ report_id: jobId, status: 'processing', summary: 'Analysis started.' }) // Fallback
            }
          } else {
            let errMsg = `Server rejected file (${xhr.status})`
            try {
              const payload = JSON.parse(xhr.responseText)
              errMsg = payload?.detail || payload?.error || payload?.message || errMsg
            } catch {}
            reject(new Error(errMsg))
          }
        }

        xhr.onerror = () => reject(new Error('Network error during file upload. Please check your connection.'))
        xhr.onabort = () => reject(new Error('Upload was cancelled.'))
        xhr.ontimeout = () => reject(new Error('Upload timed out. File incredibly large or connection slow.'))

        // 60 minutes for up to 1GB files
        xhr.timeout = 3_600_000 
        xhr.open('POST', `${backendUrl}/api/v1/analyze`)
        
        // FastAPI needs the Supabase Bearer token
        xhr.setRequestHeader('Authorization', `Bearer ${sess.access_token}`)
        
        // Note: DO NOT set Content-Type header. The browser automatically sets it to multipart/form-data with the correct boundary!
        const formData = new FormData()
        formData.append('file', file)
        
        xhr.send(formData)

        // Wire up abort handler
        abortController.signal.addEventListener('abort', () => xhr.abort())
      })

      const reportId = result.report_id
      const reportStatus = result.status || 'processing'

      if (reportStatus === 'completed') {
        // Synchronous path (legacy) — backend returned completed immediately
        const normalized = normalizeReport({
          id: reportId,
          filename: file.name,
          status: 'completed',
          storage_path: null,
          created_at: new Date().toISOString(),
          summary: result.summary || 'Your EEG report is ready to review.',
          report_json: result.report_json ?? null,
        })
        onAnalysisComplete(normalized)
        setUploadProgress(null)
        setCurrentAnalysis(null)
        registerAbortHandler(null)

        const onDashboard = window.location.pathname.startsWith('/dashboard') && !window.location.pathname.includes('/eeg-reports') && !window.location.pathname.includes('/settings')
        if (shouldAutoRedirect && onDashboard) {
          dismissNotification(jobId)
          router.push(`/report/${normalized.id}`)
        } else {
          showNotification({
            jobId,
            reportId: normalized.id,
            filename: file.name,
            status: 'completed',
            timestamp: Date.now(),
          })
        }
      } else {
        // Async path — backend is processing in background
        const normalized = normalizeReport({
          id: reportId,
          filename: file.name,
          status: 'processing',
          storage_path: null,
          created_at: new Date().toISOString(),
          summary: result.summary || 'Your EEG is being analysed in the background.',
          report_json: null,
        })
        if (mountedRef.current) {
          onAnalysisComplete(normalized)
          setUploadProgress(null)
          updateState({ s: 'processing', file, msg: 'Your EEG is being analysed. You can safely close this page — we\'ll email you the report when it\'s ready.', reportId })
        }

        setCurrentAnalysis({
          id: reportId,
          filename: file.name,
          stage: 'processing',
          uploadProgress: 100,
          startedAt: new Date().toISOString(),
          reportId,
        })

        // Show processing notification
        showNotification({
          jobId,
          reportId,
          filename: file.name,
          status: 'processing',
          timestamp: Date.now(),
        })

        // Start polling to detect completion
        if (mountedRef.current) {
          startCompletionPolling(reportId, file)
        }
      }
    } catch (analysisError: any) {
      console.error('[UploadZone] Analysis error:', analysisError)
      setUploadProgress(null)

      if (cancelledByUserRef.current || /cancel|abort/i.test(String(analysisError?.message || ''))) {
        cancelledByUserRef.current = false
        registerAbortHandler(null)
        return
      }

      // The backend may have created the report but crashed.
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data: latestReport } = await supabase
            .from('reports')
            .select('id, filename, status, summary, result_label, event_count, confidence_score, risk_level, quality_grade, duration_minutes, report_json, created_at')
            .eq('user_id', user.id)
            .eq('filename', file.name)
            .gt('created_at', new Date(startTime).toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (latestReport && (latestReport.status === 'completed' || latestReport.status === 'processing')) {
            const normalized = normalizeReport(latestReport)
            if (mountedRef.current) {
              onAnalysisComplete(normalized)
            }
            if (latestReport.status === 'processing') {
              if (mountedRef.current) {
                updateState({ s: 'processing', file, msg: 'Analysis is running in the background.', reportId: normalized.id })
              }
              startCompletionPolling(normalized.id, file)
            } else {
              registerAbortHandler(null)
              showNotification({
                jobId: currentJobIdRef.current || 'fallback-id',
                reportId: normalized.id,
                filename: file.name,
                status: 'completed',
                timestamp: Date.now(),
              })
            }
            return
          }
        }
      } catch {}

      registerAbortHandler(null)
      if (mountedRef.current) {
        updateState({ s: 'error', file, msg: analysisError.message || 'Analysis failed before the report could be generated.' })
      }
    }
  }

  const displayProgress = currentAnalysis?.uploadProgress ?? uploadProgress
  const dragging = state.s === 'drag'

  return (
    <section>
      <div
        id="upload-drop-zone"
        className={`clinical-upload-zone ${dragging ? 'dragging' : ''}`}
        style={{
          cursor: state.s === 'idle' || state.s === 'drag' ? 'pointer' : 'default',
        }}
        onDragEnter={(event) => {
          event.preventDefault()
          dragCount.current += 1
          setState({ s: 'drag' })
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          dragCount.current -= 1
          if (dragCount.current <= 0) setState({ s: 'idle' })
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          dragCount.current = 0
          const file = event.dataTransfer.files[0]
          if (file) pickFile(file)
          else setState({ s: 'idle' })
        }}
        onClick={() => {
          if (state.s === 'idle' || state.s === 'drag') inputRef.current?.click()
        }}
      >
        <input
          ref={inputRef}
          id="file-input"
          type="file"
          accept=".edf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) pickFile(file)
          }}
        />

        {/* ── Idle / Drag State ── */}
        {(state.s === 'idle' || state.s === 'drag') && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="clinical-upload-icon">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <h3 className="mt-5 text-xl font-semibold" style={{ color: dragging ? 'var(--accent-primary)' : 'var(--text-heading)' }}>
              {dragging ? 'Release your EDF file here' : 'Drop your EDF file here'}
            </h3>
            <p className="mt-2 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
              or click to browse
            </p>
            <div className="mt-5 flex flex-col items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              <div className="flex items-center gap-2">
                <span className="clinical-file-tag">.edf</span>
                <span className="font-medium text-[#10B981]">Max file size: {MAX_FILE_SIZE_MB} MB</span>
              </div>
              <div>Recommended: 20–60 minutes of EEG data for better confidence.</div>
            </div>
          </div>
        )}

        {/* ── Ready State ── */}
        {state.s === 'ready' && (
          <div className="flex h-full flex-col justify-between gap-8">
            <div>
              <div className="clinical-section-label" style={{ color: 'var(--accent-primary)' }}>
                Ready to analyse
              </div>
              <div className="mt-3 text-xl font-semibold" style={{ color: 'var(--text-heading)' }}>
                {state.file.name}
              </div>
              <div className="mt-2 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                {formatSize(state.file.size)} · EDF recording detected
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  reset()
                }}
                className="clinical-btn-secondary"
              >
                Choose another file
              </button>
              <button
                id="btn-analyse"
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  void analyse()
                }}
                className="clinical-btn-primary"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                Start Analysis
              </button>
            </div>
          </div>
        )}

        {/* ── Uploading / Processing State ── */}
        {(state.s === 'uploading' || state.s === 'processing') && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="clinical-spinner" />
            <div className="mt-5 text-lg font-semibold" style={{ color: 'var(--text-heading)' }}>
              {state.s === 'processing' ? 'Analysing your EEG report' : 'Uploading your EEG file'}
            </div>
            <div className="mt-2 max-w-md text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {state.msg}
            </div>

            {displayProgress !== null ? (
              <div className="mt-5 w-full max-w-md px-2">
                <div className="mb-2 flex justify-between text-[12px]" style={{ color: 'var(--text-muted)' }}>
                  <span>{state.s === 'processing' ? 'Upload complete — analysing in background' : 'Uploading EDF to secure storage...'}</span>
                  <span className="font-medium" style={{ color: 'var(--accent-primary)' }}>{displayProgress}%</span>
                </div>
                <div className="clinical-progress-track">
                  <div className="clinical-progress-fill" style={{ width: `${displayProgress}%` }} />
                </div>
              </div>
            ) : state.s === 'processing' ? (
              <div className="mt-5 w-full max-w-md px-2">
                <div className="clinical-progress-track">
                  <div className="clinical-progress-indeterminate" />
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                void globalAbort()
              }}
              className="clinical-btn-danger-outline mt-5"
            >
              {state.s === 'uploading' ? 'Cancel Upload' : 'Abort Analysis'}
            </button>
          </div>
        )}

        {/* ── Complete State ── */}
        {state.s === 'complete' && (
          <div className="flex h-full flex-col justify-between gap-8">
            <div>
              <div className="clinical-section-label" style={{ color: 'var(--accent-success)' }}>
                Report ready
              </div>
              <div className="mt-3 text-xl font-semibold" style={{ color: 'var(--text-heading)' }}>
                {state.file.name}
              </div>
              <div className="mt-2 text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {state.msg}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  router.push(`/report/${state.reportId}`)
                }}
                className="clinical-btn-primary"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                View Report
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  reset()
                }}
                className="clinical-btn-secondary"
              >
                Upload another EDF
              </button>
            </div>
          </div>
        )}

        {/* ── Error / Failure Recovery State ── */}
        {state.s === 'error' && (
          <div className="flex h-full flex-col items-center justify-center text-center px-4 py-2 gap-0">
            {/* Icon */}
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full mb-4"
              style={{ background: 'var(--accent-danger-light)', border: '1px solid rgba(220,38,38,0.15)' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>

            {/* Title */}
            <div className="text-[16px] font-bold" style={{ color: 'var(--accent-danger)' }}>
              Upload failed
            </div>

            {/* Error message */}
            <div
              className="mt-2 max-w-sm text-[13px] leading-relaxed rounded-lg px-3 py-2 font-mono"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' }}
            >
              {state.msg}
            </div>

            {/* Guidance */}
            <p className="mt-3 text-[12px] max-w-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Check that your EEF file is valid, under {MAX_FILE_SIZE_MB} MB, and that your network connection is stable.
            </p>

            {/* Action buttons */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {/* Primary: retry with same file */}
              {state.file && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const file = state.file as File
                    // Set state to 'ready' with the same file, then submit
                    resetUploadState()
                    updateState({ s: 'ready', file })
                    // Small delay so state flush completes before submit
                    window.setTimeout(() => {
                      const submitEvent = new Event('submit-upload', { bubbles: true })
                      document.dispatchEvent(submitEvent)
                    }, 50)
                  }}
                  className="clinical-btn-primary"
                  style={{ height: 38, padding: '0 20px', fontSize: 13 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, display: 'inline' }}>
                    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
                  </svg>
                  Retry same file
                </button>
              )}


              {/* Secondary: choose a different file */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  reset()
                  if (inputRef.current) inputRef.current.value = ''
                  window.setTimeout(() => inputRef.current?.click(), 50)
                }}
                className="clinical-btn-outline"
                style={{ height: 38, padding: '0 20px', fontSize: 13 }}
              >
                Upload different file
              </button>

              {/* Tertiary: just clear */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); reset() }}
                className="clinical-btn-secondary"
                style={{ height: 38, padding: '0 16px', fontSize: 13 }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

      </div>
    </section>
  )
}
