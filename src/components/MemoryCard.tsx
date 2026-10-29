import { formatBytes, formatPercent } from '../lib/format'
import { loadColor } from '../lib/status'
import type { MemoryInfo } from '../types/hardware'
import { Card, PanelHeading } from './ui/Card'
import { Meter, SegmentedMeter } from './ui/Meter'
import { NotAvailable } from './ui/NotAvailable'
import { Stat, StatGrid } from './ui/Stat'

const FREE_TRACK = 'var(--color-surface-2)'

interface MemoryCardProps {
  memory: MemoryInfo
  className?: string
}

/** `32 GB DDR5-5600 · 2/2 Slots belegt`, skipping whatever the system withholds. */
function describeModules(memory: MemoryInfo): string {
  const parts = [formatBytes(memory.totalBytes, 0)]

  if (memory.type) parts.push(memory.speedMhz ? `${memory.type}-${memory.speedMhz}` : memory.type)
  if (memory.slotsUsed !== null && memory.slotsTotal !== null) {
    parts.push(`${memory.slotsUsed}/${memory.slotsTotal} Slots belegt`)
  }

  return parts.join(' · ')
}

/**
 * RAM detail. The occupied share takes the status colour of the whole reading — a RAM at
 * 96 % must not look like a healthy one. Where a platform separates reclaimable cache the
 * bar splits it out; Windows reports no cache size at all, so the segment and its stat
 * fall back to `n/v` instead of an implied zero.
 */
export function MemoryCard({ memory, className }: MemoryCardProps) {
  const usedPercent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0
  const usedColor = loadColor(usedPercent)
  const cachedBytes = memory.cachedBytes
  const activeBytes = Math.max(memory.usedBytes - (cachedBytes ?? 0), 0)
  const toPercent = (bytes: number) => (memory.totalBytes > 0 ? (bytes / memory.totalBytes) * 100 : 0)
  const activePercent = toPercent(activeBytes)
  const cachedPercent = cachedBytes === null ? 0 : toPercent(cachedBytes)
  const freePercent = Math.max(100 - activePercent - cachedPercent, 0)
  const swapPercent = memory.swapTotalBytes > 0 ? (memory.swapUsedBytes / memory.swapTotalBytes) * 100 : 0
  // Reclaimable cache is subordinate to active use: the same hue, half strength.
  const cacheColor = `color-mix(in oklab, ${usedColor} 45%, transparent)`

  return (
    <Card title="Arbeitsspeicher" subtitle={describeModules(memory)} className={className}>
      <PanelHeading aside={`${formatBytes(memory.usedBytes)} von ${formatBytes(memory.totalBytes, 0)}`}>
        Belegung
      </PanelHeading>
      <SegmentedMeter
        className="mt-2"
        height={10}
        ariaLabel={`Speicherbelegung: ${formatPercent(usedPercent)} belegt`}
        segments={[
          { key: 'active', label: 'Aktiv', value: activePercent, color: usedColor },
          { key: 'cached', label: 'Cache', value: cachedPercent, color: cacheColor },
          { key: 'free', label: 'Frei', value: freePercent, color: FREE_TRACK },
        ]}
      />

      <StatGrid columns={3} className="mt-4">
        <Stat label="Aktiv" value={formatBytes(activeBytes)} swatch={usedColor} />
        <Stat
          label="Cache"
          value={
            cachedBytes === null ? (
              <NotAvailable reason="Windows gibt die Größe des Datei-Caches nicht heraus" />
            ) : (
              formatBytes(cachedBytes)
            )
          }
          swatch={cacheColor}
        />
        <Stat label="Frei" value={formatBytes(memory.freeBytes)} swatch={FREE_TRACK} />
      </StatGrid>

      <div className="mt-auto border-t border-hairline pt-4">
        <PanelHeading
          aside={
            memory.swapTotalBytes > 0 ? (
              `${formatBytes(memory.swapUsedBytes)} / ${formatBytes(memory.swapTotalBytes, 0)}`
            ) : (
              <NotAvailable reason="Keine Auslagerungsdatei gemeldet" />
            )
          }
        >
          Auslagerungsdatei
        </PanelHeading>
        <Meter
          className="mt-2"
          value={swapPercent}
          color={loadColor(swapPercent)}
          ariaLabel={`Auslagerungsdatei: ${formatPercent(swapPercent)} belegt`}
        />
      </div>
    </Card>
  )
}
