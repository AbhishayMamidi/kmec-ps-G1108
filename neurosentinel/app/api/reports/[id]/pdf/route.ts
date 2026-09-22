import { NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeReport } from '@/lib/neurosentinel/types'
import { displayRoleLabel } from '@/lib/scout-guide'
import { ensureUserProfile } from '@/lib/user-profile'

const REPORT_PDF_BUCKET = process.env.SUPABASE_REPORT_PDF_BUCKET || 'report-pdfs'

/* ═══════════════════════════════════════════════════════════════ */
/*  Shared colour constants                                       */
/* ═══════════════════════════════════════════════════════════════ */

const ACCENT_TEAL = rgb(0.082, 0.722, 0.651)     // #14B8A6 Clinical Teal
const HEADER_BG = rgb(0.039, 0.267, 0.333)        // #0A4455 Dark Teal
const HEADER_SUBTITLE = rgb(0.612, 0.867, 0.847)  // teal-tinted light text for header
const TEXT_DARK = rgb(0.1, 0.1, 0.18)
const TEXT_MEDIUM = rgb(0.24, 0.24, 0.31)
const TEXT_LIGHT = rgb(0.42, 0.42, 0.5)
const BORDER_LIGHT = rgb(0.886, 0.898, 0.922)
const SECTION_BG = rgb(0.937, 0.976, 0.973)       // teal-tinted section bg
const WHITE = rgb(1, 1, 1)
const RISK_RED = rgb(0.863, 0.149, 0.149)
const RISK_ORANGE = rgb(0.918, 0.345, 0.047)
const RISK_GREEN = rgb(0.086, 0.639, 0.29)

/* ═══════════════════════════════════════════════════════════════ */
/*  Utility helpers                                                */
/* ═══════════════════════════════════════════════════════════════ */

const CHANNEL_CLINICAL_LABELS: Record<string, string> = {
  'FP1-F7': 'Left Anterior Frontal',
  'F7-T7': 'Left Anterior Temporal',
  'T7-P7': 'Left Mid-Temporal',
  'P7-O1': 'Left Posterior Temporal-Occipital',
  'FP1-F3': 'Left Frontal',
  'F3-C3': 'Left Frontocentral',
  'C3-P3': 'Left Centroparietal',
  'P3-O1': 'Left Parieto-Occipital',
  'FP2-F4': 'Right Frontal',
  'F4-C4': 'Right Frontocentral',
  'C4-P4': 'Right Centroparietal',
  'P4-O2': 'Right Parieto-Occipital',
  'FP2-F8': 'Right Anterior Frontal',
  'F8-T8': 'Right Anterior Temporal',
  'T8-P8': 'Right Mid-Temporal',
  'P8-O2': 'Right Posterior Temporal-Occipital',
  'FZ-CZ': 'Midline Frontocentral',
  'CZ-PZ': 'Midline Centroparietal',
  'P7-T7': 'Left Inferior Temporal',
  'T7-FT9': 'Left Inferior Frontotemporal',
  'FT9-FT10': 'Bilateral Subtemporal',
  'FT10-T8': 'Right Inferior Frontotemporal',
}

function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    const width = font.widthOfTextAtSize(next, fontSize)
    if (width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

function riskColor(risk: string) {
  const r = (risk || '').toLowerCase()
  if (r === 'critical' || r === 'high') return RISK_RED
  if (r === 'medium' || r === 'moderate') return RISK_ORANGE
  if (r === 'low') return RISK_GREEN
  return TEXT_LIGHT
}

function fmtMissing(val: any): string {
  if (Array.isArray(val)) return val.length > 0 ? val.join(', ') : 'None'
  return val && String(val).toLowerCase() !== 'none' ? String(val) : 'None'
}

function resolveRole(userProfile?: { role?: string } | null): 'patient' | 'clinician' | 'researcher' {
  const r = (userProfile?.role || '').toLowerCase().trim()
  if (r === 'patient' || r === 'clinician' || r === 'researcher') return r
  return 'clinician'
}

function humanizeSeconds(seconds: number): string {
  const m = seconds / 60
  if (m < 1) return `about ${Math.round(seconds)} seconds`
  if (m < 2) return 'about 1 minute'
  if (m < 60) return `about ${Math.round(m)} minutes`
  const h = Math.floor(m / 60)
  const rm = Math.round(m % 60)
  if (rm === 0) return `about ${h} hour${h > 1 ? 's' : ''}`
  return `about ${h} hour${h > 1 ? 's' : ''} and ${rm} minutes`
}

function confidenceDescriptor(pct: number): string {
  if (pct >= 85) return 'high'
  if (pct >= 60) return 'moderate'
  return 'low'
}

function formatDurationFriendly(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} seconds`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  if (s === 0) return `${m} minute${m > 1 ? 's' : ''}`
  return `${m} minute${m > 1 ? 's' : ''} and ${s} seconds`
}

function determineLat(topChannels: [string, number][]): string {
  const leftM = new Set(['FP1', 'F7', 'T7', 'P7', 'O1', 'F3', 'C3', 'P3', 'FT9'])
  const rightM = new Set(['FP2', 'F8', 'T8', 'P8', 'O2', 'F4', 'C4', 'P4', 'FT10'])
  let l = 0, r = 0
  for (const [ch] of topChannels.slice(0, 5)) {
    const parts = ch.toUpperCase().split('-')
    if (parts.some(p => leftM.has(p))) l++
    if (parts.some(p => rightM.has(p))) r++
  }
  if (l > r) return 'left lateralization'
  if (r > l) return 'right lateralization'
  if (l === r && l > 0) return 'bilateral involvement'
  return 'non-lateralized pattern'
}

function regionHypothesis(topChannels: [string, number][]): string {
  const regions = new Set<string>()
  for (const [ch] of topChannels.slice(0, 3)) {
    const u = ch.toUpperCase()
    if (['FP', 'F3', 'F4', 'F7', 'F8', 'FZ'].some(x => u.includes(x))) regions.add('frontal')
    if (['C3', 'C4', 'CZ'].some(x => u.includes(x))) regions.add('central')
    if (['T7', 'T8', 'FT'].some(x => u.includes(x))) regions.add('temporal')
    if (['P3', 'P4', 'P7', 'P8', 'PZ'].some(x => u.includes(x))) regions.add('parietal')
    if (['O1', 'O2'].some(x => u.includes(x))) regions.add('occipital')
  }
  if (regions.size === 0) return 'indeterminate'
  return Array.from(regions).sort().slice(0, 2).join(' or ')
}

function inferDatasetSource(filename: string): string {
  const fn = filename.toLowerCase()
  if (fn.startsWith('chb')) {
    const subject = fn.replace('.edf', '').split('_')[0]?.replace('chb', '').replace(/^0+/, '') || '?'
    return `CHB-MIT, Subject ${subject}`
  }
  if (fn.includes('siena')) return 'Siena Scalp EEG Database'
  if (fn.includes('tuh') || fn.includes('tueg')) return 'TUH EEG Corpus'
  return 'User Upload'
}

/* ═══════════════════════════════════════════════════════════════ */
/*  SCOUT Narrative Builders                                       */
/* ═══════════════════════════════════════════════════════════════ */

function buildPatientNarrative(filename: string, durationMin: number, events: any[], qualityGrade: string, earlyWarning: boolean, seFlag: boolean, confidence: number): string {
  const parts: string[] = []
  parts.push(`Your EEG recording was reviewed by NeuroSentinel AI over a ${Math.round(durationMin)}-minute period.`)

  if (events.length > 0) {
    const n = events.length
    const ev0 = events[0]
    const onset = Number(ev0.onset_sec || 0)
    const dur = Number(ev0.duration_sec || 0)
    const confDesc = confidenceDescriptor(confidence)

    parts.push(`The analysis identified ${n} episode${n > 1 ? 's' : ''} that showed patterns the system associated with seizure activity.`)
    parts.push(`The ${n > 1 ? 'first ' : ''}episode began approximately ${humanizeSeconds(onset)} into the recording and lasted approximately ${formatDurationFriendly(dur)}.`)
    parts.push(`The system flagged this with ${confDesc} confidence (${confidence.toFixed(1)}%), meaning the pattern was ${confDesc === 'high' ? 'strongly ' : ''}consistent with what the system has learned to recognise as seizure-related activity.`)

    if (confidence < 70) {
      parts.push('Please note that the model\'s confidence in this finding is below 70%, which means there is meaningful uncertainty. Your neurologist should interpret this result with additional caution and may recommend further monitoring.')
    }
    if (earlyWarning) {
      parts.push('An early warning pattern was also detected in the minutes leading up to this episode — this suggests a gradual buildup of unusual brain activity rather than an abrupt onset, and is something worth discussing with your treating physician.')
    }
    if (seFlag) {
      parts.push('IMPORTANT: The system detected signs of prolonged seizure activity (status epilepticus) in this recording. If you experience any further episodes lasting more than 5 minutes, call emergency services (999/911/112) immediately and do not wait to contact your neurologist first. Even if you are not currently having an episode, contact your neurologist or attend A&E as soon as possible to discuss this finding.')
    }
    if (n > 1) {
      parts.push(`A total of ${n} episodes were found across the recording, which your neurologist will want to evaluate together.`)
    }
  } else {
    parts.push('No episodes were found that the system associated with seizure activity during this recording period. This is an encouraging result, though it does not guarantee the absence of seizure activity at other times.')
    if (confidence < 70) {
      parts.push(`However, the model's confidence in this negative result is ${confidence.toFixed(1)}%, which is relatively low. This means the system was not highly certain, and further monitoring may be warranted.`)
    }
  }

  parts.push(`The overall quality of the EEG signal was assessed as ${qualityGrade}, which means the system had reliable data to work with during analysis.`)
  parts.push('It is important to understand that this report is generated by an automated tool and does not represent a medical diagnosis. Only your neurologist can make a definitive assessment using the full context of your medical history, physical examination, and symptoms.')
  parts.push('We recommend sharing this report with your neurologist at your earliest convenience and bringing a printed copy to your next appointment for discussion.')
  return parts.join(' ')
}

