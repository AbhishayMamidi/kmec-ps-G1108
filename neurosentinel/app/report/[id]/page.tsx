'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScoutPanel } from '@/app/components/scout-panel'
import { ScoutAvatar } from '@/app/components/scout-avatar'
import { useScoutConversation } from '@/app/components/scout-provider'
import { getReportExplainerOpening, type ScoutRole } from '@/lib/scout-guide'
import { ensureUserProfile } from '@/lib/user-profile'
import { normalizeReport, normalizeReportStatus, type ReportRecord, getReliabilityDetails } from '@/lib/neurosentinel/types'
import { StatusBadge } from '../../dashboard/_components/status-badge'
import { ReliabilityBadge } from '../../dashboard/_components/reliability-badge'

import { ProbabilityTimeline } from '../_components/probability-timeline'
import { EventCards } from '../_components/event-cards'
import { BrainHeatmap } from '../_components/brain-heatmap'
import { DataQualityPanel } from '../_components/data-quality-panel'
import { ClinicalMetrics } from '../_components/clinical-metrics'

/* ─── Utils ─── */
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
    .replace(/^\d+\.\s+/gm, (match) => match)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* ─── SCOUT Interpretation Card ─── */
function ScoutInterpretationCard({ 
  report, 
  role, 
  initialMessage, 
}: { 
  report: ReportRecord
  role: ScoutRole
  initialMessage: string
}) {
  const { messages, loading } = useScoutConversation({
    page: 'report',
    role,
    reportId: report.id,
    currentReport: report,
    initialMessage,
  })

  const [lockedAutoSummary, setLockedAutoSummary] = useState<string | null>(null)

  useEffect(() => {
    setLockedAutoSummary(null)
  }, [report.id])

  useEffect(() => {
    if (lockedAutoSummary) return

    const firstAutoSummary = messages.find((message) =>
      message.role === 'assistant' &&
      !message.isError &&
      message.content !== initialMessage &&
      message.reportId === report.id
    )

    if (firstAutoSummary?.content?.trim()) {
      setLockedAutoSummary(firstAutoSummary.content)
    }
  }, [initialMessage, lockedAutoSummary, messages, report.id])

  if (loading && !lockedAutoSummary) {
    return (
      <div className="relative overflow-hidden rounded-[32px] border border-blue-100 bg-white p-8 shadow-sm">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-cyan-400" />
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5 px-2">
            {[0, 1, 2].map((d) => (
              <div 
                key={d} 
                className="h-1.5 w-1.5 rounded-full bg-blue-400" 
                style={{ animation: 'bounce 1.2s infinite', animationDelay: `${d * 0.15}s` }}
              />
            ))}
          </div>
          <p className="text-[15px] font-semibold text-blue-600">
            SCOUT is analyzing the EEG report...
          </p>
        </div>
        <style jsx>{`
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-3px); }
          }
        `}</style>
      </div>
    )
  }

  return (
    <div 
      className="relative overflow-hidden rounded-[32px] border border-blue-100 bg-white p-8 shadow-sm transition-all hover:shadow-md"
      style={{
        boxShadow: '0 4px 24px rgba(59, 130, 246, 0.04), inset 0 0 12px rgba(59, 130, 246, 0.02)'
      }}
    >
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-cyan-400" />
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50">
            <span className="text-sm">✨</span>
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-[#1E293B]">SCOUT Clinical Interpretation</h3>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Seizure Clinical Operations & Understanding Tool</p>
          </div>
        </div>
        {lockedAutoSummary && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-black text-emerald-700 uppercase tracking-wider ring-1 ring-inset ring-emerald-100">
            Auto Summary Locked
          </span>
        )}
      </div>

      <div className="prose prose-sm max-w-none">
        {lockedAutoSummary ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-gray-700 font-medium">
            {cleanMarkdown(lockedAutoSummary)}
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5 px-2">
              {[0, 1, 2].map((d) => (
                <div 
                  key={d} 
                  className="h-1.5 w-1.5 rounded-full bg-blue-400" 
                  style={{ animation: 'bounce 1.2s infinite', animationDelay: `${d * 0.15}s` }}
                />
              ))}
            </div>
            <p className="text-[15px] font-semibold text-blue-600 animate-pulse">
              SCOUT is analyzing the EEG report...
            </p>
          </div>
        )}
      </div>
      <style jsx>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  )
}

