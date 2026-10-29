import { describeDevice, formatBytes, formatPercent } from '../lib/format'
import { loadColor } from '../lib/status'
import type { GpuInfo } from '../types/hardware'
import { Card, PanelHeading } from './ui/Card'
import { DeviceName } from './ui/DeviceName'
import { Meter } from './ui/Meter'
import { NotAvailable } from './ui/NotAvailable'
import { Stat, StatGrid } from './ui/Stat'

interface GpuCardProps {
  /** Best adapter first — the probe ranks them by available telemetry and VRAM. */
  gpus: GpuInfo[]
  className?: string
}

/** An empty track where a reading is missing, so the layout does not jump when it arrives. */
function EmptyTrack() {
  return <div className="mt-2 h-1.5 rounded-[2px] bg-surface-2" aria-hidden />
}

/**
 * GPU detail. Shows the adapter worth watching and names the rest.
 *
 * Every sampled field is optional: NVIDIA cards report utilisation, VRAM, clock, power
 * and temperature through nvidia-smi, while integrated Intel/AMD GPUs typically report
 * a model name and a nominal VRAM figure and nothing else. Each reading degrades on its
 * own rather than blanking the panel.
 */
export function GpuCard({ gpus, className }: GpuCardProps) {
  const gpu = gpus[0]

  if (!gpu) {
    return (
      <Card title="Grafik" subtitle="Keine GPU erkannt" className={className}>
        <p className="my-auto py-6 text-sm text-muted">
          Es konnte kein Grafikadapter ausgelesen werden. Auf manchen Systemen benötigt das erweiterte Treiberrechte.
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
      subtitle={<DeviceName name={describeDevice(gpu.vendor, gpu.model)} wrap />}
      className={className}
      action={
        <span className="text-xs text-muted">
          {gpu.temperatureC === null ? (gpu.integrated ? 'integriert' : 'dediziert') : `${Math.round(gpu.temperatureC)} °C`}
        </span>
      }
    >
      <PanelHeading
        aside={
          gpu.vramUsedBytes !== null && gpu.vramTotalBytes !== null ? (
            `${formatBytes(gpu.vramUsedBytes)} / ${formatBytes(gpu.vramTotalBytes, 0)}`
          ) : gpu.vramTotalBytes !== null ? (
            `${formatBytes(gpu.vramTotalBytes, 0)} gesamt${gpu.integrated ? ' (shared)' : ''}`
          ) : (
            <NotAvailable reason="Kein VRAM-Wert vom Treiber" />
          )
        }
      >
        VRAM
      </PanelHeading>
      {vramPercent !== null ? (
        <Meter className="mt-2" value={vramPercent} color={loadColor(vramPercent)} ariaLabel={`VRAM: ${formatPercent(vramPercent)} belegt`} />
      ) : (
        <EmptyTrack />
      )}

      <div className="mt-4">
        <PanelHeading
          aside={
            gpu.usagePercent === null ? (
              <NotAvailable reason="Dieser Adapter meldet keine Auslastung" />
            ) : (
              formatPercent(gpu.usagePercent, 1)
            )
          }
        >
          GPU-Last
        </PanelHeading>
        {gpu.usagePercent === null ? (
          <EmptyTrack />
        ) : (
          <Meter
            className="mt-2"
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
        <div className="mt-auto border-t border-hairline pt-4">
          <PanelHeading>Weitere Adapter</PanelHeading>
          <ul className="mt-1.5 space-y-1">
            {others.map((other) => (
              <li key={other.id} className="flex items-baseline justify-between gap-3 text-xs">
                <DeviceName name={describeDevice(other.vendor, other.model)} className="text-ink-2" />
                <span className="shrink-0 text-muted">{other.integrated ? 'integriert' : 'dediziert'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