function buildClinicianNarrative(
  filename: string, durationMin: number, events: any[], qualityGrade: string, qualityScore: any,
  riskLevel: string, earlyWarning: boolean, seFlag: boolean,
  tc: [string, number][], tcStr: string, mcList: string[],
  pMean: number, pMedian: number, pMax: number, confidence: number,
): string {
  const parts: string[] = []

  if (events.length > 0) {
    const ev0 = events[0]
    const pattern = ev0.pattern_type || ev0.pattern || 'unknown'
    parts.push(`Analysis of ${filename} identified ${events.length} ictal event${events.length > 1 ? 's' : ''} with ${pattern} onset pattern over a ${durationMin.toFixed(1)}-minute recording (primary event onset ${ev0.onset_sec}s, duration ${ev0.duration_sec}s, model confidence ${confidence.toFixed(1)}%).`)

    if (tc.length > 0) {
      const lat = determineLat(tc)
      const rh = regionHypothesis(tc)
      parts.push(`Channel attribution analysis suggests ${rh} predominance with ${lat} — the highest-contributing derivations were ${tcStr} — consistent with a ${rh} seizure generator hypothesis.`)
      if (ev0.spread_ratio != null && ev0.n_channels_involved != null) {
        parts.push(`The onset pattern involved ${ev0.n_channels_involved} of ${22 - mcList.length} active channels (spread ratio ${Number(ev0.spread_ratio).toFixed(2)}), classifiable as ${pattern} distribution.`)
      }
    }

    if (earlyWarning) {
      parts.push('A pre-ictal probability gradient was detectable approximately 60–90 seconds preceding ictal onset, suggesting gradual electrographic build-up rather than abrupt onset, which may carry differential significance for seizure classification.')
    }
    if (seFlag) {
      parts.push('Status epilepticus criteria were met based on the duration heuristic threshold of 300 seconds. Immediate clinical evaluation is recommended.')
    } else {
      parts.push('Status epilepticus criteria were not met based on the 300-second duration heuristic.')
    }

    if (pMax > 0) {
      parts.push(`Peak model probability reached ${pMax.toFixed(4)} against a baseline probability mean of ${pMean.toFixed(4)} (median ${pMedian.toFixed(4)}), indicating ${pMax > 2 * pMean ? 'marked' : 'moderate'} deviation from background activity.`)
    }
  } else {
    parts.push(`Analysis of ${filename} identified no ictal events surviving post-processing filtering over a ${durationMin.toFixed(1)}-minute recording.`)
    if (pMax > 0) {
      parts.push(`Peak probability was ${pMax.toFixed(4)}, below the event detection threshold, against a baseline mean of ${pMean.toFixed(4)}.`)
    }
    parts.push('If clinical suspicion persists, consider prolonged monitoring or ambulatory video-EEG.')
  }

  parts.push(`Signal quality was graded as ${qualityGrade} (score ${qualityScore}/1.0) with ${mcList.length} missing channel${mcList.length !== 1 ? 's' : ''}${mcList.length > 0 ? ` (${mcList.join(', ')})` : ''}.`)
  parts.push('Clinical correlation with semiology, current anti-seizure medication levels, imaging findings, and prior EEG history is recommended before drawing localising or lateralising conclusions from this automated analysis.')
  return parts.join(' ')
}

