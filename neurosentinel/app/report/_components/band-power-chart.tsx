'use client'

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'

const BAND_COLORS: Record<string, string> = {
  delta: '#818CF8',
  theta: '#A78BFA',
  alpha: '#00F0FF',
  beta:  '#FFB800',
  gamma: '#FF3366',
}

const BAND_RANGES: Record<string, string> = {
  delta: '0.5–4 Hz',
  theta: '4–8 Hz',
  alpha: '8–13 Hz',
  beta:  '13–30 Hz',
  gamma: '30–100 Hz',
}

type Props = {
  bandPowers?: Record<string, number>
  channelReliability?: boolean[]
  artifactPercent?: number
  missingChannels?: string[]
}

export function BandPowerChart({ bandPowers, channelReliability, artifactPercent, missingChannels }: Props) {
  const bands = ['delta', 'theta', 'alpha', 'beta', 'gamma']
  const data = bands.map(band => ({
    name: band.charAt(0).toUpperCase() + band.slice(1),
    band,
    power: bandPowers?.[band] ?? 0,
    range: BAND_RANGES[band],
  }))

  const hasBandData = data.some(d => d.power > 0)

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null
    const d = payload[0].payload
    return (
      <div className="rounded-xl border px-3 py-2" style={{ background: 'rgba(10,10,15,0.95)', borderColor: 'rgba(0,240,255,0.2)', backdropFilter: 'blur(12px)' }}>
        <div className="text-[10px] font-semibold" style={{ color: BAND_COLORS[d.band] }}>{d.name}</div>
        <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{d.range}</div>
        <div className="mt-1 text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{d.power.toFixed(4)}</div>
      </div>
    )
  }

  // Standard 22 channel labels
  const CHANNELS = [
    'FP1-F7','F7-T7','T7-P7','P7-O1','FP1-F3','F3-C3','C3-P3','P3-O1',
    'FP2-F4','F4-C4','C4-P4','P4-O2','FP2-F8','F8-T8','T8-P8','P8-O2',
    'FZ-CZ','CZ-PZ','P7-T7','T7-FT9','FT9-FT10','FT10-T8',
  ]

  return (
    <div className="space-y-4">
      {/* Band Power Chart */}
      {hasBandData ? (
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="name"
                tick={{ fill: '#565670', fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                stroke="rgba(255,255,255,0.06)"
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#565670', fontSize: 9, fontFamily: "'JetBrains Mono', monospace" }}
                stroke="rgba(255,255,255,0.06)"
                tickLine={false}
                width={40}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="power" radius={[4, 4, 0, 0]} animationDuration={800}>
                {data.map((entry) => (
                  <Cell key={entry.band} fill={BAND_COLORS[entry.band] || '#565670'} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-xl border px-4 py-6" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Band power data not available.</span>
        </div>
      )}

      {/* Channel Reliability Grid */}
      <div>
        <div className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>Channel Reliability Mask</div>
        <div className="mt-2 grid grid-cols-11 gap-1">
          {CHANNELS.map((ch, i) => {
            const isReliable = channelReliability ? channelReliability[i] !== false : true
            const isMissing = missingChannels?.some(m => m.toUpperCase() === ch.toUpperCase())
            return (
              <div
                key={ch}
                className="group relative flex h-5 items-center justify-center rounded text-[6px] font-mono font-semibold transition-all"
                style={{
                  background: isMissing ? 'rgba(255,51,102,0.15)' : isReliable ? 'rgba(0,255,136,0.1)' : 'rgba(255,184,0,0.1)',
                  color: isMissing ? '#FF3366' : isReliable ? '#00FF88' : '#FFB800',
                }}
                title={`${ch}: ${isMissing ? 'Missing' : isReliable ? 'Reliable' : 'Flagged'}`}
              >
                {i + 1}
              </div>
            )
          })}
        </div>
        <div className="mt-2 flex gap-3 text-[8px]" style={{ color: 'var(--text-muted)' }}>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded" style={{ background: 'rgba(0,255,136,0.3)' }} /> Reliable</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded" style={{ background: 'rgba(255,184,0,0.3)' }} /> Flagged</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded" style={{ background: 'rgba(255,51,102,0.3)' }} /> Missing</span>
        </div>
      </div>

      {/* Quick stats */}
      <div className="flex flex-wrap gap-2">
        {artifactPercent != null ? (
          <div className="rounded-lg border px-2.5 py-1.5 text-[9px] font-mono" style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', color: 'var(--text-muted)' }}>
            Artifact: {(artifactPercent * 100).toFixed(1)}%
          </div>
        ) : null}
        {missingChannels && missingChannels.length > 0 ? (
          <div className="rounded-lg border px-2.5 py-1.5 text-[9px] font-mono" style={{ borderColor: 'rgba(255,51,102,0.1)', background: 'rgba(255,51,102,0.04)', color: '#FF3366' }}>
            Missing: {missingChannels.join(', ')}
          </div>
        ) : null}
      </div>
    </div>
  )
}
