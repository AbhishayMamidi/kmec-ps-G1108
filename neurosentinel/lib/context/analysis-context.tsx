'use client' // Triggering Vercel Redeploy

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { normalizeReportStatus } from '@/lib/neurosentinel/types'
import { createClient } from '@/lib/supabase/client'

// ─────────────────────────────────────────────────────────────────────────────
// Analysis Stage State Machine
// Represents honest backend states. Never fabricate percentages for analysis.
// Upload progress (0-100%) is tracked separately in upload-zone via XHR events.
// ─────────────────────────────────────────────────────────────────────────────

export type AnalysisStage =
  | 'uploading'         // File transfer in progress (XHR progress events)
  | 'upload_complete'   // File received by backend; waiting for queue
  | 'queued'            // Backend acknowledged; job in queue
  | 'processing'        // Backend running (no sub-stage info yet from API)
  | 'completed'         // Done — report available
  | 'failed'            // Terminal failure
  | 'aborted'           // User cancelled

// Human-readable labels for each stage
export const STAGE_LABELS: Record<AnalysisStage, string> = {
  uploading: 'Uploading',
  upload_complete: 'Upload Complete',
  queued: 'Queued',
  processing: 'Analysing',
  completed: 'Complete',
  failed: 'Failed',
  aborted: 'Cancelled',
}

// Pipeline steps shown in the visual timeline
// When backend exposes sub-stages, map them here
export const PIPELINE_STEPS: { stage: AnalysisStage | 'analysis'; label: string }[] = [
  { stage: 'upload_complete', label: 'Upload Complete' },
  { stage: 'queued',          label: 'Queued' },
  { stage: 'processing',      label: 'AI Analysis Running' },
  { stage: 'completed',       label: 'Report Generated' },
]

export type CurrentAnalysis = {
  id: string
  filename: string
  /** Current stage of the state machine */
  stage: AnalysisStage
  /** Upload progress 0-100. Only meaningful during 'uploading' stage. */
  uploadProgress: number
  /** ISO timestamp when analysis was started */
  startedAt: string
  /** The real Supabase report ID once backend returns it */
  reportId?: string
} | null

// Backwards-compatible status for components still using the old field
export type ActiveAnalysisStatus = 'uploading' | 'processing' | 'aborted'

// ─────────────────────────────────────────────────────────────────────────────
// localStorage persistence — survives browser restart
// ─────────────────────────────────────────────────────────────────────────────

const LS_KEY = 'ns_active_analysis'

interface PersistedAnalysis {
  id: string
  filename: string
  stage: AnalysisStage
  startedAt: string
  reportId?: string
}

function saveToLocalStorage(analysis: CurrentAnalysis) {
  if (typeof window === 'undefined') return
  if (!analysis || analysis.stage === 'completed' || analysis.stage === 'failed' || analysis.stage === 'aborted') {
    localStorage.removeItem(LS_KEY)
    return
  }
  const persisted: PersistedAnalysis = {
    id: analysis.id,
    filename: analysis.filename,
    stage: analysis.stage,
    startedAt: analysis.startedAt,
    reportId: analysis.reportId,
  }
  localStorage.setItem(LS_KEY, JSON.stringify(persisted))
}

function loadFromLocalStorage(): PersistedAnalysis | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedAnalysis
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions (backwards-compatible)
// ─────────────────────────────────────────────────────────────────────────────

export function isUploadingAnalysis(status: ActiveAnalysisStatus | null | undefined) {
  return status === 'uploading'
}

export function getAnalysisStatusLabel(stage: AnalysisStage | null | undefined) {
  if (!stage) return 'Unknown'
  return STAGE_LABELS[stage] ?? 'Processing'
}

export function getAnalysisHeadline(stage: AnalysisStage | null | undefined) {
  if (!stage || stage === 'uploading') return 'File is uploading'
  return 'Clinical report is processing'
}

export function getAnalysisDescription(
  filename: string,
  stage: AnalysisStage | null | undefined
) {
  if (stage === 'uploading') {
    return `${filename} is uploading securely. Keep this tab open to monitor progress.`
  }
  return `${filename} is being analysed by NeuroSentinel AI. You can safely navigate away — we'll notify you when the report is ready.`
}

