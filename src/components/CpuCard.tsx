import { Cpu, Thermometer } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'

import { describeDevice, formatClockTime, formatPercent } from '../lib/format'
import { loadColor } from '../lib/status'
import type { CpuInfo, CpuLoad, FanReading, LoadSample } from '../types/hardware'
import { Card } from './ui/Card'
import { AnimatedNumber } from './ui/AnimatedNumber'
import { NotAvailable } from './ui/NotAvailable'
import { Stat, StatGrid } from './ui/Stat'

const CPU_HUE = '#3987e5'
const GRID = '#262a33'
const AXIS_TEXT = '#8b93a3'

interface CpuCardProps {
  cpu: CpuInfo
  load: CpuLoad
  history: LoadSample[]
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
      <p className="mt-4 flex items-center gap-2 text-[11px] leading-4 text-muted">
        <Thermometer aria-hidden size={13} className="shrink-0" />
        <span>
          Temperatur, Leistung und Lüfter: <NotAvailable reason={SENSOR_HINT} />
          <span className="ml-1">— mit laufendem LibreHardwareMonitor verfügbar</span>
        </span>
      </p>
    )
  }

  const parts = [
    load.temperatureC !== null ? `${Math.round(load.temperatureC)} °C` : null,
    load.powerWatts !== null ? `${Math.round(load.powerWatts)} W` : null,
    ...fans.map((fan) => `${fan.name} ${fan.rpm.toLocaleString('de-DE')} U/min`),
  ].filter(Boolean)

  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-ink-2 tabular-nums">
      <Thermometer aria-hidden size={13} className="shrink-0 text-muted" />
      <span>{parts.length > 0 ? parts.join(' · ') : 'Keine CPU-Sensoren gemeldet'}</span>
      <span className="text-muted">via {provider}</span>
    </p>
  )
}

/** Short `mm:ss` axis label — the window is 60 s, so the hour is noise. */
function axisTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('de-DE', { minute: '2-digit', second: '2-digit' })
}

function CpuTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as LoadSample | undefined
  if (!active || !point) return null

  return (
    <div className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 shadow-xl">
      <p className="text-[11px] text-muted tabular-nums">{formatClockTime(point.timestamp)}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-ink tabular-nums">
        <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: CPU_HUE }} />
        {formatPercent(point.cpuPercent, 1)}
      </p>
    </div>
  )
}

/**
 * CPU module: identity and static capability up top, the rolling 60 s load curve in
 * the middle, per-thread distribution at the bottom. The curve is a single series,
 * so it carries no legend — the card title names it.
 */
export function CpuCard({ cpu, load, history, fans = [], sensorProvider = null, className }: CpuCardProps) {
  return (
    <Card
      title="Prozessor"
      subtitle={describeDevice(cpu.vendor, cpu.model)}
      icon={Cpu}
      accent={CPU_HUE}
      className={className}
      action={
        <div>
          <p className="text-xl leading-6 font-semibold text-ink tabular-nums">
            <AnimatedNumber value={load.usagePercent} digits={1} />
            <span className="ml-0.5 text-sm font-normal text-muted">%</span>
          </p>
          {load.temperatureC !== null && (
            <p className="mt-0.5 text-[11px] text-muted tabular-nums">
              {Math.round(load.temperatureC)} °C
            </p>
          )}
        </div>
      }
    >
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

      {/* The chart takes whatever height the card has left. In the 12-column grid this
          card sits beside the taller score panel, so without this the surplus became a
          blank strip under the thread bars — here it becomes resolution on the curve. */}
      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium text-ink-2">Auslastung, letzte 60 Sekunden</h3>
          {load.processCount !== null && (
            <span className="text-[11px] text-muted tabular-nums">{load.processCount} Prozesse</span>
          )}
        </div>

        <div className="mt-2 min-h-37.5 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="hf-cpu-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CPU_HUE} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={CPU_HUE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="timestamp"
                tickFormatter={axisTime}
                tick={{ fill: AXIS_TEXT, fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#333845' }}
                minTickGap={52}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                tick={{ fill: AXIS_TEXT, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                // Wide enough for "100 %" — a narrower axis silently clips the labels
                // to their unit and leaves the scale unreadable.
                width={44}
                tickFormatter={(value: number) => `${value} %`}
              />
              <Tooltip content={CpuTooltip} cursor={{ stroke: '#4b5263', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="cpuPercent"
                stroke={CPU_HUE}
                strokeWidth={2}
                fill="url(#hf-cpu-fill)"
                dot={false}
                activeDot={{ r: 4, fill: CPU_HUE, stroke: '#14161c', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {load.perCore.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-medium text-ink-2">Verteilung pro Thread</h3>
            {/* The peak thread, not the average — the average is already the headline
                number above, and a single saturated thread is what actually explains a
                sluggish machine. */}
            <span className="text-[11px] text-muted tabular-nums">
              Spitze {formatPercent(Math.max(...load.perCore))}
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-8 gap-1.5 sm:grid-cols-16">
            {load.perCore.map((value, index) => (
              <div
                key={index}
                title={`Thread ${index}: ${formatPercent(value, 1)}`}
                className="flex h-9 items-end overflow-hidden rounded-[3px] bg-surface-2"
              >
                <div
                  className="w-full rounded-[3px] transition-[height] duration-500 ease-out motion-reduce:transition-none"
                  style={{ height: `${Math.max(value, 3)}%`, backgroundColor: loadColor(value) }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