function buildResearcherNarrative(
  filename: string, durationMin: number, events: any[], qualityGrade: string, qualityScore: any,
  earlyWarning: boolean, tc: [string, number][], tcStr: string, mcList: string[], nMapped: number,
  pMean: number, pMedian: number, pP99: number, pMax: number, rawMeta: any,
): string {
  const parts: string[] = []
  const ds = inferDatasetSource(filename)
  const mcDetail = mcList.length > 0 ? `; ${mcList.join(', ')} ${mcList.length === 1 ? 'was' : 'were'} absent and excluded from spatial feature computation` : ''
  parts.push(`Pipeline run on ${filename} (${ds}) completed successfully with ${nMapped}/22 channels mapped to the standard bipolar montage${mcDetail}.`)

  const fsOrig = rawMeta?.sampling_rate_original || '?'
  const fsProc = rawMeta?.sampling_rate_processed || 256
  const nWindows = rawMeta?.n_windows || '?'
  parts.push(`The recording was processed at ${fsProc} Hz (resampled from ${fsOrig} Hz original) using 4-second windows with 4-second stride for background segments and 1-second stride for seizure-candidate segments, yielding ${nWindows} analysis windows over the ${durationMin.toFixed(1)}-minute recording duration.`)

  const shape = pMax > 2.5 * pMean && pMedian < pMean ? 'right-skewed' : pMax < 1.5 * pMean ? 'approximately uniform' : 'moderately skewed'
  parts.push(`Inference produced a ${shape} probability distribution (mean ${pMean.toFixed(4)}, median ${pMedian.toFixed(4)}, p99 ${pP99.toFixed(4)}, max ${pMax.toFixed(4)})${events.length > 0 && pMax > 2 * pMean ? ', consistent with a single high-confidence focal activation against a predominantly low-activity background' : ''}.`)

  if (events.length > 0) {
    const ev0 = events[0]
    const durSec = Number(ev0.duration_sec || 0)
    const winCount = durSec > 0 ? Math.round(durSec / 4) : '?'
    const pattern = ev0.pattern_type || ev0.pattern || 'unknown'
    parts.push(`The flagged event spans the window range ${ev0.onset_sec}–${ev0.offset_sec} seconds (${ev0.duration_sec} seconds duration, approximately ${winCount} windows at 4-second stride).`)
    parts.push(`Top channel attribution contributors — computed via gradient-based feature importance — were ${tcStr}, with the event classified as a ${pattern} spatial pattern${ev0.spread_ratio != null ? ` based on a spread ratio of ${ev0.spread_ratio} across ${ev0.n_channels_involved || '?'} involved channels` : ''}.`)
    if (earlyWarning) {
      parts.push('A pre-ictal gradient is detectable approximately 60–90 seconds before onset, with probability values rising from baseline levels.')
    }
    const onsetF = Number(ev0.onset_sec || 0)
    parts.push(`Recommend inspection of the raw probability trace in the ${Math.max(0, Math.round(onsetF - 100))}–${ev0.offset_sec} second range for threshold sensitivity analysis and false-positive risk evaluation.`)
  } else {
    parts.push('No events exceeded the high-confidence detection threshold. The probability trace remained below the event boundary throughout the recording. Consider evaluating threshold sensitivity if the distribution tail warrants scrutiny.')
  }

  parts.push(`Signal quality assessment yielded a grade of ${qualityGrade} (composite score ${qualityScore}/1.0). The model version is NeuroSentinel V4 with declared event sensitivity of 73.3% and false-positive rate of 0.98 events per hour. Consider running this file through the pipeline at alternative threshold values to assess detection robustness.`)
  return parts.join(' ')
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Role-aware recommendation builders                             */
/* ═══════════════════════════════════════════════════════════════ */

function buildPatientRecommendations(events: any[], earlyWarning: boolean, seFlag: boolean): string[] {
  const recs: string[] = []
  if (seFlag) recs.push('IMPORTANT: If you experience any further episodes lasting more than 5 minutes, call emergency services (999/911/112) immediately. Do not wait to contact your neurologist first.')
  if (events.length > 0) {
    recs.push('Share this report with your neurologist or treating physician so they can explain what these findings mean for you specifically.')
  } else {
    recs.push('While no seizure activity was detected in this recording, continue to follow your neurologist\'s guidance for ongoing monitoring.')
  }
  if (earlyWarning) recs.push('An early warning pattern was detected — be sure to mention this when you discuss the report with your doctor.')
  recs.push('Please bring a printed copy of this report to your next medical appointment for review by your neurologist.')
  return recs.slice(0, 3)
}

function buildClinicianRecommendations(events: any[], risk: string, earlyWarning: boolean, seFlag: boolean, tc: [string, number][]): string[] {
  const recs: string[] = []
  if (seFlag) recs.push('URGENT: Status epilepticus criteria met by duration heuristic (>300s). Immediate clinical evaluation and intervention recommended.')
  if (risk === 'Critical' || risk === 'High') recs.push(`${risk}-risk ictal pattern detected. Neurology review recommended within 24 hours.`)
  if (events.length > 0) {
    const rh = tc.length > 0 ? regionHypothesis(tc) : 'undetermined'
    const lat = tc.length > 0 ? determineLat(tc) : 'non-lateralised'
    recs.push(`Onset zone hypothesis suggests ${rh} generator with ${lat}. Consider video-EEG for lateralisation confirmation if clinically indicated.`)
    recs.push('Consider ICD-10 classification under G40.x epilepsy spectrum after clinical correlation with semiology and imaging.')
    recs.push('Review current anti-seizure medication (ASM) regimen and trough levels in context of these findings.')
  } else {
    recs.push('No ictal events detected. If clinical suspicion persists, consider prolonged ambulatory or video-EEG monitoring.')
  }
  if (earlyWarning) recs.push('Pre-ictal gradient detected — evaluate for seizure threshold changes and medication timing relative to circadian pattern.')
  recs.push('Prior EEG records should be compared for evolution of ictal patterns and baseline changes.')
  recs.push('Correlate all algorithmic findings with clinical observation and patient history before management decisions.')
  return recs
}

function buildResearcherRecommendations(events: any[], mcList: string[], qualityScore: number, probSummary: any): string[] {
  const recs: string[] = []
  if (mcList.length > 0) recs.push(`Missing channel impact: ${mcList.length} channel(s) (${mcList.join(', ')}) excluded from spatial computation — evaluate potential bias on lateralisation metrics.`)
  const pMax = probSummary?.max || 0
  if (pMax > 0) recs.push(`Threshold sensitivity: re-run with detection threshold ±10% to assess detection robustness for this recording (current peak: ${pMax.toFixed(4)}).`)
  if (events.length > 0) {
    const onset = events[0].onset_sec || 0
    const offset = events[0].offset_sec || 0
    recs.push(`Raw probability trace should be inspected between ${Math.max(0, Math.round(Number(onset)) - 100)}s and ${offset}s for boundary precision analysis.`)
  }
  recs.push('Attribution method was gradient-based feature importance. Consider SHAP comparison for cross-method validation on flagged segments.')
  if (qualityScore < 0.7) recs.push(`Signal quality score ${qualityScore.toFixed(3)} is below the 0.7 reliability threshold — flag this recording for model confidence caveat.`)
  recs.push('Consider evaluating this recording against the declared model metrics (sensitivity 73.3%, FP/hr 0.98) as a calibration data point.')
  return recs
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Role-Aware Medical PDF Builder (pdf-lib)                       */
/* ═══════════════════════════════════════════════════════════════ */

class MedicalPDFBuilder {
  private doc: PDFDocument
  private page: any
  private font: any
  private bold: any
  private y: number
  private pageNum: number
  private width = 612
  private height = 792
  private mx = 48
  private contentW: number
  private role: 'patient' | 'clinician' | 'researcher'
  private extras: { logoImage?: any; timelineImage?: any; heatmapImage?: any } = {}

  constructor(doc: PDFDocument, font: any, bold: any, role: 'patient' | 'clinician' | 'researcher') {
    this.doc = doc
    this.font = font
    this.bold = bold
    this.contentW = this.width - this.mx * 2
    this.pageNum = 0
    this.page = null as any
    this.y = 0
    this.role = role
  }

  private newPage() {
    this.page = this.doc.addPage([this.width, this.height])
    this.pageNum++
    this.y = this.height - 36
    if (this.pageNum > 1) {
      this.page.drawRectangle({ x: this.mx, y: this.height - 30, width: this.contentW, height: 2, color: ACCENT_TEAL })
      const contTitle = this.role !== 'researcher' ? 'NEUROSENTINEL AI — CLINICAL EEG ANALYSIS REPORT (continued)' : 'NEUROSENTINEL AI — EEG PIPELINE ANALYSIS (continued)'
      this.page.drawText(contTitle, { x: this.mx, y: this.height - 26, size: 6.5, font: this.font, color: TEXT_LIGHT })
      this.y = this.height - 50
    }
  }

  private ensureSpace(needed: number) {
    if (this.y - needed < 62) {
      this.drawFooter()
      this.newPage()
    }
  }

  private drawFooter() {
    if (!this.page) return
    this.page.drawLine({ start: { x: this.mx, y: 42 }, end: { x: this.width - this.mx, y: 42 }, thickness: 0.4, color: BORDER_LIGHT })
    this.page.drawText('NeuroSentinel AI — Decision Support Only. Not a Medical Diagnosis.', {
      x: this.mx, y: 30, size: 6.5, font: this.font, color: TEXT_LIGHT,
    })
    this.page.drawText(`Page ${this.pageNum}`, {
      x: this.width - this.mx - 30, y: 30, size: 6.5, font: this.font, color: TEXT_LIGHT,
    })
  }

  private drawChartImage(image: any, caption: string, maxH = 185) {
    if (!image) return
    const dims = image.scale(1)
    const targetW = this.contentW
    const scale = Math.min(targetW / dims.width, maxH / dims.height)
    const drawW = dims.width * scale
    const drawH = dims.height * scale
    const offsetX = this.mx + (this.contentW - drawW) / 2

    this.ensureSpace(drawH + 28)
    this.y -= 4
    this.page.drawText(caption, {
      x: this.mx + 10, y: this.y, size: 7.5, font: this.bold, color: TEXT_MEDIUM,
    })
    this.y -= 6
    this.page.drawImage(image, {
      x: offsetX,
      y: this.y - drawH,
      width: drawW,
      height: drawH,
    })
    this.y -= drawH + 10
  }

  private drawHeader(filename: string, createdAt: string) {
    this.newPage()
    this.page.drawRectangle({ x: 0, y: this.height - 84, width: this.width, height: 84, color: HEADER_BG })
    this.page.drawRectangle({ x: 0, y: this.height - 88, width: this.width, height: 4, color: ACCENT_TEAL })

    // Logo — 28×28 nudged down so it sits beside "NEUROSENTINEL AI" text
    const logoSize = 28
    if (this.extras.logoImage) {
      this.page.drawImage(this.extras.logoImage, {
        x: this.mx,
        y: this.height - 47,   // moved down 7pt from previous -40
        width: logoSize,
        height: logoSize,
      })
    }
    const textX = this.extras.logoImage ? this.mx + logoSize + 8 : this.mx


    this.page.drawText('NEUROSENTINEL AI', { x: textX, y: this.height - 32, size: 16, font: this.bold, color: WHITE })
    this.page.drawText('Seizure Clinical Operations & Understanding Tool  |  Automated EEG Analysis Platform', {
      x: textX, y: this.height - 46, size: 7.5, font: this.font, color: HEADER_SUBTITLE,
    })

    const rightTitle = this.role !== 'researcher' ? 'CLINICAL EEG ANALYSIS REPORT' : 'EEG PIPELINE ANALYSIS REPORT'
    this.page.drawText(rightTitle, {
      x: this.width - this.mx - this.bold.widthOfTextAtSize(rightTitle, 12),
      y: this.height - 32, size: 12, font: this.bold, color: WHITE,
    })
    this.page.drawText(`Generated: ${createdAt}`, {
      x: this.width - this.mx - this.font.widthOfTextAtSize(`Generated: ${createdAt}`, 7.5),
      y: this.height - 46, size: 7.5, font: this.font, color: HEADER_SUBTITLE,
    })
    this.page.drawText(filename, {
      x: this.width - this.mx - this.font.widthOfTextAtSize(filename, 7),
      y: this.height - 58, size: 7, font: this.font, color: HEADER_SUBTITLE,
    })

    this.y = this.height - 100
  }

  private sectionHeader(title: string, number: string) {
    this.ensureSpace(42)
    this.y -= 14
    this.page.drawRectangle({ x: this.mx, y: this.y - 6, width: this.contentW, height: 24, color: SECTION_BG })
    this.page.drawRectangle({ x: this.mx, y: this.y - 6, width: 4, height: 24, color: ACCENT_TEAL })
    this.page.drawText(`${number}   ${title}`.toUpperCase(), {
      x: this.mx + 12, y: this.y, size: 9.5, font: this.bold, color: ACCENT_TEAL,
    })
    this.y -= 28
  }

  private fieldRow(label: string, value: string, boldVal = false) {
    this.ensureSpace(18)
    this.page.drawLine({ start: { x: this.mx + 6, y: this.y - 6 }, end: { x: this.mx + this.contentW - 6, y: this.y - 6 }, thickness: 0.3, color: BORDER_LIGHT })
    this.page.drawText(label, { x: this.mx + 10, y: this.y, size: 8, font: this.font, color: TEXT_LIGHT })
    const valFont = boldVal ? this.bold : this.font
    const maxW = this.contentW - 172
    const lines = wrapText(String(value || '—'), valFont, 9, maxW)
    for (let i = 0; i < lines.length; i++) {
      this.page.drawText(lines[i], { x: this.mx + 166, y: this.y - (i * 13), size: 9, font: valFont, color: TEXT_DARK })
    }
    this.y -= 17 + Math.max(0, (lines.length - 1) * 13)
  }

  private textBlock(text: string, fontSize = 8.5, color = TEXT_MEDIUM) {
    this.ensureSpace(16)
    const maxW = this.contentW - 18
    const lines = wrapText(text, this.font, fontSize, maxW)
    for (const line of lines) {
      this.ensureSpace(13)
      this.page.drawText(line, { x: this.mx + 10, y: this.y, size: fontSize, font: this.font, color })
      this.y -= fontSize + 4
    }
  }

  private riskBadge(risk: string) {
    this.ensureSpace(32)
    const color = riskColor(risk)
    const label = risk.toUpperCase()
    const w = this.bold.widthOfTextAtSize(label, 11) + 24
    this.page.drawRectangle({ x: this.mx + 10, y: this.y - 6, width: w, height: 22, color })
    this.page.drawText(label, { x: this.mx + 22, y: this.y - 1, size: 11, font: this.bold, color: WHITE })
    this.y -= 30
  }

  private numberedItem(num: number, text: string) {
    this.ensureSpace(28)
    this.page.drawCircle({ x: this.mx + 18, y: this.y + 2, size: 7, color: ACCENT_TEAL })
    this.page.drawText(String(num), { x: this.mx + 15, y: this.y - 1, size: 6.5, font: this.bold, color: WHITE })
    const maxW = this.contentW - 44
    const lines = wrapText(text, this.font, 8, maxW)
    for (const line of lines) {
      this.ensureSpace(13)
      this.page.drawText(line, { x: this.mx + 32, y: this.y, size: 8, font: this.font, color: TEXT_MEDIUM })
      this.y -= 12
    }
    this.y -= 4
  }

  /* ─ Native server-side chart: Probability Timeline ─ */
  private drawNativeTimeline(probTimeline: any[], events: any[], thresholdHigh?: number) {
    if (!Array.isArray(probTimeline) || probTimeline.length < 2) return
    const chartH = 110
    const chartW = this.contentW - 20
    const chartX = this.mx + 10
    const padT = 6; const padB = 18; const plotH = chartH - padT - padB
    this.ensureSpace(chartH + 30)
    this.y -= 6
    const top = this.y; const bottom = this.y - chartH
    const plotTop = top - padT; const plotBottom = bottom + padB
    // Background
    this.page.drawRectangle({ x: chartX, y: bottom, width: chartW, height: chartH, color: rgb(0.961, 0.992, 0.988) })
    this.page.drawLine({ start: { x: chartX, y: bottom }, end: { x: chartX + chartW, y: bottom }, thickness: 0.5, color: BORDER_LIGHT })
    this.page.drawLine({ start: { x: chartX, y: bottom }, end: { x: chartX, y: top }, thickness: 0.5, color: BORDER_LIGHT })
    // Grid & Y labels
    for (let i = 0; i <= 4; i++) {
      const gy = plotBottom + (i / 4) * plotH
      this.page.drawLine({ start: { x: chartX, y: gy }, end: { x: chartX + chartW, y: gy }, thickness: 0.25, color: BORDER_LIGHT })
      this.page.drawText(`${(i * 25)}%`, { x: chartX - 16, y: gy - 2, size: 5, font: this.font, color: TEXT_LIGHT })
    }
    const getT = (p: any) => typeof p === 'object' ? (p.time ?? p[0] ?? 0) : 0
    const getP = (p: any) => typeof p === 'object' ? (p.seizure_probability ?? p.probability ?? p[1] ?? 0) : 0
    const times = probTimeline.map(getT); const probs = probTimeline.map(getP)
    const minT = Math.min(...times); const maxT = Math.max(...times); const tRange = maxT - minT || 1
    const toX = (t: number) => chartX + ((t - minT) / tRange) * chartW
    const toY = (p: number) => plotBottom + Math.min(Math.max(p, 0), 1) * plotH
    // Event zones
    for (const ev of events) {
      const st = ev.start_time ?? ev.start ?? 0; const et = ev.end_time ?? ev.end ?? st + 30
      const x1 = toX(st); const x2 = toX(et)
      if (x2 > x1 + 0.5) this.page.drawRectangle({ x: x1, y: plotBottom, width: x2 - x1, height: plotH, color: rgb(0.992, 0.863, 0.863), opacity: 0.7 })
    }
    // Threshold line
    if (thresholdHigh != null && thresholdHigh > 0 && thresholdHigh <= 1) {
      const ty = toY(thresholdHigh)
      this.page.drawLine({ start: { x: chartX, y: ty }, end: { x: chartX + chartW, y: ty }, thickness: 0.75, color: RISK_ORANGE, dashArray: [4, 2] })
      this.page.drawText(`${(thresholdHigh * 100).toFixed(0)}% threshold`, { x: chartX + 2, y: ty + 2, size: 5, font: this.font, color: RISK_ORANGE })
    }
    // Probability line
    for (let i = 1; i < probTimeline.length; i++) {
      const col = probs[i] >= (thresholdHigh ?? 0.5) ? RISK_RED : ACCENT_TEAL
      this.page.drawLine({ start: { x: toX(times[i - 1]), y: toY(probs[i - 1]) }, end: { x: toX(times[i]), y: toY(probs[i]) }, thickness: 1, color: col })
    }
    // X axis labels
    for (let i = 0; i <= 4; i++) {
      const t = minT + (i / 4) * tRange; const lx = toX(t)
      const mins = Math.floor(t / 60); const secs = Math.floor(t % 60)
      const label = mins > 0 ? `${mins}m${secs.toString().padStart(2, '0')}s` : `${Math.round(t)}s`
      this.page.drawText(label, { x: lx - 8, y: bottom - 10, size: 5, font: this.font, color: TEXT_LIGHT })
    }
    // Legend
    this.page.drawLine({ start: { x: chartX + chartW - 62, y: top - 6 }, end: { x: chartX + chartW - 50, y: top - 6 }, thickness: 1.5, color: ACCENT_TEAL })
    this.page.drawText('Seizure Prob.', { x: chartX + chartW - 48, y: top - 9, size: 5, font: this.font, color: TEXT_MEDIUM })
    this.y -= chartH + 12
  }

  /* ─ Native server-side chart: Channel Importance Bars ─ */
  private drawNativeChannelBars(channels: [string, number][]) {
    const rows = channels.slice(0, 10)
    if (rows.length === 0) return
    const barH = 13; const gap = 3; const labelW = 32
    const chartW = this.contentW - 20; const chartX = this.mx + 10
    const totalH = rows.length * (barH + gap) + 16
    this.ensureSpace(totalH + 16)
    this.y -= 6
    // Lobe colours (by first letter of channel name)
    const lobeCol: Record<string, ReturnType<typeof rgb>> = {
      F: rgb(0.255, 0.412, 0.882), T: ACCENT_TEAL, P: rgb(0.576, 0.173, 0.729),
      O: rgb(0.094, 0.620, 0.294), C: RISK_ORANGE,
    }
    for (const [ch, score] of rows) {
      const lobe = ch.replace(/[0-9z]/gi, '')[0]?.toUpperCase() ?? 'C'
      const barColor = lobeCol[lobe] ?? ACCENT_TEAL
      const fillW = (chartW - labelW - 48) * Math.min(score, 1)
      this.page.drawText(ch.padEnd(4), { x: chartX, y: this.y + 2, size: 7, font: this.bold, color: TEXT_MEDIUM })
      this.page.drawRectangle({ x: chartX + labelW, y: this.y, width: chartW - labelW - 48, height: barH, color: SECTION_BG })
      if (fillW > 0) this.page.drawRectangle({ x: chartX + labelW, y: this.y, width: fillW, height: barH, color: barColor, opacity: 0.85 })
      this.page.drawText(`${(score * 100).toFixed(1)}%`, { x: chartX + labelW + fillW + 4, y: this.y + 2, size: 6, font: this.font, color: TEXT_MEDIUM })
      this.y -= barH + gap
    }
    this.y -= 8
  }

  async build(report: any, reportJson: any, userProfile?: { email?: string; role?: string } | null, extras?: { logoPng?: Buffer; timelinePng?: Buffer; heatmapPng?: Buffer }) {

    // Embed chart images provided by client
    if (extras?.logoPng) {
      try { this.extras.logoImage = await this.doc.embedJpg(extras.logoPng) } catch {
        try { this.extras.logoImage = await this.doc.embedPng(extras.logoPng) } catch {}
      }
    }
    if (extras?.timelinePng) {
      try { this.extras.timelineImage = await this.doc.embedPng(extras.timelinePng) } catch {}
    }
    if (extras?.heatmapPng) {
      try { this.extras.heatmapImage = await this.doc.embedPng(extras.heatmapPng) } catch {}
    }

    const role = this.role
    const cr = reportJson?.clinical_report || {}
    const meta = cr.meta || {}
    const sq = cr.signal_quality || {}
    const summary = cr.summary || {}
    const events: any[] = cr.events || reportJson?.events || []
    const modelOutputs = reportJson?.model_outputs || {}
    const quality = reportJson?.quality || {}
    const explainability = reportJson?.explainability || {}
    const rawMeta = reportJson?.metadata || {}
    const probSummary = modelOutputs?.probability_summary || {}
    const probTimeline: any[] = Array.isArray(modelOutputs?.probability_timeline) ? modelOutputs.probability_timeline : []
    const thresholdHigh: number | undefined = typeof modelOutputs?.threshold_high === 'number' ? modelOutputs.threshold_high : undefined

    const riskLevel = summary.overall_risk || reportJson?.risk_level || report.risk_level || 'Unknown'
    const qualityGrade = sq.grade || reportJson?.quality_grade || report.quality_grade || 'Unknown'
    const qualityScore = sq.score || reportJson?.quality_score || '—'
    const filename = report.filename || reportJson?.file_name || 'EEG Report'
    const resultLabel = report.result_label || reportJson?.result_label || 'Unknown'
    const confidence = typeof report.confidence_score === 'number' ? report.confidence_score : 0
    const durationMin = typeof report.duration_minutes === 'number' ? report.duration_minutes : 0
    const earlyWarning = !!(summary.early_warning || reportJson?.early_warning)
    const seFlag = !!(summary.status_epilepticus || reportJson?.se_flag)
    const missingChannels = sq.missing_channels || reportJson?.missing_channels || quality?.missing_channels || []
    const mcList = Array.isArray(missingChannels) ? missingChannels.map(String) : []

    // Top channels
    const topChDetail: [string, number][] = Array.isArray(explainability.top_channels)
      ? explainability.top_channels.map((c: any) => [String(c[0]), Number(c[1])])
      : []
    const tcStr = topChDetail.slice(0, 3).map(([ch, sc]) => `${ch} (${sc.toFixed(3)})`).join(', ') || 'unavailable'
    const topRegions = explainability.top_regions || reportJson?.top_regions || []
    const nMapped = rawMeta?.n_mapped || (22 - mcList.length)

    const pMean = Number(probSummary.mean || 0)
    const pMedian = Number(probSummary.median || 0)
    const pP99 = Number(probSummary.p99 || 0)
    const pMax = Number(probSummary.max || 0)

    const createdAt = report.created_at ? new Date(report.created_at).toLocaleString() : 'Unknown'

    // Build proper NS- Report ID (SHA-256 hash)
    const uidSrc = `${filename}:${createdAt}`
    const reportUid = createHash('sha256').update(uidSrc).digest('hex').slice(0, 8).toUpperCase()



    // ─ HEADER ─
    this.drawHeader(filename, createdAt)

    // ═══════════════ §0 REPORT INFORMATION ═══════════════
    if (role === 'patient') {
      this.sectionHeader('Report Information', '§0')
      this.fieldRow('Report ID', `NS-${reportUid}`)
      this.fieldRow('EEG File', filename)

      this.fieldRow('Report Date', createdAt)
      if (userProfile?.email) this.fieldRow('Registered Email', userProfile.email)
      this.fieldRow('User Role', displayRoleLabel(userProfile?.role || undefined))
      this.y -= 4
      this.textBlock('This report is intended to be shared with your treating clinician or neurologist for professional review. Please bring a copy of this report to your next appointment.', 7.5, TEXT_LIGHT)
    } else if (role === 'clinician') {
      this.sectionHeader('Report Information', '§0')
      this.fieldRow('Report ID', `NS-${reportUid}`)
      this.fieldRow('EEG File', filename)

      this.fieldRow('Report Date', createdAt)
      this.fieldRow('Referring Clinician', 'Per institutional records')
      this.fieldRow('Institution', 'Per institutional records')
      this.y -= 4
      this.textBlock('Patient-identifiable information has been restricted. Cross-reference with your clinical records for full patient identification.', 7.5, TEXT_LIGHT)
    } else {
      this.sectionHeader('Pipeline Run Information', '§0')
      this.fieldRow('Report ID', `NS-${reportUid}`)
      this.fieldRow('EDF Filename', filename)
      this.fieldRow('Dataset Source', inferDatasetSource(filename))

      this.fieldRow('Pipeline Version', meta.tool || 'NeuroSentinel AI v4')
      this.fieldRow('Run Timestamp', createdAt)
    }

    // ═══════════════ FLAGS SUMMARY ═══════════════
    const activeFlags: string[] = []
    if (seFlag) activeFlags.push('STATUS EPILEPTICUS: Prolonged seizure activity detected. Immediate action may be required.')
    if (confidence > 0 && confidence < 70) activeFlags.push(`LOW CONFIDENCE: Model confidence (${confidence.toFixed(1)}%) is below the 70% reliability threshold. Interpret with additional caution.`)
    if (durationMin > 0 && durationMin < 20) activeFlags.push(`SHORT RECORDING: Duration (${durationMin.toFixed(1)} min) is below the recommended 20-minute minimum for reliable detection.`)
    if (earlyWarning) activeFlags.push('EARLY WARNING: Pre-ictal activity gradient detected before seizure onset.')

    if (activeFlags.length > 0) {
      this.ensureSpace(24 + activeFlags.length * 16)
      this.y -= 8
      const boxH = 22 + activeFlags.length * 14
      this.page.drawRectangle({ x: this.mx, y: this.y - boxH + 16, width: this.contentW, height: boxH, color: rgb(1, 0.973, 0.882), borderColor: rgb(0.8, 0.4, 0), borderWidth: 0.8 })
      this.page.drawText('WARNING FLAGS SUMMARY', { x: this.mx + 10, y: this.y + 2, size: 8, font: this.bold, color: rgb(0.8, 0.4, 0) })
      this.y -= 14
      for (const flag of activeFlags) {
        this.page.drawText(`- ${flag}`, { x: this.mx + 14, y: this.y, size: 7.5, font: this.font, color: rgb(0.545, 0.251, 0) })
        this.y -= 12
      }
      this.y -= 6
    }

    // ═══════════════ §1 RECORDING INFORMATION ═══════════════
    this.sectionHeader('Recording Information', '§1')
    this.fieldRow('Filename', filename)
    this.fieldRow('Result', resultLabel, true)
    const confLabel = confidenceDescriptor(confidence).toUpperCase()
    const confStr = confidence
      ? (confidence < 70 ? `${confidence.toFixed(1)}% (${confLabel} — interpret with caution)` : `${confidence.toFixed(1)}% (${confLabel})`)
      : 'Unknown'
    this.fieldRow('Model Confidence', confStr, confidence > 0 && confidence < 70)
    this.fieldRow('Duration Analysed', durationMin ? `${durationMin.toFixed(1)} min` : 'Unknown')
    this.fieldRow('Analysis Tool', meta.tool || 'NeuroSentinel AI v4')
    if (rawMeta.sampling_rate_original) this.fieldRow('Original Sampling Rate', `${rawMeta.sampling_rate_original} Hz`)
    if (rawMeta.sampling_rate_processed) this.fieldRow('Processed Sampling Rate', `${rawMeta.sampling_rate_processed} Hz`)
    if (rawMeta.montage_type) this.fieldRow('Montage', rawMeta.montage_type)
    if (rawMeta.n_mapped) this.fieldRow('Channels Mapped', `${rawMeta.n_mapped} / 22`)
    if (rawMeta.n_windows) this.fieldRow('Analysis Windows', String(rawMeta.n_windows))

    if (role === 'researcher') {
      this.fieldRow('Window Size', '4 seconds (1024 samples @ 256 Hz)')
      this.fieldRow('Stride (background)', '4 seconds')
      this.fieldRow('Stride (seizure candidate)', '1 second')
      this.fieldRow('Normalisation', 'Per-channel z-score within window')
      if (rawMeta.inference_mode) this.fieldRow('Inference Mode', String(rawMeta.inference_mode))
    }

    // ═══════════════ §2 SIGNAL QUALITY ═══════════════
    this.sectionHeader('Signal Quality Assessment', '§2')
    this.fieldRow('Quality Grade', String(qualityGrade), true)
    this.fieldRow('Quality Score', `${qualityScore} / 1.0`)
    this.fieldRow('Missing Channels', fmtMissing(missingChannels))
    if (quality.mean_noise_ratio != null) this.fieldRow('Mean Noise Ratio', Number(quality.mean_noise_ratio).toFixed(4))
    if (quality.n_windows_assessed) this.fieldRow('Windows Assessed', String(quality.n_windows_assessed))

    if ((role === 'clinician' || role === 'researcher') && mcList.length > 0) {
      this.y -= 4
      this.textBlock(`Excluded channels: ${mcList.join(', ')}. These were absent from the source file and excluded from all spatial feature computation and channel importance ranking.`, 7.5, TEXT_LIGHT)
    }

    // ═══════════════ §3 SCOUT SUMMARY ═══════════════
    const sectionTitle = role !== 'researcher' ? 'SCOUT Analysis Summary' : 'SCOUT Pipeline Analysis Summary'
    this.sectionHeader(sectionTitle, '§3')

    if (role !== 'researcher') this.riskBadge(riskLevel)

    // Generate the narrative
    let narrative: string
    if (role === 'patient') {
      narrative = buildPatientNarrative(filename, durationMin, events, qualityGrade, earlyWarning, seFlag, confidence)
    } else if (role === 'researcher') {
      narrative = buildResearcherNarrative(filename, durationMin, events, qualityGrade, qualityScore, earlyWarning, topChDetail, tcStr, mcList, nMapped, pMean, pMedian, pP99, pMax, rawMeta)
    } else {
      narrative = buildClinicianNarrative(filename, durationMin, events, qualityGrade, qualityScore, riskLevel, earlyWarning, seFlag, topChDetail, tcStr, mcList, pMean, pMedian, pMax, confidence)
    }
    this.textBlock(narrative, 8.5)

    // Supplementary stats
    this.y -= 6
    this.fieldRow('Seizure Events Detected', String(summary.total_events ?? events.length ?? report.event_count ?? 0), true)
    this.fieldRow('Overall Result', resultLabel, true)
    this.fieldRow('Early Warning Signal', earlyWarning ? 'Yes — Pre-ictal trend detected' : 'No')
    let sefText: string
    if (role === 'patient' && seFlag) {
      sefText = 'Yes — EMERGENCY: Call 999/911/112 if seizure is ongoing. Attend A&E immediately.'
    } else if (role === 'clinician' && seFlag) {
      sefText = 'Yes — Initiate institutional SE protocol. Consider first-line benzodiazepine.'
    } else if (role === 'researcher') {
      sefText = `${seFlag ? 'Yes' : 'No'} (duration heuristic threshold: 300s)`
    } else {
      sefText = seFlag ? 'Yes — URGENT' : 'No'
    }
    this.fieldRow('Status Epilepticus Flag', sefText)

    if (probSummary && Object.keys(probSummary).length > 0) {
      this.fieldRow('Probability (mean/median/p99/max)',
        `${probSummary.mean ?? '?'} / ${probSummary.median ?? '?'} / ${probSummary.p99 ?? '?'} / ${probSummary.max ?? '?'}`)

      // Confidence reconciliation note for all roles
      if (events.length > 0 && pMax > 0) {
        const confRec = confidence
        if (Math.abs(pMax * 100 - confRec) > 5) {
          this.y -= 4
          if (role === 'patient') {
            this.textBlock(
              `Note: You may notice two different numbers — the model's peak reading (${pMax.toFixed(4)}) and the overall confidence (${confRec.toFixed(1)}%). The peak is the highest single measurement at one point in time, while the confidence score averages across the entire episode. Both are normal outputs of the analysis.`,
              7.5, TEXT_LIGHT)
          } else {
            this.textBlock(
              `Note: Model confidence (${confRec.toFixed(1)}%) reflects the mean probability across the highest-confidence event, while probability max (${pMax.toFixed(4)}) is the single peak window output. These differ because confidence averages over the entire event duration, smoothing out transient spikes.`,
              7, TEXT_LIGHT)
          }
        }
      }
    }

    // CAUTION block if confidence < 70%
    if (confidence > 0 && confidence < 70) {
      this.ensureSpace(36)
      this.y -= 4
      this.page.drawRectangle({ x: this.mx + 6, y: this.y - 18, width: this.contentW - 12, height: 30, color: rgb(1, 0.953, 0.878), borderColor: rgb(0.902, 0.318, 0), borderWidth: 0.6 })
      this.page.drawText('CAUTION', { x: this.mx + 14, y: this.y, size: 7.5, font: this.bold, color: rgb(0.902, 0.318, 0) })
      this.page.drawText(`Model confidence (${confidence.toFixed(1)}%) is below 70%. Results should be interpreted with additional clinical caution.`, { x: this.mx + 60, y: this.y, size: 7, font: this.font, color: rgb(0.545, 0.251, 0) })
      this.y -= 28
    }

    // LIMITATION block if recording duration < 20 minutes
    if (durationMin > 0 && durationMin < 20) {
      this.ensureSpace(36)
      this.y -= 4
      this.page.drawRectangle({ x: this.mx + 6, y: this.y - 18, width: this.contentW - 12, height: 30, color: rgb(0.89, 0.949, 0.992), borderColor: rgb(0.082, 0.396, 0.753), borderWidth: 0.6 })
      this.page.drawText('LIMITATION', { x: this.mx + 14, y: this.y, size: 7.5, font: this.bold, color: rgb(0.082, 0.396, 0.753) })
      const limText = role === 'patient'
        ? `This recording was only ${durationMin.toFixed(1)} min. Longer recordings (20-60 min) provide more reliable results.`
        : role === 'clinician'
          ? `Recording duration (${durationMin.toFixed(1)} min) below 20-min minimum. Negative results carry reduced sensitivity.`
          : `Duration ${durationMin.toFixed(1)} min is below clinical thresholds (20+ min). Sensitivity estimates may not apply.`
      this.page.drawText(limText, { x: this.mx + 72, y: this.y, size: 7, font: this.font, color: rgb(0.051, 0.278, 0.631) })
      this.y -= 28
    }



    // ═══════════════ §4 DETECTED EVENTS ═══════════════
    this.sectionHeader(role !== 'researcher' ? 'Detected Seizure Events' : 'Detected Events', '§4')
    if (events.length === 0) {
      this.textBlock('No seizure events were detected in this recording.', 9)
    } else {
      this.ensureSpace(20)
      let cols: string[]
      if (role === 'researcher') {
        cols = ['Event', 'Onset', 'Offset', 'Duration', 'Confidence', 'Probability', 'Risk', 'Pattern', 'Windows']
      } else if (role === 'clinician') {
        cols = ['Event', 'Onset', 'Offset', 'Duration', 'Confidence', 'Probability', 'Risk', 'Pattern', 'Onset Zone']
      } else {
        cols = ['Event', 'Onset', 'Offset', 'Duration', 'Confidence', 'Probability', 'Risk', 'Pattern']
      }
      const colW = this.contentW / cols.length
      this.page.drawRectangle({ x: this.mx, y: this.y - 5, width: this.contentW, height: 18, color: rgb(0.878, 0.898, 0.925) })
      for (let i = 0; i < cols.length; i++) {
        this.page.drawText(cols[i].toUpperCase(), { x: this.mx + i * colW + 4, y: this.y, size: 7, font: this.bold, color: TEXT_DARK })
      }
      this.y -= 20

      for (const ev of events.slice(0, 15)) {
        this.ensureSpace(16)
        this.page.drawLine({ start: { x: this.mx, y: this.y - 4 }, end: { x: this.mx + this.contentW, y: this.y - 4 }, thickness: 0.3, color: BORDER_LIGHT })

        const confPct = ev.confidence_pct != null ? `${ev.confidence_pct}%`
          : typeof ev.mean_probability === 'number' ? `${(ev.mean_probability * 100).toFixed(1)}%` : '?'
        const risk = String(ev.risk_level ?? '?')
        const pattern = String(ev.pattern ?? ev.pattern_type ?? '—')
        const peakP = typeof ev.peak_probability === 'number'
          ? ev.peak_probability.toFixed(4)
          : typeof ev.mean_probability === 'number'
            ? ev.mean_probability.toFixed(4)
            : ev.confidence_pct != null
              ? (Number(ev.confidence_pct) / 100).toFixed(4)
              : '-'

        let vals: string[]
        if (role === 'researcher') {
          const durSec = Number(ev.duration_sec || 0)
          const winCount = durSec > 0 ? String(Math.round(durSec / 4)) : '?'
          vals = [String(ev.id ?? ev.event_idx ?? '?'), `${ev.onset_sec ?? '?'}s`, `${ev.offset_sec ?? '?'}s`, `${ev.duration_sec ?? '?'}s`, confPct, peakP, risk, pattern, winCount]
        } else if (role === 'clinician') {
          let oz = '—'
          if (Array.isArray(ev.top_regions) && ev.top_regions.length > 0) {
            oz = ev.top_regions.slice(0, 2).join(', ')
          } else if (topChDetail.length > 0) {
            oz = regionHypothesis(topChDetail.slice(0, 3))
          }
          vals = [String(ev.id ?? ev.event_idx ?? '?'), `${ev.onset_sec ?? '?'}s`, `${ev.offset_sec ?? '?'}s`, `${ev.duration_sec ?? '?'}s`, confPct, peakP, risk, pattern, oz]
        } else {
          vals = [String(ev.id ?? ev.event_idx ?? '?'), `${ev.onset_sec ?? '?'}s`, `${ev.offset_sec ?? '?'}s`, `${ev.duration_sec ?? '?'}s`, confPct, peakP, risk, pattern]
        }

        const riskIdx = role === 'researcher' ? 6 : 5
        for (let i = 0; i < vals.length; i++) {
          const isRisk = i === riskIdx
          this.page.drawText(vals[i], {
            x: this.mx + i * colW + 4, y: this.y,
            size: 7.5,
            font: isRisk ? this.bold : this.font,
            color: isRisk ? riskColor(vals[i]) : TEXT_MEDIUM,
          })
        }
        this.y -= 16
      }
    }

    // ═══════════════ §5 BRAIN REGION & CHANNEL ANALYSIS ═══════════════
    this.sectionHeader('Brain Region & Channel Analysis', '§5')

    if (topChDetail.length > 0) {
      const chStr = topChDetail.slice(0, 5).map(([ch, sc]) => `${ch} (${sc.toFixed(3)})`).join(', ')
      this.fieldRow('Top Contributing Channels', chStr)
    } else if (reportJson?.channel_importance_summary) {
      this.fieldRow('Top Contributing Channels', reportJson.channel_importance_summary)
    }

    if (Array.isArray(topRegions) && topRegions.length > 0) {
      const regStr = topRegions.slice(0, 5).map((r: any) => Array.isArray(r) ? `${r[0]} (${Number(r[1]).toFixed(3)})` : String(r)).join(', ')
      this.fieldRow('Top Active Regions', regStr)
    }

    // Role-specific channel detail
    if (role === 'clinician' && topChDetail.length > 0) {
      this.y -= 4
      this.textBlock('Clinical Channel Mapping:', 8, ACCENT_TEAL)
      for (const [ch, sc] of topChDetail.slice(0, 8)) {
        const clinical = CHANNEL_CLINICAL_LABELS[ch] || 'Unknown Region'
        this.textBlock(`  ${ch}  ->  ${clinical}  (${sc.toFixed(4)})`, 7.5)
      }
      this.y -= 4
      this.textBlock(`Lateralisation Assessment: ${determineLat(topChDetail)}`, 8, ACCENT_TEAL)
    } else if (role === 'researcher' && topChDetail.length > 0) {
      this.y -= 4
      this.textBlock('Channel Importance Ranking (gradient-based feature importance):', 8, ACCENT_TEAL)
      for (const [ch, sc] of topChDetail.slice(0, 10)) {
        const pct = `${(sc * 100).toFixed(1)}%`
        const barLen = Math.max(1, Math.round(sc * 20))
        const bar = '|'.repeat(barLen) + ' '.repeat(20 - barLen)
        this.textBlock(`  ${ch.padEnd(8)}  [${bar}]  ${pct}  (${sc.toFixed(4)})`, 7.5)
      }
      this.y -= 4
      this.textBlock('Attribution method: gradient-based feature importance. Cross-validate with SHAP or integrated gradients for robustness.', 7, TEXT_LIGHT)
    } else if (role === 'patient' && topChDetail.length > 0) {
      this.y -= 4
      this.textBlock('Most Active Brain Signal Channels:', 8, ACCENT_TEAL)
      for (const [ch, sc] of topChDetail.slice(0, 5)) {
        const pct = `${(sc * 100).toFixed(1)}%`
        const barLen = Math.max(1, Math.round(sc * 20))
        const bar = '|'.repeat(barLen) + ' '.repeat(20 - barLen)
        this.textBlock(`  ${ch.padEnd(8)}  [${bar}]  ${pct}`, 7.5)
      }
    }



    // ═══════════════ §6 RECOMMENDATIONS ═══════════════
    let recommendations: string[]
    if (role === 'patient') {
      this.sectionHeader('What To Do Next', '§6')
      recommendations = buildPatientRecommendations(events, earlyWarning, seFlag)
    } else if (role === 'clinician') {
      this.sectionHeader('Clinical Recommendations', '§6')
      recommendations = buildClinicianRecommendations(events, riskLevel, earlyWarning, seFlag, topChDetail)
    } else {
      this.sectionHeader('Pipeline Flags & Audit Notes', '§6')
      recommendations = buildResearcherRecommendations(events, mcList, Number(qualityScore) || 0, probSummary)
    }

    if (recommendations.length === 0) {
      this.textBlock('No specific recommendations generated for this recording.', 9)
    } else {
      for (let i = 0; i < recommendations.length; i++) {
        this.numberedItem(i + 1, recommendations[i])
      }
    }

    // ═══════════════ §7 DISCLAIMER ═══════════════
    this.y -= 14
    this.ensureSpace(68)
    const disclaimerColor = role === 'researcher' ? ACCENT_TEAL : RISK_RED
    this.page.drawLine({ start: { x: this.mx, y: this.y + 10 }, end: { x: this.mx + this.contentW, y: this.y + 10 }, thickness: 1, color: disclaimerColor })
    this.y -= 2

    if (role === 'researcher') {
      this.page.drawText('RESEARCH USE ONLY', { x: this.mx + 8, y: this.y, size: 7.5, font: this.bold, color: ACCENT_TEAL })
      this.y -= 14
      const disclaimers = [
        'This output is the result of an automated ML inference pipeline intended for research evaluation and algorithm development only.',
        'It must not be used for clinical decision-making. All scores, classifications, and spatial attributions are algorithmic estimates.',
        'Heuristic labels (severity, pattern, focal/generalised) are rule-based approximations and not validated ground-truth annotations.',
      ]
      for (const line of disclaimers) {
        this.ensureSpace(12)
        this.page.drawText(line, { x: this.mx + 8, y: this.y, size: 7, font: this.font, color: ACCENT_TEAL })
        this.y -= 10
      }
    } else {
      this.page.drawText('IMPORTANT DISCLAIMER', { x: this.mx + 8, y: this.y, size: 7.5, font: this.bold, color: RISK_RED })
      this.y -= 14
      const disclaimers = [
        'This report is generated by NeuroSentinel AI, an automated decision-support tool. It does NOT constitute a medical diagnosis.',
        'All findings, risk levels, and heuristic values are algorithmic estimates and must be reviewed by a qualified neurologist.',
        'NeuroSentinel AI is intended for research and clinical decision support only.',
      ]
      for (const line of disclaimers) {
        this.ensureSpace(12)
        this.page.drawText(line, { x: this.mx + 8, y: this.y, size: 7, font: this.font, color: rgb(0.6, 0.133, 0.133) })
        this.y -= 10
      }
    }

    this.drawFooter()
  }
}

/* ═══════════════════════════════════════════════════════════════ */
/*  GET handler                                                    */
/* ═══════════════════════════════════════════════════════════════ */

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const admin = createAdminClient()

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'You need to be signed in to download reports.' }, { status: 401 })
    }

    const { data, error } = await admin
      .from('reports')
      .select('id, user_id, filename, status, summary, result_label, event_count, confidence_score, risk_level, quality_grade, duration_minutes, created_at, error_message, report_json')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
    }

    // Fetch user profile for role-aware PDF
    let userProfile: { email?: string; role?: string } | null = null
    try {
      const profile = await ensureUserProfile(supabase, user)
      userProfile = {
        email: user.email || undefined,
        role: profile.role || undefined,
      }
    } catch {
      userProfile = { email: user.email || undefined }
    }

    const role = resolveRole(userProfile)
    const report = normalizeReport(data)
    const reportJson = report.report_json
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

    const builder = new MedicalPDFBuilder(pdf, font, bold, role)

    // Read logo from public directory
    let logoPng: Buffer | undefined
    try { logoPng = readFileSync(path.join(process.cwd(), 'public', 'logo.jpeg')) } catch {}

    await builder.build(report, reportJson, userProfile, { logoPng })

    const bytes = await pdf.save()
    try {
      await admin.storage.from(REPORT_PDF_BUCKET).upload(`${user.id}/${params.id}.pdf`, Buffer.from(bytes), {
        contentType: 'application/pdf',
        upsert: true,
      })
    } catch {}

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${report.filename.replace(/\.edf$/i, '') || 'report'}-report.pdf"`,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to generate report PDF.' }, { status: 500 })
  }
}

