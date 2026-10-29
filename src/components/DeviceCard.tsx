import type { ReactNode } from 'react'

import { describeDevice, formatBytes, formatUptime } from '../lib/format'
import type { HardwareSnapshot } from '../types/hardware'
import { Card } from './ui/Card'
import { DeviceName } from './ui/DeviceName'

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(110px,160px)_1fr] gap-4 py-2.5">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  )
}

/**
 * The machine's data sheet: what it is, as opposed to what it is doing. These facts never
 * change while the app runs, so they live here instead of in a header on every page.
 */
export function DeviceCard({ snapshot, className }: { snapshot: HardwareSnapshot; className?: string }) {
  const { system, cpu, memory, gpus, physicalDisks } = snapshot
  const modules = [
    formatBytes(memory.totalBytes, 0),
    memory.type && (memory.speedMhz ? `${memory.type}-${memory.speedMhz}` : memory.type),
    memory.slotsUsed !== null && memory.slotsTotal !== null ? `${memory.slotsUsed} von ${memory.slotsTotal} Slots belegt` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card title="Datenblatt" subtitle="Was diese Maschine ist" className={className}>
      <dl className="divide-y divide-hairline">
        <Row term="Host">{system.hostname}</Row>
        <Row term="Betriebssystem">
          {system.osName} {system.osVersion}
        </Row>
        <Row term="Architektur">{system.architecture}</Row>
        <Row term="Laufzeit">seit {formatUptime(system.uptimeSeconds)}</Row>
        <Row term="Prozessor">
          <DeviceName name={describeDevice(cpu.vendor, cpu.model)} wrap />
          <span className="block text-xs text-muted">
            {cpu.cores} Kerne, {cpu.threads} Threads{cpu.cacheL3Mb !== null && `, ${cpu.cacheL3Mb} MB L3-Cache`}
          </span>
        </Row>
        <Row term="Arbeitsspeicher">{modules}</Row>
        <Row term="Grafik">
          {gpus.length === 0
            ? 'Keine GPU erkannt'
            : gpus.map((gpu) => (
                <span key={gpu.id} className="block">
                  <DeviceName name={describeDevice(gpu.vendor, gpu.model)} wrap />
                  <span className="ml-2 text-xs text-muted">{gpu.integrated ? 'integriert' : 'dediziert'}</span>
                </span>
              ))}
        </Row>
        <Row term="Datenträger">
          {physicalDisks.length === 0
            ? 'Nicht gemeldet'
            : physicalDisks.map((disk) => (
                <span key={disk.id} className="block">
                  <DeviceName name={disk.name} wrap />
                  <span className="ml-2 text-xs text-muted">{formatBytes(disk.sizeBytes, 0)}</span>
                </span>
              ))}
        </Row>
      </dl>
    </Card>
  )
}
