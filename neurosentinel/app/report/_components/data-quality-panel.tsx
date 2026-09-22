'use client'

type Props = {
  qualityScore?: number
  qualityGrade?: string
  missingChannels?: string[]
}

function gradeColor(grade: string) {
  const g = (grade || '').toLowerCase()
  if (g === 'good' || g === 'a') return '#10B981'
  if (g === 'moderate' || g === 'b') return '#F59E0B'
  return '#EF4444'
}

export function DataQualityPanel({ qualityScore, qualityGrade, missingChannels }: Props) {
  const score = typeof qualityScore === 'number' ? qualityScore : 0
  const grade = qualityGrade || 'Unknown'
  const color = gradeColor(grade)
  const circumference = 2 * Math.PI * 38
  const strokeDashoffset = circumference - (score * circumference)

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-4">
      {/* Quality gauge */}
      <div className="relative flex h-32 w-32 items-center justify-center">
        <svg className="-rotate-90" width="128" height="128" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r="38" fill="none" stroke="#F1F5F9" strokeWidth="8" />
          <circle
            cx="64" cy="64" r="38"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-2xl font-black text-gray-900 leading-none antialiased">
            {typeof qualityScore === 'number' ? (qualityScore * 100).toFixed(0) : '—'}
          </span>
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">Score</span>
        </div>
      </div>

      <div className="text-center">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Overall Signal Quality</div>
        <div className="text-xl font-black antialiased" style={{ color }}>{grade}</div>
      </div>

      {/* Missing channels / Status indicator */}
      {missingChannels && missingChannels.length > 0 ? (
        <div className="w-full rounded-2xl border border-red-50 bg-red-50/30 px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs text-red-500 font-bold uppercase tracking-widest">⚠️ Missing Channels</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missingChannels.map(ch => (
              <span key={ch} className="rounded-md bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-red-600 shadow-sm ring-1 ring-red-100 italic">
                {ch}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-50 bg-emerald-50/50 px-4 py-1.5 shadow-sm">
          <span className="flex h-2 w-2 items-center justify-center rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">Pipeline Integrity: 100% OK</span>
        </div>
      )}
    </div>
  )
}
