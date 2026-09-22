'use client'

import { useMemo, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { normalizeReport, normalizeReportStatus, type ReportRecord } from '@/lib/neurosentinel/types'
import { ensureUserProfile } from '@/lib/user-profile'
import type { ScoutRole } from '@/lib/scout-guide'
import { ScoutConversation } from '@/app/components/scout-conversation'
import { ScoutAvatar } from '@/app/components/scout-avatar'


/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */
function normalizeConf(v: number | null | undefined): number | null {
  if (v == null) return null
  return v <= 1 && v > 0 ? v * 100 : v
}
function fmtConf(v: number | null | undefined): string {
  const n = normalizeConf(v)
  return n == null ? '—' : `${n.toFixed(1)}%`
}
function fmtDuration(v: number | null | undefined): string {
  return v == null ? '—' : `${v.toFixed(1)} min`
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}
function cleanMarkdown(text: string): string {
  if (!text) return ''
  return text
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ─────────────────────────────────────────
   SCOUT comparison prompt (role-aware, structured)
───────────────────────────────────────── */

function buildComparisonPrompt(a: ReportRecord, b: ReportRecord, role: ScoutRole): string {
  const fc = (v: number | null | undefined) => {
    const n = normalizeConf(v)
    return n == null ? 'not recorded' : `${n.toFixed(1)}%`
  }
  const fd = (v: number | null | undefined) =>
    v == null ? 'not recorded' : `${v.toFixed(1)} min`
  const fmtDateShort = (s: string) =>
    new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  // Role-specific tone and output guidance
  const roleTone =
    role === 'patient'
      ? `You are speaking to a PATIENT — someone tracking their own EEG recordings. Use warm, plain, compassionate language. Write in flowing paragraphs — never use bullet points or numbered lists. Avoid medical jargon entirely; if you must use a technical term, immediately explain it in simple words. Be completely honest: if the findings show a worsening pattern (new seizure events detected, higher risk level, rising event count, or lower signal quality), state clearly and firmly that the patient must contact their neurologist or healthcare provider as soon as possible. Do not soften serious findings. If findings improved or stayed stable, reassure calmly and still recommend they discuss results with their care team.`
      : role === 'clinician'
      ? `You are speaking to a CLINICIAN. Use precise, metric-dense clinical language. Lead with the most significant findings first. Reference exact values and calculated deltas (e.g. "+12.4 pp confidence", "event count 0 → 3"). Note changes in risk stratification and signal quality that may affect clinical interpretation. End with specific, evidence-based follow-up recommendations appropriate to the differential.`
      : role === 'researcher'
      ? `You are speaking to a RESEARCHER. Use rigorous, technical language. Provide exact numerical deltas for every metric. Comment on model confidence changes and what they imply about signal quality or EEG characteristics. Note any pattern that could affect reproducibility or model behavior. Suggest analytical or protocol-level follow-up steps.`
      : `You are speaking to a clinical user. Use clear, professional language appropriate for a medical context.`

  const describeReport = (label: string, r: ReportRecord) =>
    [
      `REPORT ${label}: "${r.filename}" (analyzed ${fmtDateShort(r.created_at)})`,
      `  Primary result: ${r.result_label || 'not available'}`,
      `  Detected seizure events: ${r.event_count ?? 'not recorded'}`,
      `  Risk level: ${r.risk_level || 'not recorded'}`,
      `  Model confidence: ${fc(r.confidence_score)}`,
      `  Recording duration: ${fd(r.duration_minutes)}`,
      `  Signal quality grade: ${r.quality_grade || 'not recorded'}`,
      r.summary ? `  Model summary: ${r.summary}` : null,
    ]
      .filter(Boolean)
      .join('\n')

  return [
    `You are SCOUT — Seizure Clinical Operations & Understanding Tool.`,
    `Your task is to compare TWO EEG analysis reports directly, not analyze them in isolation.`,
    ``,
    `AUDIENCE & TONE:`,
    roleTone,
    ``,
    `GUARDRAILS:`,
    `- Do NOT diagnose. Do NOT recommend specific medications or dosages.`,
    `- Compare Report A to Report B — not Report A alone or Report B alone.`,
    `- Be precise: cite actual values when describing changes (e.g. "risk level changed from Low to High", "event count increased from 0 to 2").`,
    `- If there is no clinically meaningful change, say so clearly and explain what that means.`,
    ``,
    describeReport('A', a),
    ``,
    describeReport('B', b),
    ``,
    ``,
    `FORMATTING RULES (strictly follow these):`,
    `- Output plain text only. Do NOT use Markdown headers (#, ##), bold (**text**), or italics (*text*).`,
    `- Write each section label in ALL CAPS on its own line, followed by a blank line, then the section content.`,
    `- Within sections, use "- " bullet points to itemize individual metric changes or action steps.`,
    `- For patient mode: write WHAT CHANGED and WHAT TO DO NEXT as flowing paragraphs (no bullets). Keep WHAT IT MEANS as paragraphs too.`,
    `- Separate the three sections with a blank line between them.`,
    `- Do NOT truncate your response. Write the complete three-section comparison. Length is fine.`,
    ``,
    `STRUCTURE (use exactly these three section labels):`,
    ``,
    `WHAT CHANGED`,
    `Go through each metric pair by pair: result classification, detected events, risk level, model confidence, recording duration, signal quality. For each, state the Report A value, the Report B value, and the direction/magnitude of change. If unchanged, say so. Be specific with actual numbers.`,
    ``,
    `WHAT IT MEANS`,
    `Explain the clinical or practical significance of the changes, tailored to the audience's role. Be direct and honest — if findings are concerning, say so. If they are stable or reassuring, say that too. Do not speculate beyond what the data shows.`,
    ``,
    `WHAT TO DO NEXT`,
    `Give clear, role-specific action steps based on what actually changed. For patients with worsening findings: state firmly and clearly they must contact their neurologist or care team. For clinicians: specific follow-up steps. For researchers: analytical next steps. Do not give generic advice.`,
    ``,
    `Complete all three sections fully before stopping.`,
  ].join('\n')
}

/* ─────────────────────────────────────────
   Metrics table data
───────────────────────────────────────── */
type MetricRow = {
  label: string
  a: string
  b: string
  change: string
  isChange: boolean
}

function buildMetrics(a: ReportRecord, b: ReportRecord): MetricRow[] {
  const rows: MetricRow[] = []

  const push = (label: string, aVal: string, bVal: string, change: string, isChange: boolean) =>
    rows.push({ label, a: aVal, b: bVal, change, isChange })

  // Result
  const resultChanged = (a.result_label || '').toLowerCase() !== (b.result_label || '').toLowerCase()
  push('Result', a.result_label || '—', b.result_label || '—', resultChanged ? 'Changed' : 'Unchanged', resultChanged)

  // Risk level
  if (a.risk_level || b.risk_level) {
    const changed = (a.risk_level || '').toLowerCase() !== (b.risk_level || '').toLowerCase()
    push('Risk Level', a.risk_level || '—', b.risk_level || '—', changed ? 'Changed' : 'Unchanged', changed)
  }

  // Confidence
  const aC = normalizeConf(a.confidence_score)
  const bC = normalizeConf(b.confidence_score)
  const cdiff = aC != null && bC != null ? bC - aC : null
  let cChange = '—'; let cIsChange = false
  if (cdiff != null) {
    if (Math.abs(cdiff) < 0.5) { cChange = 'Unchanged' }
    else { cChange = `${cdiff > 0 ? 'Increased' : 'Decreased'} by ${Math.abs(cdiff).toFixed(1)} pp`; cIsChange = true }
  }
  push('Confidence', fmtConf(a.confidence_score), fmtConf(b.confidence_score), cChange, cIsChange)

  // Events
  const aEv = a.event_count ?? null
  const bEv = b.event_count ?? null
  const ediff = aEv != null && bEv != null ? bEv - aEv : null
  let eChange = '—'; let eIsChange = false
  if (ediff != null) {
    if (ediff === 0) { eChange = 'Unchanged' }
    else { eChange = `${ediff > 0 ? 'Increased' : 'Decreased'} by ${Math.abs(ediff)}`; eIsChange = true }
  }
  push('Events Detected', aEv != null ? String(aEv) : '—', bEv != null ? String(bEv) : '—', eChange, eIsChange)

  // Duration
  const aDur = a.duration_minutes ?? null
  const bDur = b.duration_minutes ?? null
  const ddiff = aDur != null && bDur != null ? bDur - aDur : null
  let dChange = '—'; let dIsChange = false
  if (ddiff != null) {
    if (Math.abs(ddiff) < 0.5) { dChange = 'Unchanged' }
    else { dChange = `${ddiff > 0 ? 'Increased' : 'Decreased'} by ${Math.abs(ddiff).toFixed(1)} min`; dIsChange = true }
  }
  push('Recording Duration', fmtDuration(aDur), fmtDuration(bDur), dChange, dIsChange)

  // Quality grade
  if (a.quality_grade || b.quality_grade) {
    const changed = a.quality_grade !== b.quality_grade
    push('Quality Grade', a.quality_grade || '—', b.quality_grade || '—', changed ? 'Changed' : 'Unchanged', changed)
  }

  return rows
}

/* ─────────────────────────────────────────
   Change pill
───────────────────────────────────────── */
function ChangePill({ value, isChange }: { value: string; isChange: boolean }) {
  if (value === '—') return <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>

  const unchanged = !isChange
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 11px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: unchanged ? 'var(--bg-inset)' : 'rgba(37,99,235,0.07)',
        color: unchanged ? 'var(--text-faint)' : '#2563EB',
        border: `1px solid ${unchanged ? 'var(--border-subtle)' : 'rgba(37,99,235,0.18)'}`,
      }}
    >
      {value}
    </span>
  )
}

