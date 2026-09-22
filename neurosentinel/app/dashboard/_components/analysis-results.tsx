'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { formatConfidence, formatDurationMinutes, getReportSummary, normalizeReportStatus, type ReportRecord, getReliability } from '@/lib/neurosentinel/types'
import { StatusBadge } from './status-badge'
import { ReliabilityBadge } from './reliability-badge'
import { useAnalysis } from '@/lib/context/analysis-context'
import { ProcessingPipelineCard } from './processing-pipeline-card'

import type { UploadState } from './upload-zone'

function SectionLabel({ children, icon }: { children: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 clinical-section-label">
      {icon}
      {children}
    </div>
  )
}


export function AnalysisResults({ data, uploadState = 'idle', uploadFilename }: { data: ReportRecord | null; uploadState?: UploadState; uploadFilename?: string }) {
  const { currentAnalysis } = useAnalysis()
  const hasReport = data != null
  const status = normalizeReportStatus(data?.status)
  const reportJson = data?.report_json
  const recommendations = Array.isArray(reportJson?.clinical_report?.recommendations) ? reportJson?.clinical_report?.recommendations.slice(0, 3) : []
  const events = Array.isArray(reportJson?.events) ? reportJson.events.slice(0, 3) : []
  const topRegions = Array.isArray(reportJson?.top_regions) ? reportJson.top_regions.slice(0, 3) : []
  const isSeizureDetected = hasReport && status === 'completed' && (data?.event_count ?? 0) > 0
  const processingHint = useMemo(() => {
    if (!data || status !== 'processing') return null
    const ageSeconds = Math.max(0, (Date.now() - new Date(data.created_at).getTime()) / 1000)
    if (ageSeconds < 180) return null
    return 'Large EEG files on local CPU can take several minutes. NeuroSentinel AI is still working through preprocessing, inference, and report generation.'
  }, [data, status])

  // If actively uploading/processing, show that state instead of stale data
  const isActiveUpload = uploadState === 'uploading' || uploadState === 'processing'
  
  const durationMins = data?.duration_minutes ?? 0
  const isShortDuration = durationMins > 0 && durationMins < 20
  const showLowConfidenceWarning = hasReport && isShortDuration

  // ── Global Processing / Prop Loading ──
  const activeAnalysis = currentAnalysis || (isActiveUpload ? {
    id: 'prop-active',
    filename: uploadFilename || 'Unknown recording',
    stage: (uploadState === 'uploading' ? 'uploading' : 'processing') as import('@/lib/context/analysis-context').AnalysisStage,
    uploadProgress: uploadState === 'uploading' ? 0 : 100,
    startedAt: new Date().toISOString()
  } : null)


  if (activeAnalysis) {
    const stage = activeAnalysis.stage
    const isUploading = stage === 'uploading'

    return (
      <section className="space-y-4">
        {/* Upload progress — only shown during actual file transfer */}
        {isUploading && (
          <div className="clinical-card-inner">
            <SectionLabel>Uploading</SectionLabel>
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-[12px]" style={{ color: 'var(--text-muted)' }}>
                <span>Streaming {activeAnalysis.filename} to AI server…</span>
                <span className="font-semibold tabular-nums" style={{ color: 'var(--accent-primary)' }}>
                  {activeAnalysis.uploadProgress ?? 0}%
                </span>
              </div>
              <div className="clinical-progress-track">
                <div
                  className="clinical-progress-fill transition-all duration-300"
                  style={{ width: `${activeAnalysis.uploadProgress ?? 0}%` }}
                />
              </div>
              <p className="mt-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                Only file transfer progress is shown here. Analysis stages begin after upload completes.
              </p>
            </div>
          </div>
        )}

        {/* Analysis pipeline — shown after upload completes */}
        {!isUploading && (
          <ProcessingPipelineCard
            stage={stage}
            startedAt={activeAnalysis.startedAt}
            filename={activeAnalysis.filename}
            analysisId={activeAnalysis.reportId ?? activeAnalysis.id}
          />
        )}
      </section>
    )
  }

  return (
    <section className="space-y-5">
      {/* ── Status Overview ── */}
      <div
        className="clinical-card-inner"
        style={
          isSeizureDetected
            ? {
                background: 'rgba(245, 158, 11, 0.04)',
                border: '1px solid rgba(245, 158, 11, 0.14)',
              }
            : undefined
        }
      >
        <SectionLabel>{hasReport ? 'Analysis status' : 'No Analysis'}</SectionLabel>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {!hasReport ? (
            <span className="clinical-badge clinical-badge-neutral">
              Awaiting upload
            </span>
          ) : (
            <StatusBadge report={data} showBorder />
          )}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
              <div className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                <span>{hasReport ? formatDurationMinutes(durationMins) : '—'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                <span>{hasReport ? `${formatConfidence(data?.confidence_score)}` : '—'}</span>
              </div>
            </div>
            {hasReport && status === 'completed' && (
              <ReliabilityBadge 
                confidence={data.confidence_score} 
                duration={data.duration_minutes} 
                signalQuality={data.quality_grade} 
              />
            )}
          </div>
        </div>
        
        {hasReport ? (
          <div className="mt-4">
            <p
              className="text-[14px] leading-relaxed"
              style={{ color: isSeizureDetected ? 'var(--accent-warning)' : 'var(--text-secondary)' }}
            >
              {getReportSummary(data)}
            </p>
            {status === 'completed' && getReliability(data.confidence_score, data.duration_minutes, data.quality_grade) === 'Low' && (
              <div className="mt-4">
                <p className="text-[13px] font-semibold mb-3" style={{ color: 'var(--accent-warning)' }}>
                  ⚠️ This result has low reliability and should not be considered conclusive.
                </p>
                <div className="text-[13px] p-4 rounded-lg bg-[rgba(217,119,6,0.03)] border border-[rgba(217,119,6,0.1)]" style={{ color: 'var(--text-secondary)' }}>
                  <div className="font-semibold mb-2" style={{ color: 'var(--text-heading)' }}>Primary Factors:</div>
                  <ul className="list-disc pl-4 space-y-1">
                    {durationMins > 0 && durationMins < 20 && <li>Short recording duration ({Math.round(durationMins)} min) — recommended 20-60m</li>}
                    {data.quality_grade?.toLowerCase() === 'poor' && <li>Poor signal quality detected</li>}
                    {(!data.confidence_score || data.confidence_score < 80) && <li>Low statistical confidence in pattern recognition</li>}
                  </ul>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* ── No Report Empty State ── */}
      {!hasReport ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-default)' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div>
            <p className="text-[15px] font-semibold" style={{ color: 'var(--text-heading)' }}>No analysis yet</p>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>Upload an EDF file above to start your first report.</p>
          </div>
        </div>
      ) : status !== 'completed' ? (
        /* ── In-Progress / Failed Detail ── */
        <div className="clinical-card-inner">
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text-heading)' }}>
            {data.filename}
          </div>
          <div className="mt-3 text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {data.error_message || 'SCOUT and the report detail page will stay available while this analysis moves through the backend lifecycle.'}
          </div>
          {processingHint ? <div className="mt-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>{processingHint}</div> : null}
          <Link
            href={`/report/${data.id}`}
            className="clinical-link mt-4 inline-flex"
          >
            Open report detail
          </Link>
        </div>
      ) : (
        /* ── Completed Report: Findings + Context ── */
        <div className="flex gap-6 min-w-0 flex-col lg:flex-row">

          {/* ── Left: Structured Findings ── */}
          <div className="flex-1 min-w-0 space-y-5">
            <SectionLabel
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>}
            >
              Structured findings
            </SectionLabel>

            {/* Metric Grid — values prominent */}
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: 'Events', value: `${data.event_count ?? reportJson?.events?.length ?? 0}` },
                { label: 'Risk', value: data.risk_level || reportJson?.risk_level || 'Unknown' },
                { label: 'Quality', value: data.quality_grade || reportJson?.quality_grade || 'Unknown' },
              ].map((item) => (
                <div key={item.label} className="clinical-metric-box">
                  <div className="clinical-metric-label">{item.label}</div>
                  <div className="clinical-metric-value">{item.value}</div>
                </div>
              ))}
            </div>

            {/* Event Cards */}
            <div className="space-y-3">
              {events.length === 0 ? (
                <div className="clinical-card-inner text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                  No seizure events survived post-processing for this report.
                </div>
              ) : (
                events.map((event) => (
                  <div key={event.event_idx} className="clinical-event-card">
                    <div className="flex items-center justify-between gap-3">
                      <div className="clinical-event-title">
                        Event {event.event_idx}
                      </div>
                      <div className="clinical-event-risk">
                        {event.risk_level || 'Unknown'} risk
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3 clinical-event-meta">
                      <span>{event.onset_sec}s → {event.offset_sec}s</span>
                      <span>{event.duration_sec}s duration</span>
                      <span>{typeof event.mean_probability === 'number' ? `${(event.mean_probability * 100).toFixed(1)}% confidence` : 'Confidence unknown'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Right: Context Panels ── */}
          <div className="lg:w-[300px] lg:flex-shrink-0 space-y-5">
            <SectionLabel
              icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>}
            >
              Context
            </SectionLabel>

            {/* Trend Summary */}
            <div className="clinical-context-block text-[14px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {reportJson?.trend_summary || data.summary || 'The full report contains structured quality, risk, and explainability outputs.'}
            </div>

            {/* Top Regions */}
            <div className="clinical-context-block">
              <div className="clinical-metric-label mb-4">Top regions</div>
              {topRegions.length > 0 ? (
                topRegions.map(([region, score]) => (
                  <div key={region} className="clinical-region-row">
                    <span className="clinical-region-name">{region}</span>
                    <span className="clinical-region-score">{score.toFixed(3)}</span>
                  </div>
                ))
              ) : (
                <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                  Region data will appear here when explainability is available.
                </div>
              )}
            </div>

            {/* Recommendations */}
            <div className="clinical-context-block">
              <div className="clinical-metric-label mb-4">Recommendations</div>
              <div className="space-y-3">
                {recommendations.length > 0 ? recommendations.map((item, i) => (
                  <div key={item} className="flex gap-3 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                    <span className="flex-shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: 'var(--accent-primary-light)', color: 'var(--accent-primary)' }}>
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{item}</span>
                  </div>
                )) : (
                  <div className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
                    Open the full report for the complete recommendation set.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {status === 'completed' && showLowConfidenceWarning && (
        <div className="clinical-card-inner text-center mt-5">
          <div className="text-[14px] font-medium" style={{ color: 'var(--text-heading)' }}>Recommended next step:</div>
          <div className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            Upload a longer recording (20–60 minutes) for improved confidence.
          </div>
        </div>
      )}
    </section>
  )
}