/* ═══════════════════════════════════════════════════════════════ */
/*  POST handler — receives captured chart PNGs from client         */
/* ═══════════════════════════════════════════════════════════════ */

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const admin = createAdminClient()

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'You need to be signed in to download reports.' }, { status: 401 })
    }

    const { data, error } = await admin
      .from('reports')
      .select('id, user_id, filename, status, summary, result_label, event_count, confidence_score, risk_level, quality_grade, duration_minutes, created_at, error_message, report_json')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

    let userProfile: { email?: string; role?: string } | null = null
    try {
      const profile = await ensureUserProfile(supabase, user)
      userProfile = { email: user.email || undefined, role: profile.role || undefined }
    } catch {
      userProfile = { email: user.email || undefined }
    }

    const role = resolveRole(userProfile)
    const report = normalizeReport(data)
    const reportJson = report.report_json

    // Parse chart images from client request body
    let timelinePng: Buffer | undefined
    let heatmapPng: Buffer | undefined
    try {
      const body = await request.json()
      if (body.timelineImage) {
        const b64 = String(body.timelineImage).replace(/^data:image\/[^;]+;base64,/, '')
        timelinePng = Buffer.from(b64, 'base64')
      }
      if (body.heatmapImage) {
        const b64 = String(body.heatmapImage).replace(/^data:image\/[^;]+;base64,/, '')
        heatmapPng = Buffer.from(b64, 'base64')
      }
    } catch {}

    let logoPng: Buffer | undefined
    try { logoPng = readFileSync(path.join(process.cwd(), 'public', 'logo.jpeg')) } catch {}

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

    const builder = new MedicalPDFBuilder(pdf, font, bold, role)
    await builder.build(report, reportJson, userProfile, { logoPng, timelinePng, heatmapPng })

    const bytes = await pdf.save()
    try {
      await admin.storage.from(REPORT_PDF_BUCKET).upload(`${user.id}/${params.id}.pdf`, Buffer.from(bytes), {
        contentType: 'application/pdf',
        upsert: true,
      })
    } catch {}

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${report.filename.replace(/\.edf$/i, '') || 'report'}-report.pdf"`,
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to generate report PDF.' }, { status: 500 })
  }
}