/* ─── Page ─── */
export default function ReportPage() {
  const params = useParams()
  const reportId = Array.isArray(params.id) ? params.id[0] : params.id
  const supabase = createClient()
  const [report, setReport] = useState<ReportRecord | null>(null)
  const [role, setRole] = useState<ScoutRole>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showChat, setShowChat] = useState(true)
  const [isDownloading, setIsDownloading] = useState(false)

  /* ─ Auth & Session check ─ */
  useEffect(() => {
    // SCOUT now auto-opens by default on every load as requested.
    setShowChat(true)
  }, [reportId])

  /* ─ Load report ─ */
  useEffect(() => {
    async function loadReport() {
      setLoading(true)
      setError(null)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const profile = await ensureUserProfile(supabase, user)
          setRole(profile.role)
        }
        const { data, error: reportError } = await supabase
          .from('reports')
          .select('id, user_id, filename, status, storage_path, error_message, summary, result_label, event_count, confidence_score, risk_level, quality_grade, duration_minutes, report_json, created_at')
          .eq('user_id', user?.id)
          .eq('id', reportId)
          .maybeSingle()
        if (reportError) throw reportError
        if (!data) throw new Error('Report not found.')
        setReport(normalizeReport(data))
      } catch (loadError: any) {
        console.error('[Report] Failed to load report:', loadError)
        setError(loadError.message || 'Unable to load this report right now.')
      } finally {
        setLoading(false)
      }
    }
    if (reportId) void loadReport()
  }, [reportId, supabase])

  /* ─ Poll for status updates ─ */
  useEffect(() => {
    if (!report) return
    const status = normalizeReportStatus(report.status)
    if (status !== 'pending' && status !== 'processing') return
    const interval = window.setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('reports')
          .select('id, user_id, filename, status, storage_path, error_message, summary, result_label, confidence_score, risk_level, quality_grade, duration_minutes, report_json, created_at, event_count')
          .eq('user_id', report.user_id)
          .eq('id', report.id)
          .maybeSingle()
        if (error) throw error
        if (data) setReport(normalizeReport(data))
      } catch (error) {
        console.error('[Report] Polling error:', error)
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [report, supabase])

  /* ─ SCOUT context ─ */
  const scoutInitialMessage = useMemo(() => {
    return getReportExplainerOpening(role, {
      fileName: report?.filename,
      result: report?.result_label || undefined,
      confidence: report?.confidence_score ?? undefined,
      summary: report?.summary || undefined,
      status: report?.status,
      riskLevel: report?.risk_level || undefined,
      eventCount: report?.event_count ?? report?.report_json?.events?.length ?? 0,
      createdAt: report?.created_at,
      recordingDuration: report?.duration_minutes ? `${report.duration_minutes.toFixed(1)} min` : undefined,
      diagnosticState: (report?.report_json?.diagnostic_state as string) || undefined,
    })
  }, [report, role])

  const scoutAutoPrompt = useMemo(() => {
    if (!report || normalizeReportStatus(report.status) !== 'completed') return null
    return {
      content: `Summarize "${report.filename || 'this report'}" for me in detail. Include the result, reliability, confidence, signal quality, and explain clearly why reliability is low if there are any limitations.`,
      visible: false,
    }
  }, [report])

  /* ─ PDF: generate via POST and open in browser tab (not download) ─ */
  const handleDownloadPDF = async () => {
    if (!report) return
    setIsDownloading(true)
    try {
      const res = await fetch(`/api/reports/${report.id}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) throw new Error('PDF generation failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      // Open in browser tab so user can read / save as they prefer
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      // Fallback: open GET route directly
      window.open(`/api/reports/${report.id}/pdf`, '_blank')
    } finally {
      setIsDownloading(false)
    }
  }


  /* ─ Render Logic ─ */
  const reportJson = report?.report_json
  const recommendations = Array.isArray(reportJson?.clinical_report?.recommendations) ? reportJson.clinical_report.recommendations : []
  const topChannels = Array.isArray(reportJson?.explainability?.top_channels) ? reportJson.explainability.top_channels : []
  const events = useMemo(() => Array.isArray(reportJson?.events) ? reportJson.events : [], [reportJson])
  const quality: any = reportJson?.quality || reportJson?.signal_quality || {}
  const modelOutputs: any = reportJson?.model_outputs || {}
  const probabilityTimeline = modelOutputs?.probability_timeline
  const reliability = getReliabilityDetails(report?.confidence_score, report?.duration_minutes, report?.quality_grade)
  const diagnosticState = (reportJson?.diagnostic_state as string) || (() => {
    const label = (report?.result_label || '').toLowerCase()
    if ((report?.event_count ?? 0) > 0 || label.includes('seizure detected')) return 'DETECTED'
    if (label.includes('suspicious')) return 'SUSPICIOUS'
    return 'CLEAR'
  })()
  const isSeizureDetected = diagnosticState === 'DETECTED'
  const isSuspicious = diagnosticState === 'SUSPICIOUS'
  const statusBadgeClasses = isSeizureDetected
    ? 'bg-red-100 text-red-900 border-red-300 shadow-sm shadow-red-100/80'
    : isSuspicious
      ? 'bg-amber-50 text-amber-800 border-amber-300 shadow-sm shadow-amber-100/80'
      : 'bg-emerald-100 text-emerald-900 border-emerald-300 shadow-sm shadow-emerald-100/80'


  const riskClasses = (() => {
    const r = (report?.risk_level || '').toLowerCase()
    if (r === 'high' || r === 'critical') return { bg: 'bg-red-500', text: 'text-red-500', gradient: 'from-red-600 to-orange-500', icon: '⚠️' }
    if (r === 'moderate' || r === 'medium') return { bg: 'bg-amber-500', text: 'text-amber-500', gradient: 'from-amber-500 to-orange-400', icon: isSuspicious ? '🔍' : '⚡' }
    if (r === 'low') return { bg: 'bg-emerald-500', text: 'text-emerald-500', gradient: 'from-emerald-500 to-teal-400', icon: '🧠' }
    return { bg: 'bg-gray-500', text: 'text-gray-500', gradient: 'from-gray-500 to-slate-400', icon: '📊' }
  })()

  if (loading) {
     return (
       <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
         <div className="flex h-12 w-12 animate-spin items-center justify-center rounded-full border-4 border-blue-500 border-t-transparent" />
         <p className="mt-4 text-sm font-bold text-gray-500 uppercase tracking-widest">Constructing Interpretation Feed...</p>
       </div>
     )
  }

  if (error || !report) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <h1 className="text-2xl font-black text-gray-900">Report Unavailable</h1>
        <p className="mt-2 text-gray-500 max-w-sm">{error || 'This report could not be found or processed.'}</p>
        <Link href="/dashboard/eeg-reports" className="mt-6 rounded-full bg-gray-900 px-8 py-3 text-sm font-black text-white transition-all hover:scale-105 active:scale-95">Return to Archive</Link>
      </div>
    )
  }

  const handleToggleChat = () => {
    const next = !showChat
    setShowChat(next)
    if (!next) {
      // User manually closed it, set session flag
      sessionStorage.setItem(`scoutDismissed:${reportId}`, 'true')
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <header className="fixed top-0 left-0 right-0 z-[60] px-8 h-16 flex justify-between items-center bg-white/95 backdrop-blur-sm border-b border-gray-200 shadow-sm">
        {/* LEFT GROUP (Breadcrumbs) */}
        <div className="flex items-center">
          <Link
            href="/dashboard"
            className="text-[15px] font-medium transition-colors hover:text-[var(--accent-primary)]"
            style={{ color: '#6B7280' }}
          >
            NeuroSentinel AI
          </Link>
          <span className="text-[15px] mx-2 select-none" style={{ color: '#9CA3AF' }}>&gt;</span>
          <span className="text-[14px] font-semibold" style={{ color: '#111827' }}>
            Clinical Viewer
          </span>
        </div>

        {/* RIGHT GROUP (Actions) */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleDownloadPDF}
            disabled={isDownloading}
            className="flex h-9 items-center rounded-lg border border-[#E5E7EB] bg-white px-[14px] text-[14px] font-medium text-[#111827] transition-all hover:bg-[#F9FAFB] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isDownloading ? 'Generating PDF…' : 'Download PDF'}
          </button>
          
          <button
            onClick={handleToggleChat}
            className="flex h-9 items-center rounded-lg border border-transparent px-[14px] text-[14px] font-medium text-white shadow-sm transition-all active:scale-95"
            style={{ background: '#0D9488' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#0f766e')}
            onMouseLeave={e => (e.currentTarget.style.background = '#0D9488')}
          >
            {showChat ? 'Hide SCOUT' : 'Open SCOUT'}
          </button>

          <div className="inline-flex items-center h-9 px-3 rounded-full bg-[#F3F4F6]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0D9488] mr-[6px]" />
            <span className="text-[14px] font-medium text-[#111827] leading-none">
              {role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Patient'}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1280px] w-full min-w-0 px-6 py-8 pt-24 overflow-x-hidden">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,3fr)_minmax(0,1fr)]">
          
          {/* ════════════ MAIN CONTENT FEED ════════════ */}
          <div className="lg:col-start-1 lg:col-end-3 xl:col-start-1 xl:col-end-3 space-y-8 min-w-0">
            
            {/* ─── § 1  DOMINANT STATUS HERO ─── */}
            <section className="relative overflow-hidden rounded-[40px] border border-transparent bg-white shadow-2xl shadow-blue-100/20">
              <div className={`absolute inset-0 opacity-10 bg-gradient-to-br ${riskClasses.gradient}`} />
              <div className="relative flex flex-col items-center justify-center p-12 text-center sm:flex-row sm:items-start sm:text-left gap-8">
                <div className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-[32px] text-4xl shadow-xl ring-4 ring-white transition-transform hover:rotate-6 ${riskClasses.bg} text-white`}>
                  {riskClasses.icon}
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                    <StatusBadge report={report} showBorder showDot={false} className={statusBadgeClasses} />
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400">
                      Conf: {report.confidence_score?.toFixed(1) || '0'}%
                    </span>
                    <ReliabilityBadge 
                      confidence={report.confidence_score} 
                      duration={report.duration_minutes} 
                      signalQuality={report.quality_grade}
                    />
                  </div>
                  <h1 className="mt-4 text-4xl sm:text-5xl font-black tracking-tight text-gray-900 antialiased">
                    {isSeizureDetected
                      ? 'Seizure events detected'
                      : isSuspicious
                        ? 'Suspicious activity — no confirmed events'
                        : 'No seizure activity detected'
                    }
                  </h1>
                  <p className="mt-3 text-lg font-bold text-gray-400 max-w-xl">
                    {isSuspicious
                      ? `Seizure-like probability patterns were flagged but did not survive post-processing filters. ${report.duration_minutes?.toFixed(1)} minutes analyzed. Clinical correlation recommended.`
                      : `Automated EEG signal processing completed. Patterns analyzed from ${report.duration_minutes?.toFixed(1)} minutes of recorded data.`
                    }
                  </p>

                  {reliability.level === 'Low' && (
                    <div className="mt-6 rounded-2xl bg-amber-50/50 p-4 border border-amber-100 inline-block text-left w-full max-w-xl">
                      <div className="text-[13px] font-bold text-amber-800 flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">Low reliability detected. This result should not be considered conclusive.</div>
                        <div className="text-[12px] font-bold text-amber-700">Recommended Action: Upload ≥20 minutes of EEG data for more reliable analysis.</div>
                      </div>
                      
                      <div className="mt-4 grid sm:grid-cols-2 gap-4">
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-widest text-[#1E293B] mb-2">Primary Limitation:</div>
                          <ul className="text-[12px] text-gray-600 space-y-1 ml-1">
                            {reliability.reasons.map((reason) => (
                              <li key={reason}>• {reason}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-widest text-[#1E293B] mb-2">Confidence Factors:</div>
                          <ul className="text-[12px] text-gray-600 space-y-1 ml-1">
                            <li>• Recording Length: {(report.duration_minutes || 0) < 20 ? 'Low' : 'Optimal'}</li>
                            <li>• Signal Quality: {report.quality_grade === 'A' || report.quality_grade === 'B' || report.quality_grade === 'Good' ? 'Good' : 'Poor'}</li>
                            <li>• Channel Coverage: Partial</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* ─── § 2  SCOUT INTERPRETATION ─── */}
            <ScoutInterpretationCard 
              report={report} 
              role={role} 
              initialMessage={scoutInitialMessage} 
            />

            {/* ─── § 3  KEY METRICS STRIP ─── */}
            <ClinicalMetrics report={report} events={events} />

            {/* ─── § 4  CLINICAL RECOMMENDATIONS ─── */}
            <section className="rounded-[32px] bg-white p-8 shadow-sm ring-1 ring-gray-100">
              <div className="flex items-center gap-3 mb-6">
                <span className="text-xl">📋</span>
                <h2 className="text-sm font-black uppercase tracking-widest text-[#1E293B]">Clinical Recommendations</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {recommendations.length > 0 ? (
                  recommendations.map((rec: string, i: number) => (
                    <div key={i} className="flex gap-4 rounded-[20px] bg-gray-50/50 p-4 ring-1 ring-inset ring-gray-100 transition-colors hover:bg-blue-50/30">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-black text-blue-600 shadow-sm ring-1 ring-blue-100">
                        {i + 1}
                      </div>
                      <p className="text-[13px] font-bold leading-relaxed text-gray-700">{rec}</p>
                    </div>
                  ))
                ) : (
                  <p className="col-span-2 text-sm text-gray-400 font-medium italic">Standard protocols follow neurologists review.</p>
                )}
              </div>
            </section>

            {/* ─── § 5  EEG PROBABILITY TIMELINE (EVIDENCE) ─── */}
            <section id="ns-timeline-capture" className="rounded-[32px] bg-white p-8 shadow-sm ring-1 ring-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-3">
                  <span className="text-xl">📉</span>
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-widest text-[#1E293B]">Probability Timeline</h2>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Temporal signal distribution & thresholding</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {events.length > 0 ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 ring-1 ring-red-100">
                      <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      <span className="text-[9px] font-black text-red-700 uppercase">
                        {events.length} Confirmed Event{events.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ) : isSuspicious ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 ring-1 ring-amber-100">
                      <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      <span className="text-[9px] font-black text-amber-700 uppercase">Suspicious Patterns — No Confirmed Events</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 ring-1 ring-emerald-100">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span className="text-[9px] font-black text-emerald-700 uppercase">0 Confirmed Events</span>
                    </div>
                  )}
                </div>
              </div>
              <ProbabilityTimeline
                probabilityTimeline={probabilityTimeline}
                events={events}
                thresholdHigh={modelOutputs?.threshold_high}
              />
            </section>

            {/* ─── § 6  BRAIN REGIONS & CHANNEL INFLUENCE ─── */}
            <div className="grid gap-8 md:grid-cols-2">
               <section id="ns-heatmap-capture" className="rounded-[32px] bg-white p-8 shadow-sm ring-1 ring-gray-100">
                 <div className="mb-6">
                    <h2 className="text-sm font-black uppercase tracking-widest text-[#1E293B]">Affected Brain Regions</h2>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Spatial activation heatmap</p>
                 </div>
                 <div className="flex items-center justify-center py-4">
                    <BrainHeatmap topChannels={topChannels} />
                 </div>
               </section>

               <section className="rounded-[32px] bg-white p-8 shadow-sm ring-1 ring-gray-100">
                 <div className="mb-6">
                    <h2 className="text-sm font-black uppercase tracking-widest text-[#1E293B]">Most Active Channels</h2>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Feature importance attribution</p>
                 </div>
                 <div className="space-y-4">
                    {topChannels.slice(0, 8).map(([ch, val]: [string, number]) => (
                      <div key={ch} className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-black uppercase">
                          <span className="text-gray-900">{ch}</span>
                          <span className="text-blue-600">{(val * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-50 ring-1 ring-inset ring-gray-100">
                          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-1000" style={{ width: `${val * 100}%` }} />
                        </div>
                      </div>
                    ))}
                 </div>
               </section>
            </div>

            {/* ─── § 7  EVENT BREAKDOWN ─── */}
            <section className="space-y-4">
               <div className="flex items-center gap-3 px-2">
                 <span className="text-xl">⚡</span>
                 <h2 className="text-sm font-black uppercase tracking-widest text-[#1E293B]">Detailed Event Breakdown</h2>
               </div>
               <EventCards events={events} diagnosticState={diagnosticState} />
            </section>

            {/* ─── § 8  QUALITY & METADATA ─── */}
            <div className="grid gap-8 md:grid-cols-2">
               <section className="rounded-[32px] bg-white p-8 shadow-sm ring-1 ring-gray-100">
                 <h2 className="text-sm font-black uppercase tracking-widest text-[#1E293B] mb-6">Pipeline Metadata</h2>
                 <div className="grid grid-cols-2 gap-4">
                   {[
                     { l: 'Sampling', v: `${reportJson?.metadata?.sampling_rate_original || '256'}Hz` },
                     { l: 'Montage', v: reportJson?.metadata?.montage_type || 'Bipolar' },
                     { l: 'Channels', v: reportJson?.metadata?.n_mapped || '22' },
                     { l: 'Provider', v: 'NeuroSentinel V4' },
                   ].map(meta => (
                     <div key={meta.l} className="flex flex-col rounded-2xl bg-gray-50 p-3 ring-1 ring-gray-100">
                       <span className="text-[9px] font-black uppercase text-gray-400">{meta.l}</span>
                       <span className="text-[11px] font-bold text-gray-900 font-mono mt-0.5">{String(meta.v)}</span>
                     </div>
                   ))}
                 </div>
                 <p className="mt-6 text-[10px] font-bold leading-relaxed text-gray-400 italic">
                    All findings are rule-based estimates processed through NeuroSentinel AI pipeline. Clinical correlation required.
                 </p>
               </section>

               <section className="rounded-[32px] bg-white p-8 shadow-sm ring-1 ring-gray-100">
                 <h2 className="text-sm font-black uppercase tracking-widest text-[#1E293B] mb-6">Signal Validation</h2>
                 <DataQualityPanel 
                   qualityScore={quality.mean_quality_score ?? quality.quality_score}
                   qualityGrade={report.quality_grade || quality.grade}
                   missingChannels={Array.isArray(quality?.missing_channels) ? quality.missing_channels : []}
                 />
               </section>
            </div>

            {/* ─── TRUST DISCLAIMER ─── */}
            <div className="text-center pb-2 pt-4">
              <p className="text-[12px] font-medium text-gray-400">
                This analysis is AI-assisted and intended for screening support only. Clinical validation is recommended.
              </p>
            </div>

          </div>

          {/* ════════════ SIDEBAR / CHAT ════════════ */}
          <div 
            className={`fixed right-0 top-[64px] bottom-0 z-[50] w-[360px] border-l bg-white shadow-2xl transition-transform duration-300 ease-in-out ${
              showChat ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <ScoutPanel 
              page="report" 
              role={role} 
              initialMessage={scoutInitialMessage} 
              report={report} 
              autoPrompt={scoutAutoPrompt}
              onClose={handleToggleChat}
            />
          </div>

          {!showChat && !loading && (
            <button
              onClick={handleToggleChat}
              className="fixed bottom-8 right-8 z-[90] flex h-[56px] w-[56px] md:h-[70px] md:w-[70px] items-center justify-center rounded-full transition-all hover:scale-105 active:scale-90 animate-in fade-in slide-in-from-bottom-4 ring-2 ring-white/60 ring-inset"
              style={{
                background: 'linear-gradient(135deg, #3B82F6, #06B6D4)',
                boxShadow: '0 8px 20px rgba(59, 130, 246, 0.25)',
              }}
              aria-label="Open SCOUT"
            >
              <ScoutAvatar size={42} variant="primary" />
            </button>
          )}

        </div>
      </div>
    </div>
  )
}
