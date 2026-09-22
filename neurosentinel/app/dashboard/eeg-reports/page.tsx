'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/client'
import { normalizeReport, normalizeReportStatus, type ReportRecord } from '@/lib/neurosentinel/types'
import { StatusBadge } from '../_components/status-badge'
import { ReliabilityBadge } from '../_components/reliability-badge'
import { useAnalysis } from '@/lib/context/analysis-context'

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */


function getKeyResult(report: ReportRecord): { primary: string; secondary: string; isSeizure: boolean } {
  const status = normalizeReportStatus(report.status)

  // ── FAILED STATE ──
  if (status === 'failed') {
    const msg = report.error_message || ''

    // Memory Errors
    if (msg.toLowerCase().includes('memory threshold')) {
      const match = msg.match(/(\d+MB) > (\d+MB)/)
      return {
        primary: 'Processing failed due to memory limit',
        secondary: match ? `${match[1]} used (limit: ${match[2]})` : 'Threshold exceeded',
        isSeizure: false,
      }
    }

    // Server Restarts
    if (msg.toLowerCase().includes('server restarted')) {
      return {
        primary: 'Processing interrupted',
        secondary: 'Server restarted during analysis — re-upload required',
        isSeizure: false,
      }
    }

    // Generic error
    return {
      primary: 'Processing failed',
      secondary: msg || 'Encountered internal error',
      isSeizure: false,
    }
  }

  // ── ONGOING STATE ──
  if (status !== 'completed') {
    return {
      primary: 'Analysis ongoing',
      secondary: 'Processing EEG signal...',
      isSeizure: false,
    }
  }

  // ── COMPLETED STATE ──
  if ((report.event_count ?? 0) > 0) {
    return {
      primary: 'Seizure detected',
      secondary: `${report.event_count} event${(report.event_count ?? 0) > 1 ? 's' : ''} identified`,
      isSeizure: true,
    }
  }

  // Clean
  return {
    primary: report.result_label || 'No activity detected',
    secondary: 'Clinical baseline normal',
    isSeizure: false,
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function formatConfidence(score: number | null | undefined): string | null {
  if (score == null) return null
  let val = score
  // Fix: handle both 0.889 and 88.9
  if (val <= 1 && val > 0) {
    val = val * 100
  }
  // Ensure we don't multiply twice if if's already around 80-100
  // Handle edge cases where score might be slightly > 1 (e.g. 1.05) if any,
  // but usually it's [0,1] or [0,100].
  return `${val.toFixed(1)}%`
}

function formatDateISO(dateStr: string) {
  return new Date(dateStr).toISOString().split('T')[0]
}

/* ─────────────────────────────────────────────────────────────
   SVG Icons (inline — no extra deps)
───────────────────────────────────────────────────────────── */

const IconEEG = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)
const IconCalendar = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)
const IconClock = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
)
const IconFile = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
)
const IconSearch = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)
const IconReport = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
  </svg>
)
const IconDownload = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)
const IconClose = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const IconShield = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)
const IconHistory = ({ size = 20, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.98" />
  </svg>
)
const IconCompare = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3H5a2 2 0 0 0-2 2v4" /><path d="M9 21H5a2 2 0 0 1-2-2v-4" />
    <path d="M15 3h4a2 2 0 0 1 2 2v4" /><path d="M15 21h4a2 2 0 0 0 2-2v-4" />
    <line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
  </svg>
)

