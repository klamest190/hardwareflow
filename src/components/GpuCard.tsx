import { MonitorSmartphone, Sparkles } from 'lucide-react'

import { formatBytes, formatPercent } from '../lib/format'
import { loadColor } from '../lib/status'
import type { GpuInfo } from '../types/hardware'
import { Card } from './ui/Card'
import { AnimatedNumber } from './ui/AnimatedNumber'
import { Meter } from './ui/Meter'
import { NotAvailable } from './ui/NotAvailable'
import { Stat, StatGrid } from './ui/Stat'

const GPU_HUE = '#9085e9'

interface GpuCardProps {
  /** Best adapter first — the probe ranks them by available telemetry and VRAM. */
  gpus: GpuInfo[]
  className?: string
}

/**
 * GPU module. Shows the adapter worth watching and names the rest.
 *
 * Every sampled field is optional: NVIDIA cards report utilisation, VRAM, clock, power
 * and temperature through nvidia-smi, while integrated Intel/AMD GPUs typically report
 * a model name and a nominal VRAM figure and nothing else. Each reading degrades on its
 * own rather than blanking the card.
 */
export function GpuCard({ gpus, className }: GpuCardProps) {
  const gpu = gpus[0]

  if (!gpu) {
    return (
      <Card
        title="Grafik"
        subtitle="Keine GPU erkannt"
        icon={Sparkles}
        accent={GPU_HUE}
        className={className}
      >
        <p className="my-auto py-6 text-center text-xs leading-5 text-muted">
          Es konnte kein Grafikadapter ausgelesen werden.
          <br />
          Auf manchen Systemen benötigt das erweiterte Treiberrechte.
        </p>
      </Card>
    )
  }

  const others = gpus.slice(1)
  // Explicit null checks, not truthiness: an idle adapter genuinely reporting 0 bytes in
  // use is a measurement, and treating it as "unavailable" would blank a working bar.
  const vramPercent =
    gpu.vramTotalBytes !== null && gpu.vramTotalBytes > 0 && gpu.vramUsedBytes !== null
      ? (gpu.vramUsedBytes / gpu.vramTotalBytes) * 100
      : null

  return (
    <Card
      title="Grafik"
      subtitle={[gpu.vendor, gpu.model].filter(Boolean).join(' ')}
      icon={MonitorSmartphone}
      accent={GPU_HUE}
      className={className}
      action={
        <div>
          <p className="text-xl leading-6 font-semibold text-ink tabular-nums">
            {gpu.usagePercent === null ? (
              <NotAvailable reason="Dieser Adapter meldet keine Auslastung" />
            ) : (
              <>
                <AnimatedNumber value={gpu.usagePercent} digits={1} />
                <span className="ml-0.5 text-sm font-normal text-muted">%</span>
              </>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-muted tabular-nums">
            {gpu.temperatureC === null ? (gpu.integrated ? 'integriert' : 'dediziert') : `${Math.round(gpu.temperatureC)} °C`}
          </p>
        </div>
      }
    >
      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium text-ink-2">VRAM</h3>
          <span className="text-[11px] text-muted tabular-nums">
            {gpu.vramUsedBytes !== null && gpu.vramTotalBytes !== null ? (
              `${formatBytes(gpu.vramUsedBytes)} / ${formatBytes(gpu.vramTotalBytes, 0)}`
            ) : gpu.vramTotalBytes !== null ? (
              `${formatBytes(gpu.vramTotalBytes, 0)} gesamt${gpu.integrated ? ' (shared)' : ''}`
            ) : (
              <NotAvailable reason="Kein VRAM-Wert vom Treiber" />
            )}
          </span>
        </div>
        {vramPercent !== null ? (
          <Meter
            className="mt-2"
            height={8}
            value={vramPercent}
            color={loadColor(vramPercent)}
            ariaLabel={`VRAM: ${formatPercent(vramPercent)} belegt`}
          />
        ) : (
          <div className="mt-2 h-2 rounded-full bg-surface-2" aria-hidden />
        )}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium text-ink-2">GPU-Last</h3>
          <span className="text-[11px] text-muted tabular-nums">
            {gpu.usagePercent === null ? (
              <NotAvailable reason="Dieser Adapter meldet keine Auslastung" />
            ) : (
              formatPercent(gpu.usagePercent, 1)
            )}
          </span>
        </div>
        {gpu.usagePercent === null ? (
          <div className="mt-2 h-2 rounded-full bg-surface-2" aria-hidden />
        ) : (
          <Meter
            className="mt-2"
            height={8}
            value={gpu.usagePercent}
            color={loadColor(gpu.usagePercent)}
            ariaLabel={`GPU-Last: ${formatPercent(gpu.usagePercent)}`}
          />
        )}
      </div>

      <StatGrid columns={3} className="mt-4">
        <Stat
          label="Core-Takt"
          value={gpu.coreClockMhz === null ? <NotAvailable /> : gpu.coreClockMhz}
          hint={gpu.coreClockMhz === null ? undefined : 'MHz'}
        />
        <Stat
          label="Leistung"
          value={gpu.powerDrawWatts === null ? <NotAvailable /> : Math.round(gpu.powerDrawWatts)}
          hint={gpu.powerDrawWatts === null ? undefined : 'W'}
        />
        <Stat label="Treiber" value={gpu.driverVersion ?? <NotAvailable />} />
      </StatGrid>

      {others.length > 0 && (
        <div className="mt-auto border-t border-hairline pt-3">
          <h3 className="text-[11px] leading-4 font-medium tracking-wide text-muted uppercase">
            Weitere Adapter
          </h3>
          <ul className="mt-1.5 space-y-1">
            {others.map((other) => (
              <li key={other.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="truncate text-ink-2">{other.model}</span>
                <span className="shrink-0 text-muted">
                  {other.integrated ? 'integriert' : 'dediziert'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
