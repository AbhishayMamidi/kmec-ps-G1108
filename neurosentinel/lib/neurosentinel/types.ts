export type ScoutRole = 'clinician' | 'researcher' | 'patient' | null
export type ScoutPageContext = 'dashboard' | 'report' | 'onboarding' | 'settings' | 'history' | 'general'
export type ReportStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type ReportEvent = {
  event_idx: number
  onset_sec: number
  offset_sec: number
  duration_sec: number
  inter_seizure_interval?: number | null
  mean_probability: number
  peak_probability?: number
  severity_score?: number
  risk_level?: string
  pattern_type?: string
  focal_vs_gen?: string
  top_regions?: string[]
  band_powers?: Record<string, number>
  early_warning?: boolean
}

export type ExplainabilityHeatmapPoint = {
  channel: string
  x: number
  y: number
  importance: number
  active: boolean
  region: string
}

export type ReportJson = {
  recording_id: string
  file_name: string
  result_label: string
  quality_grade: string
  quality_score: number
  duration_minutes: number
  missing_channels: string[] | string
  risk_level: string
  trend_summary: string
  early_warning: boolean
  se_flag: boolean
  channel_importance_summary: string
  top_regions: [string, number][]
  events: ReportEvent[]
  executive_summary?: string
  signal_quality?: Record<string, unknown>
  model_outputs?: {
    probability_timeline?: number[]
    probability_summary?: {
      mean?: number
      median?: number
      p99?: number
      max?: number
    }
    events_per_hour?: number
    output_domain_shift?: number
    shift_label?: string
    threshold_high?: number
    threshold_low?: number
  }
  quality?: {
    mean_quality_score?: number
    dominant_grade?: string
    mean_noise_ratio?: number
    missing_channels?: string[]
    grade?: string
    snr_db?: number
    flatline_frac?: number
  }
  explainability?: {
    channel_importance?: number[]
    attention_weights?: number[]
    top_channels?: [string, number][]
    top_regions?: [string, number][]
    brain_heatmap?: {
      channels: ExplainabilityHeatmapPoint[]
      regions: Record<string, number>
    }
  }
  clinical_report?: {
    meta?: Record<string, unknown>
    signal_quality?: Record<string, unknown>
    summary?: Record<string, unknown>
    executive_summary?: string
    events?: unknown[]
    explainability?: Record<string, unknown>
    recommendations?: string[]
  }
  clinical_report_markdown?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type ReportRecord = {
  id: string
  user_id?: string
  filename: string
  storage_path?: string | null
  status: ReportStatus | string
  error_message?: string | null
  report_json?: ReportJson | null
  summary?: string | null
  result_label?: string | null
  event_count?: number | null
  confidence_score?: number | null
  risk_level?: string | null
  quality_grade?: string | null
  duration_minutes?: number | null
  created_at: string
}

export type ScoutMessage = {
  id: string
  role: 'assistant' | 'user'
  content: string
  createdAt: string
  reportId?: string | null
  pageContext?: ScoutPageContext
  isError?: boolean
}

export type ScoutContextPayload = {
  page: ScoutPageContext
  role?: ScoutRole
  reportId?: string | null
  currentReport?: ReportRecord | null
  pageData?: ScoutPageData | null
}

export type ScoutPageStats = {
  totalReports: number
  completedReports: number
  processingReports: number
  failedReports: number
}

export type ScoutPageData = {
  latestReport?: ReportRecord | null
  recentReports?: ReportRecord[]
  stats?: ScoutPageStats | null
  summary?: string | null
  activeAnalysis?: {
    filename: string
    status: string
    progress: number
    startedAt: string
  } | null
}

export type ReliabilityDetails = {
  level: 'High' | 'Moderate' | 'Low'
  reasons: string[]
}

export function normalizeReportStatus(status: string | null | undefined): ReportStatus {
  if (status === 'processing' || status === 'completed' || status === 'failed') return status
  return 'pending'
}

export function normalizeReport(record: any): ReportRecord {
  return {
    id: String(record.id),
    user_id: record.user_id ? String(record.user_id) : undefined,
    filename: String(record.filename ?? record.file_name ?? 'Unknown EDF'),
    storage_path: record.storage_path ?? null,
    status: normalizeReportStatus(record.status),
    error_message: record.error_message ?? null,
    report_json: record.report_json ?? null,
    summary: record.summary ?? null,
    result_label: record.result_label ?? null,
    event_count: typeof record.event_count === 'number' ? record.event_count : null,
    confidence_score: typeof record.confidence_score === 'number' ? record.confidence_score : null,
    risk_level: record.risk_level ?? null,
    quality_grade: record.quality_grade ?? null,
    duration_minutes: typeof record.duration_minutes === 'number' ? record.duration_minutes : null,
    created_at: String(record.created_at ?? new Date().toISOString()),
  }
}

export function toScoutMessage(record: any): ScoutMessage {
  return {
    id: String(record.id),
    role: record.role === 'assistant' ? 'assistant' : 'user',
    content: String(record.content ?? ''),
    createdAt: String(record.created_at ?? new Date().toISOString()),
    reportId: record.report_id ? String(record.report_id) : null,
    pageContext: (record.page_context as ScoutPageContext | undefined) ?? 'general',
  }
}

export function createOptimisticScoutMessage(
  role: ScoutMessage['role'],
  content: string,
  reportId?: string | null,
  pageContext?: ScoutPageContext,
  isError = false
): ScoutMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    reportId: reportId ?? null,
    pageContext,
    isError,
  }
}

