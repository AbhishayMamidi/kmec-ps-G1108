'use client'

import { useState } from 'react'

// 10-20 electrode positions for top-down SVG head map
// Coordinates are in a 200x200 viewBox, origin = top-left
const ELECTRODE_POSITIONS: Record<string, { x: number; y: number; label: string }> = {
  'FP1':  { x: 72,  y: 28,  label: 'Fp1' },
  'FP2':  { x: 128, y: 28,  label: 'Fp2' },
  'F7':   { x: 36,  y: 58,  label: 'F7' },
  'F3':   { x: 72,  y: 58,  label: 'F3' },
  'FZ':   { x: 100, y: 52,  label: 'Fz' },
  'F4':   { x: 128, y: 58,  label: 'F4' },
  'F8':   { x: 164, y: 58,  label: 'F8' },
  'FT9':  { x: 18,  y: 78,  label: 'FT9' },
  'FT10': { x: 182, y: 78,  label: 'FT10' },
  'T7':   { x: 22,  y: 100, label: 'T7' },
  'C3':   { x: 68,  y: 96,  label: 'C3' },
  'CZ':   { x: 100, y: 90,  label: 'Cz' },
  'C4':   { x: 132, y: 96,  label: 'C4' },
  'T8':   { x: 178, y: 100, label: 'T8' },
  'P7':   { x: 42,  y: 138, label: 'P7' },
  'P3':   { x: 74,  y: 132, label: 'P3' },
  'PZ':   { x: 100, y: 128, label: 'Pz' },
  'P4':   { x: 126, y: 132, label: 'P4' },
  'P8':   { x: 158, y: 138, label: 'P8' },
  'O1':   { x: 78,  y: 168, label: 'O1' },
  'O2':   { x: 122, y: 168, label: 'O2' },
}

// Map bipolar channel names to their electrode pair
function bipolarToElectrodes(channelName: string): [string, string] | null {
  const parts = channelName.toUpperCase().replace(/ /g, '').split('-')
  if (parts.length !== 2) return null
  return [parts[0], parts[1]]
}

function importanceToColor(value: number, max: number): string {
  const normalized = max > 0 ? Math.min(1, value / max) : 0
  // clinical Cyan -> Blue -> Indigo
  if (normalized < 0.5) {
    const t = normalized / 0.5
    const r = Math.round(165 + t * (59 - 165)) // 165 -> 59
    const g = Math.round(243 + t * (130 - 243)) // 243 -> 130
    const b = Math.round(252 + t * (246 - 252)) // 252 -> 246
    return `rgb(${r},${g},${b})`
  } else {
    const t = (normalized - 0.5) / 0.5
    const r = Math.round(59 + t * (79 - 59)) // 59 -> 79
    const g = Math.round(130 + t * (70 - 130)) // 130 -> 70
    const b = Math.round(246 + t * (229 - 246)) // 246 -> 229
    return `rgb(${r},${g},${b})`
  }
}

type Props = {
  topChannels?: [string, number][]
  channelImportance?: number[]
}

export function BrainHeatmap({ topChannels = [] }: Props) {
  const [hoveredElectrode, setHoveredElectrode] = useState<string | null>(null)

  // Build electrode importance map from bipolar channels
  const electrodeScores: Record<string, number> = {}
  let maxScore = 0

  for (const [channel, score] of topChannels) {
    const pair = bipolarToElectrodes(channel)
    if (!pair) continue
    for (const electrode of pair) {
      electrodeScores[electrode] = (electrodeScores[electrode] || 0) + score
      maxScore = Math.max(maxScore, electrodeScores[electrode])
    }
  }

  if (topChannels.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-5 py-12">
        <span className="text-xs font-semibold text-gray-400">Spatial data unavailable</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <svg viewBox="0 0 200 200" className="w-full max-w-[280px]">
        {/* Head outline */}
        <ellipse cx="100" cy="100" rx="90" ry="94" fill="none" stroke="#F1F5F9" strokeWidth="2" />
        <ellipse cx="100" cy="100" rx="88" ry="92" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="1" />
        {/* Nose indicator */}
        <path d="M 95 6 L 100 0 L 105 6" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" />
        {/* Ear indicators */}
        <path d="M 6 90 Q 0 100 6 110" fill="none" stroke="#E2E8F0" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M 194 90 Q 200 100 194 110" fill="none" stroke="#E2E8F0" strokeWidth="1.5" strokeLinecap="round" />

        {/* Electrode nodes */}
        {Object.entries(ELECTRODE_POSITIONS).map(([key, pos]) => {
          const score = electrodeScores[key] || 0
          const color = importanceToColor(score, maxScore)
          const radius = score > 0 ? 6 + (score / maxScore) * 6 : 4
          const isHovered = hoveredElectrode === key

          return (
            <g key={key}
              onMouseEnter={() => setHoveredElectrode(key)}
              onMouseLeave={() => setHoveredElectrode(null)}
              className="cursor-pointer transition-all duration-300"
            >
              {/* Glow */}
              {score > 0 ? (
                <circle cx={pos.x} cy={pos.y} r={radius + 6} fill={color} opacity={isHovered ? 0.4 : 0.2} />
              ) : null}
              {/* Node */}
              <circle
                cx={pos.x} cy={pos.y} r={radius}
                fill={score > 0 ? color : '#FFFFFF'}
                stroke={isHovered ? '#3B82F6' : (score > 0 ? 'rgba(0,0,0,0.05)' : '#E2E8F0')}
                strokeWidth={isHovered ? 2 : 1}
                className="transition-all duration-300"
              />
              {/* Label */}
              <text
                x={pos.x} y={pos.y + (isHovered ? -radius - 8 : 3)}
                textAnchor="middle"
                fontSize={isHovered ? 9 : 7}
                fill={isHovered ? '#1E293B' : (score > 0 ? '#475569' : '#94A3B8')}
                fontFamily="'JetBrains Mono', monospace"
                fontWeight={isHovered || score > 0 ? 800 : 500}
                className="pointer-events-none select-none"
              >
                {pos.label}
              </text>
              {/* Score on hover */}
              {isHovered && score > 0 ? (
                <text
                  x={pos.x} y={pos.y + radius + 12}
                  textAnchor="middle" fontSize="8"
                  fill="#2563EB" fontFamily="'JetBrains Mono', monospace" fontWeight="800"
                  className="pointer-events-none select-none"
                >
                  {(score * 10).toFixed(2)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#94A3B8]">Inactive</span>
          <div className="h-2 w-32 rounded-full border border-white bg-gradient-to-r from-cyan-100 via-blue-400 to-indigo-600 shadow-inner" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#1E293B]">High Activation</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-300">[ESTIMATED]</span>
          <div className="h-1 w-1 rounded-full bg-gray-200" />
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-300">Spatial Attribution V4</span>
        </div>
      </div>
    </div>
  )
}
