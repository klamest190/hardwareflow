import { Maximize2, X } from 'lucide-react'

import { HeadroomRing } from './components/DashboardHeader'
import { Meter } from './components/ui/Meter'
import { useHardwareMonitor } from './hooks/useHardwareMonitor'
import { formatBitrate } from './lib/format'
import { loadColor, STATUS_COLORS } from './lib/status'

/** One labelled bar. The value is written out, so the status colour is never the only cue. */
function Row({ label, value, percent }: { label: string; value: string; percent: number | null }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-medium text-ink-2">{label}</span>
        <span className="font-semibold text-ink tabular-nums">{value}</span>
      </div>
      {percent === null ? (
        <div className="mt-1 h-1.5 rounded-full bg-surface-2" aria-hidden />
      ) : (
        <Meter className="mt-1" height={6} value={percent} color={loadColor(percent)} ariaLabel={`${label} ${value}`} />
      )}
    </div>
  )
}

/**
 * The always-on-top mini window: the numbers someone glances at while doing something
 * else. The whole surface drags the window except the two buttons. It watches the probe
 * but never pauses or resumes it — that belongs to the dashboard.
 */
export function MiniView() {
  const { snapshot, headroom, alerts } = useHardwareMonitor({ controlsProbe: false })

  if (!snapshot || !headroom) {
    return <div className="grid h-dvh place-items-center text-[11px] text-muted">Verbinde …</div>
  }

  const { cpuLoad, memory, gpus, history } = snapshot
  const memoryPercent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0
  const gpu = gpus[0]
  const latest = history[history.length - 1]
  const worst = alerts.find((alert) => alert.severity === 'critical') ?? alerts[0]

  return (
    <div className="hf-drag flex h-dvh flex-col overflow-hidden border border-hairline bg-plane px-3.5 py-3 select-none">
      <div className="flex items-center gap-2.5">
        <HeadroomRing headroom={headroom} size={30} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] leading-3 font-medium tracking-wide text-muted uppercase">Reserve</p>
          <p className="text-sm leading-5 font-semibold text-ink tabular-nums">{Math.round(headroom.percent)} % frei</p>
        </div>
        <button
          type="button"
          onClick={() => void window.hardwareflow?.showDashboard()}
          className="hf-no-drag grid size-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Dashboard öffnen"
          title="Dashboard öffnen"
        >
          <Maximize2 aria-hidden size={12} />
        </button>
        <button
          type="button"
          onClick={() => void window.hardwareflow?.closeWindow()}
          className="hf-no-drag grid size-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="Mini-Ansicht schließen"
          title="Schließen"
        >
          <X aria-hidden size={13} />
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <Row
          label="CPU"
          value={`${Math.round(cpuLoad.usagePercent)} %${cpuLoad.temperatureC !== null ? ` · ${Math.round(cpuLoad.temperatureC)} °C` : ''}`}
          percent={cpuLoad.usagePercent}
        />
        <Row label="RAM" value={`${Math.round(memoryPercent)} %`} percent={memoryPercent} />
        <Row
          label="GPU"
          value={
            gpu?.usagePercent == null
              ? 'n/v'
              : `${Math.round(gpu.usagePercent)} %${gpu.temperatureC !== null ? ` · ${Math.round(gpu.temperatureC)} °C` : ''}`
          }
          percent={gpu?.usagePercent ?? null}
        />
      </div>

      <p className="mt-auto flex items-center justify-between pt-2 text-[10px] text-muted tabular-nums">
        {worst ? (
          <span
            className="truncate font-semibold"
            style={{ color: worst.severity === 'critical' ? STATUS_COLORS.critical : STATUS_COLORS.warning }}
          >
            ⚠ {worst.title}
          </span>
        ) : (
          <>
            <span>↓ {formatBitrate(latest?.netRxBytesPerSec ?? null)}</span>
            <span>↑ {formatBitrate(latest?.netTxBytesPerSec ?? null)}</span>
          </>
        )}
      </p>
    </div>
  )
}
