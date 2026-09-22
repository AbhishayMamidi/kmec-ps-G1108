'use client'

type Props = {
  events: any[]
  diagnosticState?: string
}

function formatTimestamp(sec: number | undefined) {
  if (typeof sec !== 'number') return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`
}

function riskBadgeStyle(risk: string) {
  const r = (risk || '').toLowerCase()
  if (r === 'critical' || r === 'high') return { bg: '#FEF2F2', border: '#FEE2E2', text: '#EF4444' }
  if (r === 'medium' || r === 'moderate') return { bg: '#FFFBEB', border: '#FEF3C7', text: '#F59E0B' }
  if (r === 'low') return { bg: '#F0FDF4', border: '#DCFCE7', text: '#10B981' }
  return { bg: '#F9FAFB', border: '#F3F4F6', text: '#64748B' }
}

export function EventCards({ events, diagnosticState }: Props) {
  if (events.length === 0) {
    const isSuspicious = diagnosticState === 'SUSPICIOUS'

    return (
      <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50/50 px-8 py-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-gray-200 mb-4">
          <span className="text-xl">{isSuspicious ? '🔍' : '✅'}</span>
        </div>
        <h3 className="text-base font-bold text-gray-900">
          {isSuspicious ? 'No Confirmed Seizure Events' : 'No Seizure Events Detected'}
        </h3>
        <p className="mt-1 text-sm text-gray-500 max-w-[360px] mx-auto">
          {isSuspicious
            ? 'The model detected seizure-like probability patterns, but they did not meet post-processing criteria (minimum duration, sustained threshold). Clinical correlation is recommended.'
            : 'The intelligence model did not identify any abnormal epileptiform patterns in this EEG recording.'
          }
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {events.map((event: any, idx: number) => {
        const badge = riskBadgeStyle(event.risk_level || '')
        const idxDisplay = event.event_idx ?? idx + 1

        return (
          <div
            key={event.event_idx ?? idx}
            className="group relative flex flex-col overflow-hidden rounded-[24px] border border-gray-100 bg-white shadow-sm transition-all hover:shadow-md hover:border-blue-100"
          >
            <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: badge.text }} />
            
            <div className="flex flex-col p-6 sm:flex-row sm:items-center sm:justify-between gap-6">
              {/* Event ID and Basic Info */}
              <div className="flex items-center gap-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 font-mono text-lg font-black text-gray-900 ring-1 ring-inset ring-gray-100 group-hover:bg-blue-50 group-hover:text-blue-700 transition-colors">
                  {idxDisplay.toString().padStart(2, '0')}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#64748B]">Clinical Event</span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
                      style={{ background: badge.bg, color: badge.text, border: `1px solid ${badge.border}` }}
                    >
                      {event.risk_level || 'Unknown'} Risk
                    </span>
                  </div>
                  <h3 className="mt-0.5 text-base font-bold text-gray-900">Seizure Waveform Detected</h3>
                </div>
              </div>

              {/* Timing Metadata */}
              <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Start Time</span>
                  <span className="text-sm font-bold font-mono text-gray-900">{formatTimestamp(event.onset_sec)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">End Time</span>
                  <span className="text-sm font-bold font-mono text-gray-900">{formatTimestamp(event.offset_sec)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Duration</span>
                  <span className="text-sm font-bold font-mono text-blue-600">
                    {typeof event.duration_sec === 'number' ? `${event.duration_sec.toFixed(1)}s` : '—'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Probability</span>
                  <span className="text-sm font-bold font-mono text-gray-900">
                    {typeof event.peak_probability === 'number' ? event.peak_probability.toFixed(4) : (typeof event.mean_probability === 'number' ? event.mean_probability.toFixed(4) : '—')}
                  </span>
                </div>
                
                {/* Severity Score */}
                {event.severity_score != null && (
                  <div className="flex items-center gap-3 pl-4 border-l border-gray-100">
                    <div className="flex flex-col text-right">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Severity</span>
                      <span className="text-xs font-bold text-gray-600">{event.severity_score}/10 [H]</span>
                    </div>
                    <div className="relative flex h-10 w-10 items-center justify-center">
                      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="16" fill="none" stroke="#F1F5F9" strokeWidth="4" />
                        <circle
                          cx="18" cy="18" r="16" fill="none"
                          stroke={badge.text}
                          strokeWidth="4"
                          strokeDasharray={`${(event.severity_score / 10) * 100.5} 100.5`}
                          strokeLinecap="round"
                          className="transition-all duration-1000"
                        />
                      </svg>
                      <span className="absolute text-[10px] font-black" style={{ color: badge.text }}>{event.severity_score}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Tags / Sub-details */}
            {(event.pattern_type || event.focal_vs_gen || event.early_warning) && (
              <div className="flex flex-wrap gap-2 px-6 pb-5">
                {event.pattern_type && (
                  <span className="inline-flex items-center rounded-lg bg-indigo-50 px-2.5 py-1 text-[10px] font-bold text-indigo-700 ring-1 ring-inset ring-indigo-200">
                    Pattern: {event.pattern_type}
                  </span>
                )}
                {event.focal_vs_gen && (
                  <span className="inline-flex items-center rounded-lg bg-cyan-50 px-2.5 py-1 text-[10px] font-bold text-cyan-700 ring-1 ring-inset ring-cyan-200">
                    Origin: {event.focal_vs_gen}
                  </span>
                )}
                {event.early_warning && (
                  <span className="inline-flex items-center rounded-lg bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
                    ⚠️ Early Warning Triggered
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
