import { Clock, FlaskConical, Monitor, Pause, Play, Radio, Server } from 'lucide-react'

import { formatUptime } from '../lib/format'
import { loadColor, STATUS_COLORS } from '../lib/status'
import type { HardwareSource, Headroom, SystemInfo } from '../types/hardware'

interface DashboardHeaderProps {
  /** Name of the page on screen. */
  title: string
  system: SystemInfo
  headroom: Headroom
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

/**
 * Live headroom as a compact ring: how much of the machine is free right now. It sits in
 * the header on every page, apart from the score, because it answers a different
 * question — the score is what the machine *is*, the ring is what it has *left*.
 */
export function HeadroomRing({ headroom, size = 38 }: { headroom: Headroom; size?: number }) {
  const color = loadColor(100 - headroom.percent)
  const stroke = size / 9.5
  const radius = size / 2 - stroke / 2 - 0.5
  const circumference = 2 * Math.PI * radius

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={`${color}2e`} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - headroom.percent / 100)}
        className="hf-score-ring"
      />
    </svg>
  )
}

function MetaItem({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon aria-hidden size={14} className="shrink-0 text-muted" strokeWidth={2} />
      <span className="text-muted">{label}</span>
      <span className="font-medium text-ink-2 tabular-nums">{value}</span>
    </div>
  )
}

export function DashboardHeader({ title, system, headroom, source, paused, onTogglePaused }: DashboardHeaderProps) {
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl leading-7 font-semibold tracking-tight text-ink">{title}</h1>
          <SourceBadge source={source} paused={paused} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <MetaItem icon={Server} label="Host" value={system.hostname} />
          <MetaItem icon={Monitor} label="OS" value={`${system.osName} ${system.osVersion} · ${system.architecture}`} />
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

        <div className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface px-4 py-2.5">
          <HeadroomRing headroom={headroom} />
          <div>
            <p className="text-[11px] leading-4 font-medium tracking-wide text-muted uppercase">Reserve</p>
            <p
              className="text-sm leading-5 font-semibold text-ink tabular-nums"
              title={`Frei im Schnitt der letzten ${headroom.windowSeconds} s: 100 − Last von CPU, RAM${headroom.gpuPercent === null ? '' : ' und GPU'}, gewichtet`}
            >
              {Math.round(headroom.percent)} %<span className="font-normal text-muted"> frei</span>
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}