export function getReportHeadline(report: ReportRecord | null | undefined) {
  if (!report) return 'Awaiting report'
  if (normalizeReportStatus(report.status) === 'pending') return 'Queued for analysis'
  if (normalizeReportStatus(report.status) === 'processing') return 'Analysis in progress'
  if (normalizeReportStatus(report.status) === 'failed') return 'Analysis failed'
  return report.result_label || 'Report ready'
}

export function getReportSummary(report: ReportRecord | null | undefined) {
  if (!report) return 'Upload an EDF to create a pending report.'
  if (normalizeReportStatus(report.status) === 'pending') return 'The report has been created and is waiting for backend processing.'
  if (normalizeReportStatus(report.status) === 'processing') return 'The backend is preprocessing the EDF, running V4 inference, and generating the structured report.'
  if (normalizeReportStatus(report.status) === 'failed') return report.error_message || 'The backend could not complete analysis for this report.'
  return report.summary || 'The structured report is available.'
}

export function formatConfidence(confidenceScore?: number | null) {
  if (typeof confidenceScore !== 'number' || Number.isNaN(confidenceScore)) return 'Unknown'
  return `${confidenceScore.toFixed(1)}%`
}

export function formatDurationMinutes(durationMinutes?: number | null) {
  if (typeof durationMinutes !== 'number' || Number.isNaN(durationMinutes)) return 'Unknown'
  return `${durationMinutes.toFixed(1)} min`
}

export function getReliability(confidence?: number | null, duration?: number | null, signalQuality?: string | null): 'High' | 'Moderate' | 'Low' {
  const conf = typeof confidence === 'number' ? confidence : 0
  const dur = typeof duration === 'number' ? duration : 0
  const qual = signalQuality?.toLowerCase() || 'unknown'

  // Normalize confidence to 0..1 range
  const normalizedConf = conf > 1 ? conf / 100 : conf

  // Critical: very low confidence always = Low reliability
  // This catches the case where the model is uncertain regardless of duration
  if (normalizedConf < 0.30) return 'Low'

  // Poor signal quality = Low reliability
  if (qual === 'poor' || qual === 'unreliable') return 'Low'

  // Short recording reduces reliability
  if (dur > 0 && dur < 10) return 'Low'

  // Moderate confidence or somewhat short duration = Moderate
  if (normalizedConf < 0.80) return 'Moderate'
  if (dur > 0 && dur < 20) return 'Moderate'

  return 'High'
}

export function getReliabilityDetails(confidence?: number | null, duration?: number | null, signalQuality?: string | null): ReliabilityDetails {
  const reasons: string[] = []
  const level = getReliability(confidence, duration, signalQuality)

  const normalizedConf = typeof confidence === 'number' ? (confidence > 1 ? confidence / 100 : confidence) : null

  // Check confidence first (matches getReliability priority)
  if (normalizedConf !== null && normalizedConf < 0.30) {
    reasons.push(`Model confidence is very low at ${(normalizedConf * 100).toFixed(1)}%, indicating high uncertainty in the result.`)
  } else if (normalizedConf !== null && normalizedConf < 0.80) {
    reasons.push(`Model confidence is below the preferred threshold at ${(normalizedConf * 100).toFixed(1)}%.`)
  }

  const quality = signalQuality?.toLowerCase() || 'unknown'
  if (quality === 'poor' || quality === 'unreliable') {
    reasons.push(`Signal quality is ${signalQuality}, which reduces confidence in the interpretation.`)
  }

  if (typeof duration === 'number' && duration > 0 && duration < 10) {
    reasons.push(`Recording length is very short at ${duration.toFixed(1)} minutes; 20+ minutes is recommended.`)
  } else if (typeof duration === 'number' && duration > 0 && duration < 20) {
    reasons.push(`Recording length is short at ${duration.toFixed(1)} minutes; 20+ minutes is recommended.`)
  }

  if (reasons.length === 0) {
    if (level === 'High') {
      reasons.push('Recording duration, signal quality, and model confidence are all in a reliable range.')
    } else if (level === 'Moderate') {
      reasons.push('Some supporting factors are weaker than ideal, so the result should be interpreted with caution.')
    } else {
      reasons.push('Multiple reliability factors are weaker than ideal, so the result should not be treated as conclusive.')
    }
  }

  return { level, reasons }
}
