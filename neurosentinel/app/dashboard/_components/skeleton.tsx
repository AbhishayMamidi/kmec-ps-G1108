'use client'

/**
 * Skeleton loaders — shimmer placeholders that match the final layout.
 * Used instead of spinners to prevent layout shift and communicate structure.
 */

import React from 'react'

// ─── Base shimmer block ───────────────────────────────────────────────────────

export function SkeletonBlock({
  className = '',
  style = {},
}: {
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`skeleton-shimmer rounded-lg ${className}`}
      style={style}
      aria-hidden="true"
    />
  )
}

// ─── Analysis card skeleton (matches AnalysisResults layout) ──────────────────

export function SkeletonAnalysisCard() {
  return (
    <div className="space-y-5" aria-label="Loading analysis..." aria-busy="true">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <SkeletonBlock style={{ width: 140, height: 14 }} />
        <SkeletonBlock style={{ width: 72, height: 22, borderRadius: 99 }} />
      </div>

      {/* Risk summary row */}
      <div className="flex gap-3">
        <SkeletonBlock style={{ width: 56, height: 56, borderRadius: 12, flexShrink: 0 }} />
        <div className="flex-1 space-y-2">
          <SkeletonBlock style={{ width: '60%', height: 14 }} />
          <SkeletonBlock style={{ width: '80%', height: 12 }} />
          <SkeletonBlock style={{ width: '40%', height: 12 }} />
        </div>
      </div>

      {/* Metric chips row */}
      <div className="flex gap-2 flex-wrap">
        {[100, 80, 120, 90].map((w, i) => (
          <SkeletonBlock key={i} style={{ width: w, height: 28, borderRadius: 8 }} />
        ))}
      </div>

      {/* Body text lines */}
      <div className="space-y-2">
        <SkeletonBlock style={{ width: '100%', height: 12 }} />
        <SkeletonBlock style={{ width: '88%', height: 12 }} />
        <SkeletonBlock style={{ width: '72%', height: 12 }} />
      </div>

      {/* Recommendation chips */}
      <div className="space-y-2">
        <SkeletonBlock style={{ width: 110, height: 11 }} />
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-2 items-start">
            <SkeletonBlock style={{ width: 14, height: 14, borderRadius: 99, flexShrink: 0, marginTop: 2 }} />
            <SkeletonBlock style={{ width: `${60 + i * 10}%`, height: 12 }} />
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Report history card skeleton (matches AnalysisCard layout) ───────────────

export function SkeletonReportCard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="skeleton-card"
      aria-label="Loading report..."
      aria-busy="true"
      style={{
        padding: compact ? '16px 20px 16px 24px' : '24px 28px 24px 32px',
        borderLeft: '4px solid var(--border-default)',
        display: 'grid',
        gridTemplateColumns: compact ? '1.2fr 2fr 1fr' : 'minmax(200px,1.2fr) 2fr minmax(160px,1fr)',
        gap: compact ? 20 : 32,
        alignItems: 'center',
      }}
    >
      {/* Zone 1: filename + date */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SkeletonBlock style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
          <SkeletonBlock style={{ width: 120, height: 14 }} />
        </div>
        <SkeletonBlock style={{ width: 80, height: 11 }} />
        <SkeletonBlock style={{ width: 60, height: 11 }} />
      </div>

      {/* Zone 2: result */}
      <div style={{ paddingLeft: 24, borderLeft: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SkeletonBlock style={{ width: 60, height: 10 }} />
        <SkeletonBlock style={{ width: '70%', height: 16 }} />
        <SkeletonBlock style={{ width: '50%', height: 12 }} />
      </div>

      {/* Zone 3: badges */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SkeletonBlock style={{ width: 90, height: 24, borderRadius: 99 }} />
        <SkeletonBlock style={{ width: 60, height: 11 }} />
      </div>
    </div>
  )
}

// ─── Dashboard main card skeleton ─────────────────────────────────────────────

export function SkeletonDashboardCard() {
  return (
    <div
      className="clinical-card px-7 py-7"
      aria-label="Loading..."
      aria-busy="true"
    >
      {/* Section label */}
      <div className="mb-5 flex items-center justify-between">
        <div className="space-y-2">
          <SkeletonBlock style={{ width: 100, height: 11 }} />
          <SkeletonBlock style={{ width: 160, height: 14 }} />
        </div>
        <SkeletonBlock style={{ width: 80, height: 24, borderRadius: 99 }} />
      </div>
      <SkeletonAnalysisCard />
    </div>
  )
}
