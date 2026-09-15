import { MemoryStick } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'

import { formatBytes, formatPercent } from '../lib/format'
import { loadColor } from '../lib/status'
import type { LoadSample, MemoryInfo } from '../types/hardware'
import { Card } from './ui/Card'
import { AnimatedNumber } from './ui/AnimatedNumber'
import { Meter, SegmentedMeter } from './ui/Meter'
import { NotAvailable } from './ui/NotAvailable'
import { Stat, StatGrid } from './ui/Stat'

const RAM_HUE = '#199e70'
/** Lighter step of the same hue — reclaimable cache is subordinate to active use. */
const RAM_HUE_CACHE = 'rgba(25, 158, 112, 0.42)'
const FREE_TRACK = '#2b303b'

interface MemoryCardProps {
  memory: MemoryInfo
  history: LoadSample[]
  className?: string
}

/** `64 GB DDR5-5600 · 2/2 Slots belegt`, skipping whatever the system withholds. */
function describeModules(memory: MemoryInfo): string {
  const parts = [formatBytes(memory.totalBytes, 0)]

  if (memory.type) parts.push(memory.speedMhz ? `${memory.type}-${memory.speedMhz}` : memory.type)
  if (memory.slotsUsed !== null && memory.slotsTotal !== null) {
    parts.push(`${memory.slotsUsed}/${memory.slotsTotal} Slots belegt`)
  }

  return parts.join(' · ')
}

/**
 * RAM module. Where a platform separates reclaimable cache from active allocations the
 * bar splits it out; Windows reports no cache size at all, so the segment and its stat
 * fall back to `n/v` instead of an implied zero.
 */
export function MemoryCard({ memory, history, className }: MemoryCardProps) {
  const usedPercent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0
  const cachedBytes = memory.cachedBytes
  const activeBytes = Math.max(memory.usedBytes - (cachedBytes ?? 0), 0)
  const toPercent = (bytes: number) => (memory.totalBytes > 0 ? (bytes / memory.totalBytes) * 100 : 0)
  const activePercent = toPercent(activeBytes)
  const cachedPercent = cachedBytes === null ? 0 : toPercent(cachedBytes)
  const freePercent = Math.max(100 - activePercent - cachedPercent, 0)
  const swapPercent =
    memory.swapTotalBytes > 0 ? (memory.swapUsedBytes / memory.swapTotalBytes) * 100 : 0

  return (
    <Card
      title="Arbeitsspeicher"
      subtitle={describeModules(memory)}
      icon={MemoryStick}
      accent={RAM_HUE}
      className={className}
      action={
        <div>
          <p className="text-xl leading-6 font-semibold text-ink tabular-nums">
            <AnimatedNumber value={usedPercent} digits={1} />
            <span className="ml-0.5 text-sm font-normal text-muted">%</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted tabular-nums">belegt</p>
        </div>
      }
    >
      {/* Grows into whatever height the card is stretched to — in this row the storage
          card is the tallest, and the surplus is better spent on more of the curve than
          on a blank strip above the swap bar. */}
      <div className="-mx-1 -mt-1 min-h-14 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="hf-ram-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={RAM_HUE} stopOpacity={0.3} />
                <stop offset="100%" stopColor={RAM_HUE} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis domain={[0, 100]} hide />
            <Area
              type="monotone"
              dataKey="memoryPercent"
              stroke={RAM_HUE}
              strokeWidth={2}
              fill="url(#hf-ram-fill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <SegmentedMeter
        className="mt-3"
        height={10}
        ariaLabel={`Speicherbelegung: ${formatPercent(usedPercent)} belegt`}
        segments={[
          { key: 'active', label: 'Aktiv', value: activePercent, color: RAM_HUE },
          { key: 'cached', label: 'Cache', value: cachedPercent, color: RAM_HUE_CACHE },
          { key: 'free', label: 'Frei', value: freePercent, color: FREE_TRACK },
        ]}
      />

      <StatGrid columns={3} className="mt-4">
        <Stat label="Aktiv" value={formatBytes(activeBytes)} swatch={RAM_HUE} />
        <Stat
          label="Cache"
          value={
            cachedBytes === null ? (
              <NotAvailable reason="Windows gibt die Größe des Datei-Caches nicht heraus" />
            ) : (
              formatBytes(cachedBytes)
            )
          }
          swatch={RAM_HUE_CACHE}
        />
        <Stat label="Frei" value={formatBytes(memory.freeBytes)} swatch={FREE_TRACK} />
      </StatGrid>

      <div className="mt-4 border-t border-hairline pt-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium text-ink-2">Auslagerungsdatei</h3>
          <span className="text-[11px] text-muted tabular-nums">
            {memory.swapTotalBytes > 0 ? (
              `${formatBytes(memory.swapUsedBytes)} / ${formatBytes(memory.swapTotalBytes, 0)}`
            ) : (
              <NotAvailable reason="Keine Auslagerungsdatei gemeldet" />
            )}
          </span>
        </div>
        <Meter
          className="mt-2"
          height={6}
          value={swapPercent}
          color={loadColor(swapPercent)}
          ariaLabel={`Auslagerungsdatei: ${formatPercent(swapPercent)} belegt`}
        />
      </div>
    </Card>
  )
}