/* ─────────────────────────────────────────
   Report summary card
───────────────────────────────────────── */
function ReportSummaryCard({ report, label }: { report: ReportRecord; label: 'A' | 'B' }) {
  const status = normalizeReportStatus(report.status)
  const isCompleted = status === 'completed'
  const isSeizure = isCompleted && (report.event_count ?? 0) > 0
  const isFailed = status === 'failed'

  let stripeColor = 'var(--accent-primary)'
  if (isFailed) stripeColor = 'var(--accent-danger)'
  else if (isSeizure) stripeColor = 'var(--accent-warning)'
  else if (isCompleted) stripeColor = 'var(--accent-success)'

  const resultLabel = isFailed
    ? 'Analysis failed'
    : isSeizure
    ? `${report.event_count} event${(report.event_count ?? 0) !== 1 ? 's' : ''} detected`
    : report.result_label || 'No activity detected'

  const resultColor = isFailed ? 'var(--accent-danger)' : isSeizure ? 'var(--accent-danger)' : 'var(--text-heading)'

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Left accent stripe */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: stripeColor, opacity: 0.65 }} />

      {/* A / B label badge */}
      <div
        style={{
          position: 'absolute', top: 16, right: 16,
          width: 26, height: 26, borderRadius: '50%',
          background: 'var(--accent-primary-light)',
          border: '1.5px solid rgba(16,185,129,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 800, color: 'var(--accent-primary)',
          letterSpacing: '0.02em', userSelect: 'none',
        }}
      >
        {label}
      </div>

      <div style={{ padding: '20px 24px 20px 28px' }}>
        {/* Filename block */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, paddingRight: 36 }}>
          <div
            style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0, marginTop: 1,
              background: 'var(--bg-inset)', border: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 14, fontWeight: 700, color: 'var(--text-heading)',
                letterSpacing: '-0.01em', lineHeight: 1.3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {report.filename || 'Unnamed EEG File'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {fmtDate(report.created_at)}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.05em', marginTop: 2, textTransform: 'uppercase' }}>
              #{report.id.slice(0, 8)}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border-subtle)', marginBottom: 14 }} />

        {/* Key result */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Key Result
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: resultColor, letterSpacing: '-0.01em', lineHeight: 1.35 }}>
            {resultLabel}
          </div>
        </div>

        {/* 2×2 Metrics grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
          {[
            { label: 'Confidence', value: fmtConf(report.confidence_score) },
            { label: 'Duration', value: fmtDuration(report.duration_minutes) },
            { label: 'Risk Level', value: report.risk_level || '—' },
            { label: 'Quality Grade', value: report.quality_grade || '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)', marginBottom: 3 }}>
                {label}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* View Report action */}
        {isCompleted && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
            <Link
              href={`/report/${report.id}`}
              className="clinical-btn-outline"
              style={{ height: 28, padding: '0 12px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
              </svg>
              View Report {label}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
   SCOUT chatbot section (embedded, interactive)
───────────────────────────────────────── */
function ScoutChatSection({
  reportA,
  reportB,
  role,
}: {
  reportA: ReportRecord
  reportB: ReportRecord
  role: ScoutRole
}) {
  // Per-mount key — resets conversation on every page reload
  const stateKey = useRef(`compare:${reportA.id}:${reportB.id}:${Date.now()}`).current

  const autoPrompt = useMemo(
    () => ({ content: buildComparisonPrompt(reportA, reportB, role), visible: false }),
    [reportA.id, reportB.id, role],
  )

  const compareQuickPrompts = [
    'Explain the confidence difference',
    'Compare risk levels',
    'What changed between reports?',
  ]

  return (
    <section
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
      }}
    >
      {/* Blue top bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #3B82F6, #06B6D4)' }} />

      {/* SCOUT header */}
      <div
        style={{
          padding: '14px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--bg-muted)',
        }}
      >
        <ScoutAvatar size={26} variant="primary" />
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-heading)' }}>
            SCOUT Comparison Chat
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>
            Seizure Clinical Operations &amp; Understanding Tool
          </div>
        </div>
      </div>

      {/* Embedded chat — fixed height, scrollable */}
      <div style={{ height: 520 }}>
        <ScoutConversation
          page="general"
          role={role}
          reportId={null}
          currentReport={null}
          pageData={null}
          stateKey={stateKey}
          initialMessage="SCOUT online. Comparison mode active — analyzing both EEG reports now."
          quickPrompts={compareQuickPrompts}
          autoPrompt={autoPrompt}
        />
      </div>
    </section>
  )
}


