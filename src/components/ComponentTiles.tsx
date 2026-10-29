import { BatteryMedium, Cpu, HardDrive, MemoryStick, MonitorSmartphone, Network, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { describeDevice, formatBitrate, formatBytes, formatPercent } from '../lib/format'
import { capacityStatus, loadStatus, STATUS_COLORS, STATUS_LABELS } from '../lib/status'
import type { HardwareSnapshot } from '../types/hardware'
import { BADGE, vendorIcon } from '../lib/vendors'
import { VendorLogo } from './ui/DeviceName'
import { CapacityBar, Trace } from './ui/Trace'

type Status = keyof typeof STATUS_COLORS

/** A nominal curve is drawn in scale ink; it takes the status colour only once it deviates. */
const traceColor = (status: Status) => (status === 'good' ? 'var(--color-ink)' : STATUS_COLORS[status])

/** "74 %" → figure and unit, so the unit can sit a step down from the number. */
function split(text: string): { figure: string; unit: string } {
  const at = text.lastIndexOf(' ')
  return at === -1 ? { figure: text, unit: '' } : { figure: text.slice(0, at), unit: text.slice(at + 1) }
}

/**
 * The tile's mark: the vendor's logo in its own colour on a light badge where the device
 * name names one, otherwise a plain symbol for the kind of part on the panel grey — so
 * every tile has its mark in the same place.
 */
function Mark({ device, fallback: Fallback }: { device: string; fallback: LucideIcon }) {
  const vendor = vendorIcon(device) !== null
  return (
    <span
      aria-hidden
      className={`grid size-9 shrink-0 place-items-center rounded-md ${vendor ? '' : 'bg-surface-2'}`}
      style={vendor ? { backgroundColor: BADGE } : undefined}
    >
      {vendor ? <VendorLogo name={device} size={24} badge={false} /> : <Fallback size={18} strokeWidth={1.75} className="text-ink-2" />}
    </span>
  )
}

interface TileProps {
  icon: LucideIcon
  label: string
  device: string
  figure: string
  unit: string
  status: Status
  graph: ReactNode
  facts: string
}

/**
 * One component at a glance: what it is, its reading, its last minute, two facts.
 * A deviating tile is marked three ways — a rule along the top, the figure in the
 * status colour, and the band written out — so colour is never the only cue.
 */
function Tile({ icon, label, device, figure, unit, status, graph, facts }: TileProps) {
  const deviating = status !== 'good'
  const color = STATUS_COLORS[status]

  return (
    <li
      className="flex min-w-0 flex-col rounded-lg border border-hairline bg-surface px-4 pt-3.5 pb-3"
      style={deviating ? { boxShadow: `inset 0 2px 0 ${color}` } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Mark device={device} fallback={icon} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{label}</h3>
            <p className="truncate text-xs text-muted" title={device}>
              {device}
            </p>
          </div>
        </div>
        <p className="shrink-0 text-right leading-none">
          <span className="hf-figure text-lg font-semibold" style={{ color: deviating ? color : 'var(--color-ink)' }}>
            {figure}
          </span>
          {unit && <span className="ml-1 text-xs text-muted">{unit}</span>}
          {deviating && (
            <span className="mt-1 block text-xs font-medium" style={{ color }}>
              {STATUS_LABELS[status]}
            </span>
          )}
        </p>
      </div>

      <div className="mt-3 h-11">{graph}</div>

      <p className="mt-2 truncate text-xs text-muted tabular-nums" title={facts}>
        {facts}
      </p>
    </li>
  )
}

/**
 * The overview's cockpit: one tile per component, the same shape for each, so the whole
 * machine reads in one glance. Curves span the same last minute in every tile.
 */
export function ComponentTiles({ snapshot }: { snapshot: HardwareSnapshot }) {
  const { history, cpu, cpuLoad, memory, gpus, network, drives, battery } = snapshot
  const end = history.length > 0 ? history[history.length - 1].timestamp : snapshot.capturedAt
  const latest = history[history.length - 1]

  const cpuStatus = loadStatus(cpuLoad.usagePercent)

  const memoryPercent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0
  const memoryStatus = loadStatus(memoryPercent)

  const gpu = gpus[0]
  const gpuStatus: Status = gpu?.usagePercent == null ? 'good' : loadStatus(gpu.usagePercent)

  const rx = latest?.netRxBytesPerSec ?? null
  const tx = latest?.netTxBytesPerSec ?? null
  const netPeak = Math.max(1024, ...history.flatMap((sample) => [sample.netRxBytesPerSec ?? 0, sample.netTxBytesPerSec ?? 0]))
  const primary = network.adapters[0]

  const local = drives.filter((drive) => !drive.remote).sort((a, b) => Number(b.system) - Number(a.system))

  // Low charge only matters off the charger.
  const batteryStatus: Status =
    !battery || battery.acConnected ? 'good' : battery.percent <= 10 ? 'critical' : battery.percent <= 20 ? 'serious' : 'good'

  const join = (...parts: Array<string | null | false | undefined>) => parts.filter(Boolean).join(' · ')

  return (
    <section aria-labelledby="hf-components">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="hf-components" className="text-md font-semibold text-ink">
          Komponenten
        </h2>
        <span className="text-xs text-muted">Kurven: letzte 60 s</span>
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          icon={Cpu}
          label="Prozessor"
          device={describeDevice(cpu.vendor, cpu.model)}
          {...split(formatPercent(cpuLoad.usagePercent))}
          status={cpuStatus}
          graph={<Trace samples={history} series={[{ pick: (s) => s.cpuPercent }]} max={100} color={traceColor(cpuStatus)} end={end} />}
          facts={join(
            cpuLoad.currentClockGhz !== null && `${cpuLoad.currentClockGhz.toFixed(2)} GHz`,
            `${cpu.cores} Kerne / ${cpu.threads} Threads`,
            cpuLoad.temperatureC !== null && `${Math.round(cpuLoad.temperatureC)} °C`,
          )}
        />

        <Tile
          icon={MonitorSmartphone}
          label="Grafik"
          device={gpu ? describeDevice(gpu.vendor, gpu.model) : 'Keine GPU erkannt'}
          {...(gpu?.usagePercent == null ? { figure: 'n/v', unit: '' } : split(formatPercent(gpu.usagePercent)))}
          status={gpuStatus}
          graph={<Trace samples={history} series={[{ pick: (s) => s.gpuPercent }]} max={100} color={traceColor(gpuStatus)} end={end} />}
          facts={
            gpu
              ? join(
                  gpu.vramUsedBytes !== null && gpu.vramTotalBytes !== null && `VRAM ${formatBytes(gpu.vramUsedBytes)} / ${formatBytes(gpu.vramTotalBytes, 0)}`,
                  gpu.temperatureC !== null && `${Math.round(gpu.temperatureC)} °C`,
                  gpus.length > 1 && `+${gpus.length - 1} weitere`,
                ) || 'Keine Messwerte vom Treiber'
              : 'Kein Grafikadapter ausgelesen'
          }
        />

        <Tile
          icon={MemoryStick}
          label="Arbeitsspeicher"
          device={join(formatBytes(memory.totalBytes, 0), memory.type && (memory.speedMhz ? `${memory.type}-${memory.speedMhz}` : memory.type))}
          {...split(formatPercent(memoryPercent))}
          status={memoryStatus}
          graph={<Trace samples={history} series={[{ pick: (s) => s.memoryPercent }]} max={100} color={traceColor(memoryStatus)} end={end} />}
          facts={`${formatBytes(memory.usedBytes)} belegt · ${formatBytes(memory.freeBytes)} frei`}
        />

        {local.map((drive) => {
          const used = drive.totalBytes > 0 ? ((drive.totalBytes - drive.freeBytes) / drive.totalBytes) * 100 : 0
          const status = capacityStatus(used)
          return (
            <Tile
              key={drive.id}
              icon={HardDrive}
              label={`Laufwerk ${drive.mountPoint}`}
              device={join(drive.label ?? drive.filesystem, drive.system && 'System')}
              {...split(formatPercent(used))}
              status={status}
              graph={<CapacityBar percent={used} color={STATUS_COLORS[status]} label={`${drive.mountPoint}: ${formatPercent(used)} belegt`} />}
              facts={`${formatBytes(drive.freeBytes)} frei von ${formatBytes(drive.totalBytes, 0)}`}
            />
          )
        })}

        <Tile
          icon={Network}
          label="Netzwerk"
          device={primary ? primary.adapter : 'Keine Verbindung'}
          {...(rx === null ? { figure: 'n/v', unit: '' } : split(formatBitrate(rx)))}
          status="good"
          graph={
            <Trace
              samples={history}
              series={[{ pick: (s) => s.netRxBytesPerSec }, { pick: (s) => s.netTxBytesPerSec, secondary: true }]}
              max={netPeak * 1.1}
              color="var(--color-ink)"
              end={end}
            />
          }
          facts={join(`↑ ${formatBitrate(tx)} gestrichelt`, network.wifiGeneration)}
        />

        {battery && (
          <Tile
            icon={BatteryMedium}
            label="Akku"
            device={battery.charging ? 'Lädt' : battery.acConnected ? 'Netzbetrieb' : 'Akkubetrieb'}
            {...split(formatPercent(battery.percent))}
            status={batteryStatus}
            graph={<CapacityBar percent={battery.percent} color={STATUS_COLORS[batteryStatus]} label={`Ladestand ${Math.round(battery.percent)} %`} />}
            facts={battery.healthPercent !== null ? `Hält noch ${Math.round(battery.healthPercent)} % der Nennkapazität` : 'Zustand nicht gemeldet'}
          />
        )}
      </ul>
    </section>
  )
}