export function getAnalysisActionLabel(stage: AnalysisStage | null | undefined) {
  return stage === 'uploading' ? 'Cancel Upload' : 'Abort Analysis'
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

interface AnalysisContextType {
  currentAnalysis: CurrentAnalysis
  setCurrentAnalysis: (analysis: CurrentAnalysis | ((prev: CurrentAnalysis) => CurrentAnalysis)) => void
  abortAnalysis: () => Promise<void>
  refreshStatus: () => Promise<void>
  registerAbortHandler: (handler: (() => Promise<void>) | null) => void
}

const AnalysisContext = createContext<AnalysisContextType | undefined>(undefined)

export function AnalysisProvider({ children }: { children: React.ReactNode }) {
  const [currentAnalysis, setCurrentAnalysisState] = useState<CurrentAnalysis>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const abortHandlerRef = useRef<(() => Promise<void>) | null>(null)
  const cancelPendingRef = useRef(false)
  const supabase = createClient()

  // Wrap setState to also persist to localStorage
  const setCurrentAnalysis = useCallback(
    (value: CurrentAnalysis | ((prev: CurrentAnalysis) => CurrentAnalysis)) => {
      setCurrentAnalysisState(prev => {
        const next = typeof value === 'function' ? value(prev) : value
        saveToLocalStorage(next)
        return next
      })
    },
    []
  )

  const registerAbortHandler = useCallback((handler: (() => Promise<void>) | null) => {
    abortHandlerRef.current = handler
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/job-status', { cache: 'no-store' })
      if (res.ok) {
        const job = await res.json()
        const jobRunning = job.status === 'running' || job.status === 'pending'

        if (cancelPendingRef.current) {
          if (!jobRunning) cancelPendingRef.current = false
          return
        }

        if (jobRunning) {
          // Backend is still running — restore/update from localStorage if available
          const persisted = loadFromLocalStorage()
          setCurrentAnalysis(prev => ({
            id: job.report_id || prev?.id || persisted?.id || 'pending',
            filename: job.filename || prev?.filename || persisted?.filename || 'EEG File',
            stage: 'processing',
            uploadProgress: 100, // Upload is always complete at this point
            startedAt: prev?.startedAt || persisted?.startedAt || new Date().toISOString(),
            reportId: job.report_id || prev?.reportId || persisted?.reportId,
          }))
          return
        }
      }

      // Backend idle — check Supabase for terminal state
      const current = currentAnalysis
      if (current?.stage === 'processing' || current?.stage === 'queued') {
        const reportId = current.reportId || current.id
        const { data: report } = await supabase
          .from('reports')
          .select('status, filename')
          .eq('id', reportId)
          .maybeSingle()

        if (report) {
          const status = normalizeReportStatus(report.status)
          if (status === 'completed' || status === 'failed') {
            setCurrentAnalysis(null) // clears localStorage too
          }
        } else {
          setCurrentAnalysis(null)
        }
      }
    } catch (error) {
      console.error('[AnalysisContext] Failed to refresh status:', error)
    }
  }, [currentAnalysis, supabase, setCurrentAnalysis])

  const abortAnalysis = useCallback(async () => {
    if (!currentAnalysis) return
    try {
      cancelPendingRef.current = true
      if (abortHandlerRef.current) {
        await abortHandlerRef.current()
      } else if (currentAnalysis.stage === 'processing' || currentAnalysis.stage === 'queued') {
        const response = await fetch('/api/cancel', { method: 'POST' })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error || 'Failed to cancel analysis.')
        }
      }
      setCurrentAnalysis(prev => prev ? { ...prev, stage: 'aborted' } : null)
      setTimeout(() => {
        setCurrentAnalysis(prev => (prev?.stage === 'aborted' ? null : prev))
      }, 1200)
    } catch (error) {
      cancelPendingRef.current = false
      console.error('[AnalysisContext] Failed to abort analysis:', error)
    }
  }, [currentAnalysis, setCurrentAnalysis])

  // On mount: attempt recovery from localStorage + backend verification
  useEffect(() => {
    const recover = async () => {
      const persisted = loadFromLocalStorage()
      if (!persisted) {
        // No persisted state — do a normal refresh
        await refreshStatus()
        return
      }

      // We have persisted state — verify it's still active on the backend
      try {
        const res = await fetch('/api/job-status', { cache: 'no-store' })
        if (res.ok) {
          const job = await res.json()
          const jobRunning = job.status === 'running' || job.status === 'pending'
          if (jobRunning) {
            // Backend confirms it's still running — restore full state
            setCurrentAnalysis({
              id: job.report_id || persisted.id,
              filename: job.filename || persisted.filename,
              stage: 'processing',
              uploadProgress: 100,
              startedAt: persisted.startedAt,
              reportId: job.report_id || persisted.reportId,
            })
            return
          }
        }

        // Backend says idle — check Supabase for final status
        const reportId = persisted.reportId || persisted.id
        const supabaseClient = createClient()
        const { data: report } = await supabaseClient
          .from('reports')
          .select('status')
          .eq('id', reportId)
          .maybeSingle()

        if (report) {
          const status = normalizeReportStatus(report.status)
          if (status === 'processing') {
            // Supabase still shows processing — restore
            setCurrentAnalysis({
              ...persisted,
              stage: 'processing',
              uploadProgress: 100,
            })
            return
          }
        }

        // All checks say it's done — clear stale localStorage
        localStorage.removeItem(LS_KEY)
      } catch {
        // Network error on startup — restore from localStorage optimistically
        if (persisted.stage === 'processing') {
          setCurrentAnalysis({
            ...persisted,
            uploadProgress: 100,
          })
        }
      }
    }

    void recover()

    pollIntervalRef.current = setInterval(refreshStatus, 5000)
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run on mount

  return (
    <AnalysisContext.Provider value={{ currentAnalysis, setCurrentAnalysis, abortAnalysis, refreshStatus, registerAbortHandler }}>
      {children}
    </AnalysisContext.Provider>
  )
}

const ANALYSIS_NOOP_CONTEXT: AnalysisContextType = {
  currentAnalysis: null,
  setCurrentAnalysis: () => {},
  abortAnalysis: async () => {},
  refreshStatus: async () => {},
  registerAbortHandler: () => {},
}

export function useAnalysis() {
  const context = useContext(AnalysisContext)
  return context ?? ANALYSIS_NOOP_CONTEXT
}
