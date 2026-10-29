import { describeDevice, formatPercent } from '../lib/format'
import { STATUS_COLORS } from '../lib/status'
import type { CpuInfo, CpuLoad, FanReading } from '../types/hardware'
import { Card, PanelHeading } from './ui/Card'
import { DeviceName } from './ui/DeviceName'
import { NotAvailable } from './ui/NotAvailable'
import { Stat, StatGrid } from './ui/Stat'

interface CpuCardProps {
  cpu: CpuInfo
  load: CpuLoad
  /** Fans from the sensor provider; empty without one. */
  fans?: FanReading[]
  /** e.g. `LibreHardwareMonitor`; `null` when no sensor tool is running. */
  sensorProvider?: string | null
  className?: string
}

/** Where the temperature, power and fan readings come from, or how to get them. */
const SENSOR_HINT =
  'Windows meldet ohne Zusatztreiber keine CPU-Temperatur. Läuft LibreHardwareMonitor (als Administrator gestartet), liest HardwareFlow Temperatur, Leistung und Lüfter automatisch über dessen WMI-Schnittstelle.'

function SensorRow({ load, fans, provider }: { load: CpuLoad; fans: FanReading[]; provider: string | null }) {
  if (!provider) {
    return (
      <p className="mt-4 text-xs text-muted">
        Temperatur, Leistung und Lüfter: <NotAvailable reason={SENSOR_HINT} /> — mit laufendem LibreHardwareMonitor
        verfügbar
      </p>
    )
  }

  const parts = [
    load.temperatureC !== null ? `${Math.round(load.temperatureC)} °C` : null,
    load.powerWatts !== null ? `${Math.round(load.powerWatts)} W` : null,
    ...fans.map((fan) => `${fan.name} ${fan.rpm.toLocaleString('de-DE')} U/min`),
  ].filter(Boolean)

  return (
    <p className="mt-4 text-xs text-ink-2 tabular-nums">
      {parts.length > 0 ? parts.join(' · ') : 'Keine CPU-Sensoren gemeldet'}
      <span className="ml-2 text-muted">via {provider}</span>
    </p>
  )
}

/**
 * One busy thread is a program doing its work, so the bands of the whole CPU would paint
 * half this grid amber on an ordinary day. A thread only takes colour once it is pinned —
 * the single saturated thread that explains a sluggish machine.
 */
function threadColor(percent: number): string {
  return percent >= 95 ? STATUS_COLORS.serious : STATUS_COLORS.good
}

/**
 * Splits the threads into even rows of at most 16, so 22 threads become two rows of 11
 * instead of a full row and a stub of six.
 */
function threadColumns(threads: number): number {
  const rows = Math.ceil(threads / 16)
  return Math.ceil(threads / rows)
}

/**
 * CPU detail: what the processor is, its sensors, and how the load spreads over the
 * threads. The minute of total load lives in the channel strip above.
 */
export function CpuCard({ cpu, load, fans = [], sensorProvider = null, className }: CpuCardProps) {
  return (
    <Card title="Prozessor" subtitle={<DeviceName name={describeDevice(cpu.vendor, cpu.model)} wrap />} className={className}>
      <StatGrid columns={4}>
        <Stat label="Kerne" value={cpu.cores} />
        <Stat label="Threads" value={cpu.threads} />
        <Stat
          label="Takt"
          value={load.currentClockGhz === null ? <NotAvailable /> : load.currentClockGhz.toFixed(2)}
          hint={load.currentClockGhz === null ? undefined : 'GHz'}
        />
        <Stat
          label="L3-Cache"
          value={cpu.cacheL3Mb === null ? <NotAvailable /> : cpu.cacheL3Mb}
          hint={cpu.cacheL3Mb === null ? undefined : 'MB'}
        />
      </StatGrid>

      <SensorRow load={load} fans={fans} provider={sensorProvider} />

      {load.perCore.length > 0 && (
        <div className="mt-auto border-t border-hairline pt-4">
          {/* The peak thread, not the average — a single saturated thread is what
              actually explains a sluggish machine. */}
          <PanelHeading aside={`Spitze ${formatPercent(Math.max(...load.perCore))}`}>Last pro Thread</PanelHeading>
          <div
            className="mt-2.5 grid gap-1"
            style={{ gridTemplateColumns: `repeat(${threadColumns(load.perCore.length)}, minmax(0, 1fr))` }}
          >
            {load.perCore.map((value, index) => (
              <div
                key={index}
                title={`Thread ${index}: ${formatPercent(value, 1)}`}
                className="flex h-10 items-end overflow-hidden rounded-[2px] bg-surface-2"
              >
                <div
                  className="w-full transition-[height] duration-500 ease-out motion-reduce:transition-none"
                  style={{ height: `${Math.max(value, 2)}%`, backgroundColor: threadColor(value) }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