/* ─────────────────────────────────────────
   Main page
───────────────────────────────────────── */
export default function ComparePage() {
  const searchParams = useSearchParams()
  const aId = searchParams.get('a')
  const bId = searchParams.get('b')

  const [reportA, setReportA] = useState<ReportRecord | null>(null)
  const [reportB, setReportB] = useState<ReportRecord | null>(null)
  const [role, setRole] = useState<ScoutRole>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    if (!aId || !bId) {
      setError('Invalid comparison. Please select two completed reports from Analysis History.')
      setLoading(false)
      return
    }

    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setError('Not authenticated.'); setLoading(false); return }

        // Load role for SCOUT tone
        try {
          const profile = await ensureUserProfile(supabase, user)
          setRole(profile.role as ScoutRole)
        } catch { /* role stays null */ }

        const { data, error: dbErr } = await supabase
          .from('reports')
          .select('id, user_id, filename, status, summary, result_label, event_count, confidence_score, quality_grade, risk_level, duration_minutes, created_at, error_message')
          .eq('user_id', user.id)
          .in('id', [aId, bId])

        if (dbErr) throw dbErr
        if (!data || data.length < 2) {
          setError('One or both reports could not be found.')
          setLoading(false)
          return
        }

        const records = data.map(normalizeReport)
        const rA = records.find((r) => r.id === aId) ?? records[0]
        const rB = records.find((r) => r.id === bId) ?? records[1]

        // Safety: only completed reports should ever reach this page
        if (normalizeReportStatus(rA.status) !== 'completed' || normalizeReportStatus(rB.status) !== 'completed') {
          setError('One or both reports are not completed and cannot be compared.')
          setLoading(false)
          return
        }

        setReportA(rA)
        setReportB(rB)
      } catch (e: any) {
        setError(e.message || 'Failed to load reports.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [aId, bId, supabase])

  /* ── Loading ── */
  if (loading) {
    return (
      <>
        <header className="clinical-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link href="/dashboard/eeg-reports" style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
              </svg>
              Analysis History
            </Link>
            <span style={{ fontSize: 10, color: 'var(--border-strong)' }}>›</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)' }}>Report Comparison</span>
          </div>
        </header>
        <div className="clinical-page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div className="clinical-spinner-sm" style={{ width: 28, height: 28, borderWidth: 3 }} />
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>Loading reports…</span>
          </div>
        </div>
      </>
    )
  }

  /* ── Error ── */
  if (error || !reportA || !reportB) {
    return (
      <>
        <header className="clinical-header">
          <Link href="/dashboard/eeg-reports" style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
            Analysis History
          </Link>
        </header>
        <div className="clinical-page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 8 }}>Unable to load comparison</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.6 }}>{error}</div>
            <Link href="/dashboard/eeg-reports" className="clinical-btn-primary" style={{ display: 'inline-flex', height: 36, padding: '0 20px', fontSize: 13, alignItems: 'center' }}>
              Back to Analysis History
            </Link>
          </div>
        </div>
      </>
    )
  }

  const metrics = buildMetrics(reportA, reportB)
  const changedCount = metrics.filter((r) => r.isChange).length

  return (
    <>
      {/* ── Header ── */}
      <header className="clinical-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            href="/dashboard/eeg-reports"
            style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5, transition: 'color 0.15s' }}
            className="hover:text-[var(--accent-primary)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
            Analysis History
          </Link>
          <span style={{ fontSize: 10, color: 'var(--border-strong)' }}>›</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-heading)' }}>Report Comparison</span>
        </div>

        {changedCount > 0 && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 20,
              background: 'var(--bg-inset)', border: '1px solid var(--border-default)',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {changedCount} metric{changedCount !== 1 ? 's' : ''} differ
            </span>
          </div>
        )}
      </header>

      {/* ── Content ── */}
      <div className="clinical-fade-in clinical-page-content">
        <div className="clinical-page-container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Hero ── */}
          <section
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-xl)',
              boxShadow: '0 4px 16px rgba(15,23,42,0.05)',
              padding: '24px 36px',
              position: 'relative', overflow: 'hidden',
            }}
          >
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(14,116,144,0.025) 0%, transparent 65%)', pointerEvents: 'none' }} />
            <div style={{ position: 'relative' }}>
              <div className="clinical-hero-tagline">Side-by-side analysis</div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-heading)', letterSpacing: '-0.02em', marginTop: 6 }}>
                Report Comparison
              </h1>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.65, maxWidth: 540 }}>
                Differences are shown as-is. Higher or lower metric values are not inherently better or worse without clinical context.
              </p>
            </div>
          </section>

          {/* ── Report cards ── */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
            <ReportSummaryCard report={reportA} label="A" />

            {/* VS divider */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 36, gap: 8 }}>
              <div style={{ width: 1, flex: 1, background: 'var(--border-subtle)' }} />
              <div
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--bg-inset)', border: '1px solid var(--border-default)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', letterSpacing: '0.04em',
                }}
              >
                VS
              </div>
              <div style={{ width: 1, flex: 1, background: 'var(--border-subtle)' }} />
            </div>

            <ReportSummaryCard report={reportB} label="B" />
          </div>

          {/* ── Comparison metrics ── */}
          <section
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-card)',
              overflow: 'hidden',
            }}
          >
            {/* Section header */}
            <div
              style={{
                padding: '16px 24px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--bg-muted)',
              }}
            >
              <div
                style={{
                  width: 26, height: 26, borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-primary-light)', border: '1px solid rgba(16,185,129,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round">
                  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-heading)' }}>Comparison Metrics</div>
                <div style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginTop: 1 }}>
                  Report A vs Report B
                </div>
              </div>
            </div>

            {/* Column headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr 1fr 200px',
                padding: '10px 24px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              {['Metric', 'Report A', 'Report B', 'Change'].map((col) => (
                <div key={col} style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-faint)' }}>
                  {col}
                </div>
              ))}
            </div>

            {/* Rows */}
            {metrics.map((row, i) => (
              <div
                key={row.label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr 1fr 200px',
                  padding: '13px 24px',
                  background: i % 2 !== 0 ? 'var(--bg-muted)' : 'transparent',
                  borderBottom: i < metrics.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  alignItems: 'center',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{row.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>{row.a}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-heading)' }}>{row.b}</div>
                <div><ChangePill value={row.change} isChange={row.isChange} /></div>
              </div>
            ))}
          </section>

          {/* ── SCOUT Chat (embedded, interactive) ── */}
          <ScoutChatSection reportA={reportA} reportB={reportB} role={role} />


          {/* ── Actions bar ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 24px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <Link
              href="/dashboard/eeg-reports"
              className="clinical-btn-secondary"
              style={{ height: 34, padding: '0 14px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
              </svg>
              Back to Analysis History
            </Link>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link
                href={`/report/${reportA.id}`}
                className="clinical-btn-outline"
                style={{ height: 34, padding: '0 14px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                View Report A
              </Link>
              <Link
                href={`/report/${reportB.id}`}
                className="clinical-btn-primary"
                style={{ height: 34, padding: '0 14px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                View Report B
              </Link>
            </div>
          </div>

          <div style={{ height: 16 }} />
        </div>
      </div>
    </>
  )
}