/* ─────────────────────────────────────────────────────────────
   Skeleton loader for a single card
───────────────────────────────────────────────────────────── */
function SkeletonCard({ density = 'comfortable' }: { density?: 'comfortable' | 'compact' }) {
  const isCompact = density === 'compact'
  const Block = ({ w, h, r = 4 }: { w: number | string; h: number; r?: number }) => (
    <div className="skeleton-shimmer" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />
  )

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        padding: isCompact ? '16px 20px 16px 24px' : '24px 28px 24px 32px',
        display: 'grid',
        gridTemplateColumns: isCompact ? '1.2fr 2fr 1fr' : 'minmax(200px,1.2fr) 2fr minmax(160px,1fr)',
        gap: isCompact ? 20 : 32,
        alignItems: 'center',
        animation: 'clinicalFadeIn 0.4s ease forwards',
        overflow: 'hidden',
        position: 'relative',
      }}
      aria-busy="true"
      aria-label="Loading report…"
    >
      {/* Left: icon + filename */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Block w={32} h={32} r={8} />
          <Block w={120} h={13} />
        </div>
        <Block w={80} h={10} />
        <Block w={60} h={10} />
      </div>

      {/* Centre: result */}
      <div style={{ paddingLeft: 24, borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Block w={56} h={9} />
        <Block w="70%" h={15} />
        <Block w="50%" h={11} />
      </div>

      {/* Right: badge */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Block w={90} h={24} r={99} />
        <Block w={58} h={10} />
      </div>
    </div>
  )
}


/* ─────────────────────────────────────────────────────────────
   Individual analysis card
───────────────────────────────────────────────────────────── */
function AnalysisCard({
  report,
  density = 'comfortable',
  isAlternating = false,
  compareMode = false,
  isSelected = false,
  onToggleSelect,
}: {
  report: ReportRecord
  density?: 'comfortable' | 'compact'
  isAlternating?: boolean
  compareMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const status = normalizeReportStatus(report.status)
  const isFailed = status === 'failed'
  const isProcessing = status === 'processing'
  const isCompleted = status === 'completed'
  const isCompact = density === 'compact'

  // Per-card PDF open state
  const [pdfLoading, setPdfLoading] = useState(false)
  const handleOpenPdf = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setPdfLoading(true)
    try {
      const res = await fetch(`/api/reports/${report.id}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) throw new Error('PDF failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      // Open in browser tab (not download)
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      window.open(`/api/reports/${report.id}/pdf`, '_blank')
    } finally {
      setPdfLoading(false)
    }
  }

  // Only completed reports can be compared or have their report viewed
  const isSelectableInCompare = compareMode && isCompleted

  const { primary: primaryResult, secondary: secondaryResult, isSeizure } = getKeyResult(report)

  const confidenceDisplay = formatConfidence(report.confidence_score)
  const durationDisplay = report.duration_minutes != null ? `${report.duration_minutes} min` : null

  // Stripe Color logic
  let stripeColor = 'var(--accent-primary)'
  if (isFailed) stripeColor = 'var(--accent-danger)'
  else if (isSeizure) stripeColor = 'var(--accent-warning)' // "Seizure Detected" is Orange
  else if (isCompleted) stripeColor = 'var(--accent-success)'


  return (
    <article
      onClick={isSelectableInCompare ? () => onToggleSelect?.(report.id) : undefined}
      style={{
        background: isSelected
          ? 'rgba(16, 185, 129, 0.03)'
          : isFailed ? 'rgba(220, 38, 38, 0.02)' : isAlternating ? '#FAFBFC' : 'var(--bg-card)',
        border: isSelected
          ? '1px solid var(--accent-primary)'
          : isFailed ? '1px solid rgba(220, 38, 38, 0.15)' : '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: isSelected
          ? '0 0 0 3px rgba(16, 185, 129, 0.12), var(--shadow-card)'
          : 'var(--shadow-card)',
        padding: '0',
        overflow: 'hidden',
        transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
        animation: 'clinicalFadeIn 0.35s ease forwards',
        position: 'relative',
        display: 'flex',
        cursor: isSelectableInCompare ? 'pointer' : compareMode && !isCompleted ? 'not-allowed' : 'default',
        opacity: compareMode && !isCompleted ? 0.55 : 1,
      }}
      onMouseEnter={(e) => {
        if (isSelected) return
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = 'var(--shadow-card-hover)'
        el.style.borderColor = isFailed ? 'rgba(220, 38, 38, 0.25)' : isSelectableInCompare ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-strong)'
      }}
      onMouseLeave={(e) => {
        if (isSelected) return
        const el = e.currentTarget as HTMLElement
        el.style.boxShadow = 'var(--shadow-card)'
        el.style.borderColor = isFailed ? 'rgba(220, 38, 38, 0.15)' : 'var(--border-default)'
      }}
    >
      {/* ── Left accent bar ── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: stripeColor,
          opacity: isFailed ? 0.8 : 0.6,
        }}
      />

      {/* ── Compare mode selection indicator (only for completed reports) ── */}
      {isSelectableInCompare && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: `2px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
            background: isSelected ? 'var(--accent-primary)' : 'var(--bg-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            flexShrink: 0,
            boxShadow: isSelected ? '0 0 0 3px rgba(16,185,129,0.15)' : 'none',
          }}
        >
          {isSelected && (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <polyline points="2,6 5,9 10,3" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      )}

      {/* ── Compare mode: unavailable label for non-completed ── */}
      {compareMode && !isCompleted && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            right: 12,
            zIndex: 2,
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-faint)',
            background: 'var(--bg-inset)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 99,
            padding: '2px 8px',
          }}
        >
          Not available for comparison
        </div>
      )}
      <div style={{ padding: isCompact ? '16px 20px 16px 24px' : '24px 28px 24px 32px', width: '100%' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isCompact ? '1.2fr 2fr 1fr' : 'minmax(240px, 1.2fr) 2fr minmax(200px, 1fr)',
            gap: isCompact ? 20 : 32,
            alignItems: 'center',
          }}
        >
          {/* ZONE 1 (LEFT): FILE & TIME */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isCompact ? 4 : 8 }}>
              <div
                style={{
                  flexShrink: 0,
                  width: isCompact ? 30 : 34,
                  height: isCompact ? 30 : 34,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <IconEEG size={isCompact ? 14 : 16} color="var(--accent-primary)" />
              </div>
              <div
                style={{
                  fontSize: isCompact ? 14 : 15,
                  fontWeight: 700,
                  color: 'var(--text-heading)',
                  letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {report.filename || 'Unnamed EEG File'}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: isCompact ? 'row' : 'column',
                gap: isCompact ? 12 : 4,
                fontSize: 11,
                color: 'var(--text-muted)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <IconCalendar /> {formatDate(report.created_at)}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <IconClock /> {formatTime(report.created_at)}
              </span>
              {!isCompact && (
                <span style={{ opacity: 0.6, fontSize: 10, letterSpacing: '0.04em' }}>
                  #{report.id.slice(0, 8).toUpperCase()}
                </span>
              )}
            </div>
          </div>

          {/* ZONE 2 (CENTER): KEY RESULT */}
          <div
            style={{
              padding: isCompact ? '0 16px' : '0 24px',
              borderLeft: '1px solid var(--border-subtle)',
              borderRight: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              minWidth: 0,
              maxWidth: 400,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: 'var(--text-faint)',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <IconShield size={10} color="var(--text-faint)" />
              Key Result
            </div>
            <div
              style={{
                fontSize: isCompact ? 15 : 16,
                fontWeight: 700,
                color: isFailed ? 'var(--accent-danger)' : isSeizure ? 'var(--accent-danger)' : 'var(--text-heading)',
                letterSpacing: '-0.01em',
                lineHeight: 1.25,
                wordBreak: 'break-word',
              }}
            >
              {primaryResult}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text-muted)',
                marginTop: 2,
                wordBreak: 'break-word',
              }}
            >
              {secondaryResult}
            </div>
          </div>

          {/* ZONE 3 (RIGHT): BADGES & CONFIDENCE */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {/* Status Badge */}
              <StatusBadge report={report} showBorder />

              {/* Reliability Badge */}
              {isCompleted && (
                <ReliabilityBadge 
                  confidence={report.confidence_score} 
                  duration={report.duration_minutes} 
                  signalQuality={report.quality_grade}
                />
              )}
            </div>

            {/* Confidence & Quick Meta */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {isCompleted && confidenceDisplay && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase' }}>
                    Confidence
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)' }}>
                    {confidenceDisplay}
                  </span>
                </div>
              )}
              {durationDisplay && !isCompact && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase' }}>
                    Duration
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {durationDisplay}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Summary & Actions Row ── */}
        {!isCompact && (
          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', maxWidth: '60%' }}>
              {report.summary && isCompleted ? (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                  {report.summary}
                </span>
              ) : null}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isProcessing && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
                  <div className="clinical-spinner-sm" />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>Processing…</span>
                </div>
              )}
              {isCompleted && (
                <Link
                  href={`/report/${report.id}`}
                  className="clinical-btn-primary"
                  onClick={(e) => e.stopPropagation()}
                  style={{ height: 32, padding: '0 14px', fontSize: 12, borderRadius: 6 }}
                >
                  <IconReport size={13} /> View Report
                </Link>
              )}
              {isCompleted && (
                <button
                  onClick={handleOpenPdf}
                  disabled={pdfLoading}
                  className="clinical-btn-outline"
                  style={{ height: 32, padding: '0 14px', fontSize: 12, borderRadius: 6, cursor: pdfLoading ? 'wait' : 'pointer' }}
                >
                  {pdfLoading ? 'Generating…' : <><IconDownload size={13} />{' '}Download PDF</>}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

/* ─────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────── */
export default function AnalysisHistoryPage() {
  const { currentAnalysis, abortAnalysis } = useAnalysis()
  const router = useRouter()
  const [reports, setReports] = useState<ReportRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [compareMode, setCompareMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const supabase = createClient()

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= 2) return prev
      return [...prev, id]
    })
  }, [])

  const exitCompareMode = useCallback(() => {
    setCompareMode(false)
    setSelectedIds([])
  }, [])

  const handleCompare = useCallback(() => {
    if (selectedIds.length !== 2) return
    router.push(`/dashboard/eeg-reports/compare?a=${selectedIds[0]}&b=${selectedIds[1]}`)
  }, [selectedIds, router])

  /* ── Initial fetch ── */
  useEffect(() => {
    async function fetchReports() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setReports([]); setLoading(false); return }

        const { data, error } = await supabase
          .from('reports')
          .select('id, user_id, filename, status, summary, result_label, event_count, confidence_score, quality_grade, risk_level, duration_minutes, created_at, error_message')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })

        if (error) throw error
        setReports(Array.isArray(data) ? data.map(normalizeReport) : [])
      } catch (err) {
        console.error('[History] Error fetching reports:', err)
        setReports([])
      } finally {
        setLoading(false)
      }
    }
    void fetchReports()
  }, [supabase])

  /* ── Polling for in-progress reports ── */
  useEffect(() => {
    const hasActiveWork = reports.some((r) => {
      const s = normalizeReportStatus(r.status)
      return s === 'pending' || s === 'processing'
    })
    if (!hasActiveWork) return

    const interval = window.setInterval(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data, error } = await supabase
          .from('reports')
          .select('id, user_id, filename, status, summary, result_label, event_count, confidence_score, quality_grade, risk_level, duration_minutes, created_at, error_message')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
        if (error) throw error
        setReports(Array.isArray(data) ? data.map(normalizeReport) : [])
      } catch (err) {
        console.error('[History] Polling error:', err)
      }
    }, 5000)

    return () => window.clearInterval(interval)
  }, [reports, supabase])

  /* ── Filtered list ── */
  const filtered = useMemo(() => {
    let result = reports

    if (dateFilter) {
      result = result.filter((r) => formatDateISO(r.created_at) === dateFilter)
    }

    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter((r) => {
        const dateStr = new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        return [r.filename, r.status, r.result_label, r.summary, r.risk_level, dateStr]
          .filter((v): v is string => typeof v === 'string')
          .some((v) => v.toLowerCase().includes(q))
      })
    }

    return result
  }, [reports, search, dateFilter])

  /* ── Grouping ── */
  const grouped = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0]
    const yesterdayDate = new Date()
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const yesterdayStr = yesterdayDate.toISOString().split('T')[0]

    const groups: { title: string; items: ReportRecord[] }[] = [
      { title: 'Today', items: [] },
      { title: 'Yesterday', items: [] },
      { title: 'Older', items: [] },
    ]

    filtered.forEach((r) => {
      const d = formatDateISO(r.created_at)
      if (d === todayStr) groups[0].items.push(r)
      else if (d === yesterdayStr) groups[1].items.push(r)
      else groups[2].items.push(r)
    })

    return groups.filter((g) => g.items.length > 0)
  }, [filtered])

  const allFailed = filtered.length > 0 && filtered.every((r) => normalizeReportStatus(r.status) === 'failed')
  const hasFilters = !!search || !!dateFilter

  return (
    <>
      {/* ══════════════════════════════════════
          HEADER — breadcrumb + count pill
         ══════════════════════════════════════ */}
      <header className="clinical-header">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-[12px] font-medium transition-colors hover:text-[var(--accent-primary)]"
            style={{ color: 'var(--text-muted)' }}
          >
            NeuroSentinel AI
          </Link>
          <span className="text-[10px]" style={{ color: 'var(--border-strong)' }}>&gt;</span>
          <span className="text-[14px] font-semibold" style={{ color: 'var(--text-heading)' }}>
            Analysis History
          </span>
        </div>

        {/* Report count pill */}
        {!loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 20,
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-default)',
            }}
          >
            <IconHistory size={12} color="var(--text-muted)" />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {filtered.length} {filtered.length === 1 ? 'report' : 'reports'}
            </span>
          </div>
        )}
      </header>

      {/* ══════════════════════════════════════
          PAGE CONTENT
         ══════════════════════════════════════ */}
      <div className="clinical-fade-in clinical-page-content">
        <div className="clinical-page-container" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>


          {/* ══════════════════════════════════════
              HERO — lighter version of dashboard hero
             ══════════════════════════════════════ */}
          <section
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              boxShadow: '0 4px 16px rgba(15,23,42,0.06), 0 2px 6px rgba(15,23,42,0.03)',
              padding: '32px 40px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Subtle tint overlay */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(135deg, rgba(14,116,144,0.028) 0%, rgba(13,148,136,0.018) 40%, transparent 75%)',
                pointerEvents: 'none',
              }}
            />

            <div
              style={{
                position: 'relative',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 28,
              }}
            >
              {/* Title block */}
              <div className="clinical-hero-text-block">
                <div className="clinical-hero-tagline">EEG Analysis Archive</div>
                <h1
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: 'var(--text-heading)',
                    letterSpacing: '-0.022em',
                    marginTop: 10,
                    lineHeight: 1.3,
                  }}
                >
                  Analysis History
                </h1>
                <p
                  style={{
                    fontSize: 14,
                    lineHeight: 1.72,
                    color: 'var(--text-secondary)',
                    maxWidth: 460,
                    marginTop: 8,
                  }}
                >
                  Browse past EEG reports, track processing runs, and review clinical findings. Filter by filename, date, status, or risk level.
                </p>
              </div>

              {/* ── Filter Controls ── */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
                {/* Search input */}
                <div>
                  <div className="clinical-metric-label" style={{ marginBottom: 6 }}>Search</div>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: 11,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        pointerEvents: 'none',
                      }}
                    >
                      <IconSearch />
                    </span>
                    <input
                      type="text"
                      placeholder="Filename, status, risk…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      style={{
                        height: 38,
                        width: 224,
                        padding: '0 14px 0 36px',
                        fontSize: 13,
                        color: 'var(--text-primary)',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-sm)',
                        outline: 'none',
                        transition: 'border-color 0.15s',
                        fontFamily: 'inherit',
                      }}
                      onFocus={(e) => (e.target.style.borderColor = 'rgba(14,116,144,0.4)')}
                      onBlur={(e) => (e.target.style.borderColor = 'var(--border-default)')}
                    />
                  </div>
                </div>

                {/* Date filter */}
                <div>
                  <div className="clinical-metric-label" style={{ marginBottom: 6 }}>Date</div>
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    style={{
                      height: 38,
                      width: 162,
                      padding: '0 12px',
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      outline: 'none',
                      colorScheme: 'light',
                      fontFamily: 'inherit',
                      transition: 'border-color 0.15s',
                    }}
                    onFocus={(e) => (e.target.style.borderColor = 'rgba(14,116,144,0.4)')}
                    onBlur={(e) => (e.target.style.borderColor = 'var(--border-default)')}
                  />
                </div>

                {/* Clear filters */}
                {hasFilters && (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); setDateFilter('') }}
                    className="clinical-btn-secondary"
                    style={{ height: 38, padding: '0 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <IconClose size={11} />
                    Clear
                  </button>
                )}

                {/* Density Toggle */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--bg-inset)',
                    padding: 4,
                    borderRadius: 8,
                    border: '1px solid var(--border-default)',
                    marginLeft: 8,
                  }}
                >
                  {(['comfortable', 'compact'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setDensity(mode)}
                      style={{
                        padding: '6px 12px',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        borderRadius: 6,
                        border: 'none',
                        cursor: 'pointer',
                        background: density === mode ? 'var(--bg-card)' : 'transparent',
                        color: density === mode ? 'var(--accent-primary)' : 'var(--text-muted)',
                        boxShadow: density === mode ? 'var(--shadow-sm)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                {/* Compare Toggle */}
                <button
                  type="button"
                  id="tour-step-compare"
                  onClick={() => compareMode ? exitCompareMode() : setCompareMode(true)}
                  style={{
                    height: 38,
                    padding: '0 16px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 'var(--radius-sm)',
                    border: compareMode ? '1px solid var(--accent-primary)' : '1px solid var(--border-default)',
                    background: compareMode ? 'var(--accent-primary-light)' : 'var(--bg-card)',
                    color: compareMode ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                    marginLeft: 4,
                  }}
                >
                  <IconCompare size={13} color={compareMode ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                  {compareMode ? 'Exit Compare' : 'Compare'}
                </button>
              </div>
            </div>
          </section>

          {/* ══════════════════════════════════════
              ANALYSIS LIST — Grouped
             ══════════════════════════════════════ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: density === 'compact' ? 12 : 40, marginBottom: 80 }}>
            {loading ? (
              /* ── Loading skeletons ── */
              [0, 1, 2].map((i) => <SkeletonCard key={i} density={density} />)
            ) : filtered.length === 0 ? (
              /* ── Empty state ── */
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-xl)',
                  boxShadow: 'var(--shadow-card)',
                  padding: '72px 40px',
                  textAlign: 'center',
                  animation: 'clinicalFadeIn 0.4s ease forwards',
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--border-default)',
                    margin: '0 auto 20px',
                  }}
                >
                  <IconFile size={26} />
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 8 }}>
                  No analysis history yet
                </h3>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 360, margin: '0 auto', lineHeight: 1.65 }}>
                  Upload an EEG file to start analysis. Once processed, they will appear here in your clinical archive.
                </p>
                {hasFilters && (
                  <button
                    className="clinical-btn-secondary"
                    style={{ marginTop: 20, fontSize: 13 }}
                    onClick={() => {
                      setSearch('')
                      setDateFilter('')
                    }}
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              /* ── Chronological Groups ── */
              <>
                {allFailed && (
                  <div
                    style={{
                      padding: '12px 16px',
                      background: 'var(--accent-danger-light)',
                      border: '1px solid rgba(220, 38, 38, 0.1)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--accent-danger)',
                      fontSize: 13,
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: -10,
                    }}
                  >
                    <IconShield size={16} color="var(--accent-danger)" />
                    All recent analyses failed. Please check uploads or retry.
                  </div>
                )}
                {grouped.map((group) => (
                  <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: density === 'compact' ? 8 : 16 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '0 4px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.12em',
                          color: 'var(--text-faint)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {group.title}
                      </span>
                      <div style={{ height: 1, flex: 1, background: 'var(--border-subtle)', opacity: 0.6 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: density === 'compact' ? 8 : 16 }}>
                      {group.items.map((r, idx) => (
                        <AnalysisCard
                          key={r.id}
                          report={r}
                          density={density}
                          isAlternating={idx % 2 !== 0}
                          compareMode={compareMode}
                          isSelected={selectedIds.includes(r.id)}
                          onToggleSelect={handleToggleSelect}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Bottom spacer */}
          <div style={{ height: 16 }} />

          {/* ── Compare Mode Sticky Bar ── */}
          {compareMode && (
            <section
              style={{
                position: 'sticky',
                bottom: currentAnalysis ? 108 : 20,
                zIndex: 39,
                background: 'var(--bg-card)',
                border: `1px solid ${selectedIds.length === 2 ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                borderRadius: 'var(--radius-xl)',
                padding: '12px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 20,
                boxShadow: selectedIds.length === 2
                  ? '0 0 0 3px rgba(16,185,129,0.1), var(--shadow-lg)'
                  : 'var(--shadow-lg)',
                transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                marginTop: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--accent-primary-light)',
                    border: '1px solid rgba(16,185,129,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <IconCompare size={15} color="var(--accent-primary)" />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)', lineHeight: 1.25 }}>
                    {selectedIds.length === 0 && 'Select two completed reports'}
                    {selectedIds.length === 1 && '1 of 2 selected'}
                    {selectedIds.length === 2 && 'Ready to compare'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 1, fontWeight: 500 }}>
                    {selectedIds.length === 2 ? '2 of 2 reports selected' : 'Click a report card to select'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={exitCompareMode}
                  className="clinical-btn-secondary"
                  style={{ height: 32, padding: '0 14px', fontSize: 12 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCompare}
                  disabled={selectedIds.length !== 2}
                  className="clinical-btn-primary"
                  style={{
                    height: 32,
                    padding: '0 16px',
                    fontSize: 12,
                    opacity: selectedIds.length !== 2 ? 0.4 : 1,
                    cursor: selectedIds.length !== 2 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  Compare Reports
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              </div>
            </section>
          )}

          {/* ── Current Processing Panel (Bottom) ── */}
          {currentAnalysis && (
            <section
              style={{
                position: 'sticky',
                bottom: 24,
                zIndex: 40,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-xl)',
                padding: '20px 28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 24,
                boxShadow: 'var(--shadow-lg)',
                marginTop: 24,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div className="clinical-spinner-sm" style={{ width: 20, height: 20, borderWidth: 2 }} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 2 }}>
                    {currentAnalysis.filename}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {currentAnalysis.stage === 'uploading'
                      ? `Uploading ${currentAnalysis.filename}…`
                      : `Processing ${currentAnalysis.filename}…`}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {currentAnalysis.stage === 'uploading' && (
                  <div className="clinical-progress-track" style={{ width: 100 }}>
                    <div
                      className="clinical-progress-fill"
                      style={{ width: `${currentAnalysis.uploadProgress || 0}%` }}
                    />
                  </div>
                )}
                <button
                  onClick={() => void abortAnalysis()}
                  className="clinical-btn-danger-outline"
                  style={{ height: 36, padding: '0 16px', fontSize: 13 }}
                >
                  {currentAnalysis.stage === 'uploading' ? 'Cancel Upload' : 'Abort Analysis'}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
