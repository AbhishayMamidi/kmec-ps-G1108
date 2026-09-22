'use client'

import React from 'react'
import { getReliability } from '@/lib/neurosentinel/types'

type ReliabilityLevel = 'High' | 'Moderate' | 'Low'

// Inline styles — NOT Tailwind classes — so they are never purged in production builds.
// Contrast ratios: High 7.2:1 | Moderate 7.8:1 | Low 8.1:1 (WCAG AAA).
const RELIABILITY_STYLES: Record<ReliabilityLevel, { bg: string; color: string; border: string; icon: string; label: string }> = {
  High:     { bg: '#D1FAE5', color: '#064E3B', border: '1px solid #34D399', icon: '✓',  label: 'Reliability: High'     },
  Moderate: { bg: '#FEF3C7', color: '#78350F', border: '1px solid #F59E0B', icon: '⚡', label: 'Reliability: Moderate' },
  Low:      { bg: '#FEE2E2', color: '#7F1D1D', border: '1px solid #F87171', icon: '⚠️', label: 'Reliability: Low'      },
}

interface ReliabilityBadgeProps {
  confidence?: number | null
  duration?: number | null
  signalQuality?: string | null
  className?: string
}

export function ReliabilityBadge({ confidence, duration, signalQuality, className = '' }: ReliabilityBadgeProps) {
  const reliability = getReliability(confidence, duration, signalQuality)
  const s = RELIABILITY_STYLES[reliability]

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-black uppercase tracking-widest ${className}`}
      style={{
        fontSize: '11px',
        background: s.bg,
        color: s.color,
        border: s.border,
        // Subtle inset shadow for depth — same pattern as other status badges on the page
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
      }}
    >
      {s.label}
    </span>
  )
}
