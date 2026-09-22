'use client'

import { useEffect, useState } from 'react'
import { type AnalysisStage, STAGE_LABELS } from '@/lib/context/analysis-context'

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline steps — honest representation of real backend phases.
// Percentages are NEVER shown for analysis. Only upload has real % progress.
// ─────────────────────────────────────────────────────────────────────────────

interface PipelineStep {
  key: AnalysisStage
  label: string
  description: string
}

const PIPELINE: PipelineStep[] = [
  { key: 'upload_complete', label: 'Upload Complete',       description: 'EDF file received by AI server' },
  { key: 'queued',          label: 'Queued',                description: 'Job accepted and queued for processing' },
  { key: 'processing',      label: 'AI Analysis Running',   description: 'EEG signals being processed by model' },
  { key: 'completed',       label: 'Report Generated',      description: 'Clinical report is ready' },
]

// Which pipeline index is "active" for a given stage
function getActiveStepIndex(stage: AnalysisStage): number {
  if (stage === 'uploading')        return -1
  if (stage === 'upload_complete')  return 0
  if (stage === 'queued')           return 1
  if (stage === 'processing')       return 2
  if (stage === 'completed')        return 3
  return -1
}

// Format elapsed seconds into readable string
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

// Format ISO date to HH:MM
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return '—'
  }
}

interface ProcessingPipelineCardProps {
  stage: AnalysisStage
  startedAt: string
  filename: string
  analysisId: string
}

export function ProcessingPipelineCard({ stage, startedAt, filename, analysisId }: ProcessingPipelineCardProps) {
  const [elapsedSec, setElapsedSec] = useState(0)
  const activeIndex = getActiveStepIndex(stage)

  // Live elapsed timer — ticks every second
  useEffect(() => {
    const calcElapsed = () => {
      const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      setElapsedSec(Math.max(0, diff))
    }
    calcElapsed()
    const id = setInterval(calcElapsed, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  const shortId = analysisId.length > 12 ? `${analysisId.slice(0, 8)}…` : analysisId

  return (
    <div
      className="clinical-card-inner space-y-5"
      style={{ borderColor: 'rgba(16, 185, 129, 0.12)', background: 'rgba(16, 185, 129, 0.02)' }}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>
            Analysis Pipeline
          </div>
          <div className="mt-1 text-[14px] font-semibold truncate max-w-[280px]" style={{ color: 'var(--text-heading)' }}>
            {filename}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Started {formatTime(startedAt)}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            <span>ID:</span>
            <span className="rounded px-1 py-0.5 font-semibold" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              {shortId}
            </span>
          </div>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Elapsed</div>
          <div className="mt-0.5 text-[16px] font-bold tabular-nums" style={{ color: 'var(--text-heading)' }}>
            {formatElapsed(elapsedSec)}
          </div>
        </div>
        <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Current Stage</div>
          <div className="mt-0.5 text-[14px] font-bold" style={{ color: 'var(--accent-primary)' }}>
            {STAGE_LABELS[stage] ?? 'Processing'}
          </div>
        </div>
      </div>

      {/* ── Pipeline Steps ── */}
      <div className="space-y-0">
        {PIPELINE.map((step, idx) => {
          const isDone    = idx < activeIndex
          const isActive  = idx === activeIndex
          const isLast    = idx === PIPELINE.length - 1

          return (
            <div key={step.key} className="flex gap-3">
              {/* Connector column */}
              <div className="flex flex-col items-center" style={{ width: 20, flexShrink: 0 }}>
                {/* Icon */}
                <div
                  className="flex h-5 w-5 items-center justify-center rounded-full flex-shrink-0 transition-all duration-300"
                  style={{
                    background: isDone    ? 'var(--accent-primary)'      :
                                isActive  ? 'rgba(16,185,129,0.15)'       :
                                            'var(--bg-tertiary)',
                    border: isDone    ? 'none'                                   :
                            isActive  ? '2px solid var(--accent-primary)'        :
                                        '2px solid var(--border-strong)',
                  }}
                >
                  {isDone ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : isActive ? (
                    <div className="h-2 w-2 rounded-full clinical-dot-pulse" style={{ background: 'var(--accent-primary)' }} />
                  ) : null}
                </div>
                {/* Connector line */}
                {!isLast && (
                  <div
                    className="w-px flex-1 my-0.5 transition-all duration-500"
                    style={{
                      background: isDone ? 'var(--accent-primary)' : 'var(--border-default)',
                      minHeight: 16,
                    }}
                  />
                )}
              </div>

              {/* Step content */}
              <div className="pb-3 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[13px] font-semibold"
                    style={{
                      color: isDone   ? 'var(--text-heading)'   :
                             isActive ? 'var(--accent-primary)'  :
                                        'var(--text-faint)',
                    }}
                  >
                    {step.label}
                  </span>
                  {isActive && (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                      style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--accent-primary)' }}
                    >
                      Active
                    </span>
                  )}
                </div>
                {(isDone || isActive) && (
                  <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {step.description}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Footer note ── */}
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        Analysis time varies with recording length and signal complexity. You may safely close this tab — we&apos;ll email you when the report is ready.
      </p>
    </div>
  )
}
