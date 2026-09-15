import { Activity, Clock, FlaskConical, Monitor, Pause, Play, Radio, Server } from 'lucide-react'

import { formatUptime } from '../lib/format'
import { GRADE_META, STATUS_COLORS } from '../lib/status'
import type { HardwareSource, PerformanceScore, SystemInfo } from '../types/hardware'

interface DashboardHeaderProps {
  system: SystemInfo
  score: PerformanceScore
  source: HardwareSource
  paused: boolean
  onTogglePaused: () => void
}

/**
 * States plainly whether the numbers are measured or simulated. A monitor that cannot
 * be trusted on that point is worse than no monitor.
 */
function SourceBadge({ source, paused }: { source: HardwareSource; paused: boolean }) {
  const native = source === 'native'
  const color = native ? STATUS_COLORS.good : STATUS_COLORS.warning
  const Icon = native ? Radio : FlaskConical

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold"
      style={{ backgroundColor: `${color}1f`, color }}
      title={
        native
          ? 'Werte werden live vom System gemessen'
          : 'Kein Hardware-Zugriff im Browser — die Werte sind simuliert'
      }
    >
      <Icon aria-hidden size={11} strokeWidth={2.5} />
      {native ? (paused ? 'Live · pausiert' : 'Live-Messung') : 'Simulation'}
    </span>
  )
}

/** Compact score ring for the header — deliberately small, so the gauge stays the hero. */
function ScoreRing({ score }: { score: PerformanceScore }) {
  const meta = GRADE_META[score.grade]
  const radius = 15
  const circumference = 2 * Math.PI * radius

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-2.5">
      <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden className="-rotate-90">
        <circle cx="19" cy="19" r={radius} fill="none" stroke={`${meta.color}2e`} strokeWidth="4" />
        <circle
          cx="19"
          cy="19"
          r={radius}
          fill="none"
          stroke={meta.color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score.total / 100)}
          className="hf-score-ring"
        />
      </svg>
      <div>
        <p className="text-[11px] leading-4 font-medium tracking-wide text-muted uppercase">
          HardwareFlow Score
        </p>
        <p className="text-sm leading-5 font-semibold text-ink tabular-nums">
          {score.total}
          <span className="text-muted"> / 100</span>
          <span className="ml-2 font-medium" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </p>
      </div>
    </div>
  )
}

function MetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Server
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon aria-hidden size={14} className="shrink-0 text-muted" strokeWidth={2} />
      <span className="text-muted">{label}</span>
      <span className="font-medium text-ink-2 tabular-nums">{value}</span>
    </div>
  )
}

export function DashboardHeader({
  system,
  score,
  source,
  paused,
  onTogglePaused,
}: DashboardHeaderProps) {
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-lg bg-cpu/15 text-cpu ring-1 ring-cpu/25"
          >
            <Activity size={17} strokeWidth={2.25} />
          </span>
          <div className="flex items-baseline gap-2">
            <h1 className="text-lg leading-6 font-semibold tracking-tight text-ink">HardwareFlow</h1>
            <span className="text-xs text-muted">System Monitor</span>
          </div>
          <SourceBadge source={source} paused={paused} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <MetaItem icon={Server} label="Host" value={system.hostname} />
          <MetaItem
            icon={Monitor}
            label="OS"
            value={`${system.osName} ${system.osVersion} · ${system.architecture}`}
          />
          <MetaItem icon={Clock} label="Uptime" value={formatUptime(system.uptimeSeconds)} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onTogglePaused}
          aria-pressed={paused}
          className="flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-baseline hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cpu"
        >
          {paused ? <Play aria-hidden size={13} /> : <Pause aria-hidden size={13} />}
          {paused ? 'Fortsetzen' : 'Pausieren'}
        </button>
        <ScoreRing score={score} />
      </div>
    </header>
  )
}
