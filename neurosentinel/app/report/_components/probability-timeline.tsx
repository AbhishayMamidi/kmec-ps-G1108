'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Customized,
} from 'recharts'

/* ─── Types ─── */
type Props = {
  probabilityTimeline?: number[]
  events?: any[]
  thresholdHigh?: number
  strideSec?: number
}

type DisplayMode = 'none' | 'full' | 'compact' | 'minimal'

type EventTooltipData = {
  index: number
  x: number
  y: number
  onset: number
  offset: number
  duration: number | null
  confidence: number | null
}

/* ─── Helpers ─── */
function formatTime(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getDisplayMode(eventCount: number): DisplayMode {
  if (eventCount === 0) return 'none'
  if (eventCount <= 10) return 'full'
  if (eventCount <= 25) return 'compact'
  return 'minimal'
}

/* ─── Event Marker SVG Layer (rendered inside chart via <Customized>) ─── */
function EventMarkerLayer({
  formattedGraphicalItems,
  xAxisMap,
  yAxisMap,
  offset,
  events,
  displayMode,
  onMarkerHover,
  onMarkerLeave,
}: any) {
  if (!events?.length || displayMode === 'none') return null

  const xAxis = xAxisMap && Object.values(xAxisMap)[0] as any
  const yAxis = yAxisMap && Object.values(yAxisMap)[0] as any
  if (!xAxis || !yAxis) return null

  const xScale = xAxis.scale
  const chartTop = offset?.top ?? 20

  return (
    <g className="event-markers-layer">
      {events.map((evt: any, i: number) => {
        const midTime = ((evt.onset_sec ?? 0) + (evt.offset_sec ?? evt.onset_sec ?? 0)) / 2
        const cx = xScale(midTime)
        if (typeof cx !== 'number' || isNaN(cx)) return null

        const markerY = chartTop - 2

        if (displayMode === 'minimal') {
          // Thin vertical indicator line from top to chart area
          const chartBottom = (offset?.top ?? 20) + (offset?.height ?? 240)
          return (
            <g
              key={`marker-${i}`}
              onMouseEnter={(e) => onMarkerHover(i, e)}
              onMouseLeave={onMarkerLeave}
              style={{ cursor: 'pointer' }}
            >
              <line
                x1={cx}
                y1={chartTop}
                x2={cx}
                y2={chartBottom}
                stroke="#EF4444"
                strokeWidth={1}
                strokeOpacity={0.25}
                strokeDasharray="2 3"
              />
              {/* Small numbered dot at top */}
              <circle cx={cx} cy={markerY - 6} r={7} fill="#EF4444" />
              <text
                x={cx}
                y={markerY - 6}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#FFFFFF"
                fontSize={7}
                fontWeight={800}
              >
                {i + 1}
              </text>
            </g>
          )
        }

        if (displayMode === 'compact') {
          // Numbered circle marker — no text label
          return (
            <g
              key={`marker-${i}`}
              onMouseEnter={(e) => onMarkerHover(i, e)}
              onMouseLeave={onMarkerLeave}
              style={{ cursor: 'pointer' }}
            >
              <circle cx={cx} cy={markerY - 6} r={9} fill="#EF4444" />
              <text
                x={cx}
                y={markerY - 6}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#FFFFFF"
                fontSize={8}
                fontWeight={800}
              >
                {i + 1}
              </text>
            </g>
          )
        }

        // displayMode === 'full' — text label with alternating vertical offsets
        const isOdd = i % 2 === 1
        const labelY = markerY - (isOdd ? 18 : 6)

        return (
          <g
            key={`marker-${i}`}
            onMouseEnter={(e) => onMarkerHover(i, e)}
            onMouseLeave={onMarkerLeave}
            style={{ cursor: 'pointer' }}
          >
            {/* Connector line from label to chart top */}
            <line
              x1={cx}
              y1={labelY + 4}
              x2={cx}
              y2={chartTop}
              stroke="#EF4444"
              strokeWidth={1}
              strokeOpacity={0.2}
              strokeDasharray="2 2"
            />
            {/* Pill background */}
            <rect
              x={cx - 32}
              y={labelY - 8}
              width={64}
              height={16}
              rx={8}
              fill="#FEF2F2"
              stroke="#FECACA"
              strokeWidth={0.5}
            />
            <text
              x={cx}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#DC2626"
              fontSize={7}
              fontWeight={800}
              letterSpacing="0.05em"
            >
              EVENT {i + 1}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/* ─── Event Marker Tooltip (HTML overlay, separate from graph tooltip) ─── */
function EventTooltipOverlay({ data, containerRef }: { data: EventTooltipData | null; containerRef: React.RefObject<HTMLDivElement | null> }) {
  if (!data || !containerRef.current) return null

  const containerRect = containerRef.current.getBoundingClientRect()
  const tooltipWidth = 180

  // Position tooltip centered above marker, clamped to container bounds
  let left = data.x - tooltipWidth / 2
  const maxLeft = containerRect.width - tooltipWidth - 8
  if (left < 8) left = 8
  if (left > maxLeft) left = maxLeft

  return (
    <div
      className="absolute z-50 pointer-events-none"
      style={{
        left,
        top: Math.max(0, data.y - 100),
        width: tooltipWidth,
      }}
    >
      <div className="rounded-xl border border-red-100 bg-white/98 p-3 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[8px] font-black text-white">
            {data.index + 1}
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-red-600">
            Event #{data.index + 1}
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="font-bold text-gray-400 uppercase tracking-wide">Timestamp</span>
            <span className="font-bold font-mono text-gray-900">{formatTime(data.onset)}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="font-bold text-gray-400 uppercase tracking-wide">Duration</span>
            <span className="font-bold font-mono text-gray-900">
              {data.duration != null ? `${data.duration.toFixed(1)}s` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="font-bold text-gray-400 uppercase tracking-wide">Confidence</span>
            <span className="font-bold font-mono text-blue-600">
              {data.confidence != null ? `${(data.confidence * 100).toFixed(1)}%` : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Main Component ─── */
export function ProbabilityTimeline({ probabilityTimeline, events = [], thresholdHigh, strideSec = 1 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [hoveredEvent, setHoveredEvent] = useState<EventTooltipData | null>(null)

  const data = useMemo(() => {
    if (!probabilityTimeline?.length) return []
    return probabilityTimeline.map((p, i) => ({
      time: i * strideSec,
      probability: typeof p === 'number' ? p : 0,
    }))
  }, [probabilityTimeline, strideSec])

  const displayMode = useMemo(() => getDisplayMode(events.length), [events.length])

  const handleMarkerHover = useCallback((index: number, e: React.MouseEvent) => {
    if (!containerRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()
    const evt = events[index]
    if (!evt) return

    setHoveredEvent({
      index,
      x: e.clientX - containerRect.left,
      y: e.clientY - containerRect.top,
      onset: evt.onset_sec ?? 0,
      offset: evt.offset_sec ?? evt.onset_sec ?? 0,
      duration: evt.duration_sec ?? null,
      confidence: evt.confidence ?? evt.mean_prob ?? null,
    })
  }, [events])

  const handleMarkerLeave = useCallback(() => {
    setHoveredEvent(null)
  }, [])

  /* Empty data state */
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/30 px-5 py-12">
        <span className="text-xs font-medium text-gray-400">EEG probability data unavailable for this session.</span>
      </div>
    )
  }

  /* Determine chart top margin based on display mode */
  const chartTopMargin = displayMode === 'full' ? 36 : displayMode === 'compact' || displayMode === 'minimal' ? 24 : 20

  /* ─── Graph Tooltip (PRESERVED — Offset Time + Probability) ─── */
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.[0]) return null
    return (
      <div className="rounded-xl border border-blue-100 bg-white/95 p-3 shadow-xl backdrop-blur-md">
        <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
          Offset Time: {formatTime(label)}
        </div>
        <div className="text-lg font-black tracking-tight text-blue-600 font-mono">
          {(payload[0].value * 100).toFixed(1)}% <span className="text-[9px] font-bold text-gray-400">PROBABILITY</span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full" style={{ height: 280 + (chartTopMargin - 20) }} ref={containerRef}>
      {/* Summary badge for high event counts */}
      {displayMode === 'minimal' && (
        <div className="absolute top-0 right-0 z-10 flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 ring-1 ring-red-100">
          <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[9px] font-black text-red-700 uppercase tracking-wider">
            {events.length} Confirmed Events
          </span>
        </div>
      )}

      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: chartTopMargin, right: 10, left: -20, bottom: 4 }}>
          <defs>
            <linearGradient id="probGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="#F1F5F9" vertical={false} />
          <XAxis
            dataKey="time"
            tickFormatter={formatTime}
            tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}
            stroke="#F1F5F9"
            tickLine={false}
            axisLine={false}
            minTickGap={30}
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.5, 1.0]}
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
            tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}
            stroke="#F1F5F9"
            tickLine={false}
            axisLine={false}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#3B82F6', strokeWidth: 1, strokeDasharray: '4 4' }} />

          {/* ── Event shaded zones (Cases 2 & 3 only) ── */}
          {(displayMode === 'full' || displayMode === 'compact') &&
            events.map((evt: any, i: number) => (
              <ReferenceArea
                key={`zone-${i}`}
                x1={evt.onset_sec}
                x2={evt.offset_sec}
                fill="#EF4444"
                fillOpacity={displayMode === 'full' ? 0.08 : 0.04}
                stroke="#EF4444"
                strokeOpacity={displayMode === 'full' ? 0.2 : 0.1}
                strokeDasharray="3 3"
              />
            ))
          }

          {/* ── Minimal mode: thin vertical event lines (Case 4) ── */}
          {displayMode === 'minimal' &&
            events.map((evt: any, i: number) => {
              const midTime = ((evt.onset_sec ?? 0) + (evt.offset_sec ?? evt.onset_sec ?? 0)) / 2
              return (
                <ReferenceLine
                  key={`evtline-${i}`}
                  x={midTime}
                  stroke="#EF4444"
                  strokeOpacity={0.15}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
              )
            })
          }

          {/* ── Threshold line (PRESERVED) ── */}
          {typeof thresholdHigh === 'number' ? (
            <ReferenceLine
              y={thresholdHigh}
              stroke="#EF4444"
              strokeOpacity={0.4}
              strokeDasharray="6 4"
            >
              <text
                x="100%"
                dy={-4}
                fill="#EF4444"
                fontSize={9}
                fontWeight={700}
                textAnchor="end"
                opacity={0.6}
              >
                {`Trigger Threshold ${(thresholdHigh * 100).toFixed(0)}%`}
              </text>
            </ReferenceLine>
          ) : null}

          {/* ── Probability curve (PRESERVED) ── */}
          <Area
            type="monotone"
            dataKey="probability"
            stroke="#3B82F6"
            strokeWidth={2}
            fill="url(#probGradient)"
            dot={false}
            animationDuration={1500}
            isAnimationActive={true}
          />

          {/* ── Custom event marker layer (SVG) ── */}
          <Customized
            component={(props: any) => (
              <EventMarkerLayer
                {...props}
                events={events}
                displayMode={displayMode}
                onMarkerHover={handleMarkerHover}
                onMarkerLeave={handleMarkerLeave}
              />
            )}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* ── Event marker tooltip (HTML, independent from graph tooltip) ── */}
      <EventTooltipOverlay data={hoveredEvent} containerRef={containerRef} />
    </div>
  )
}
