import { AlertOctagon, AlertTriangle, Download, History } from 'lucide-react'
import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'

import { formatBytes, formatPercent } from '../lib/format'
import { DAY_MS, downsample, forecastSystemDrive, historyToCsv, MINUTE_MS } from '../lib/history'
import { HUES } from '../lib/palette'
import { STATUS_COLORS } from '../lib/status'
import type { HistoryBucket, LoggedAlert } from '../types/hardware'
import { Card } from './ui/Card'
import { Stat, StatGrid } from './ui/Stat'

interface HistoryCardProps {
  /** `null` while loading. */
  buckets: HistoryBucket[] | null
  /** Alerts raised in the stored week, oldest first. */
  alerts?: LoggedAlert[]
  className?: string
}

type RangeKey = '1h' | '24h' | '7d'

const RANGES: Record<RangeKey, { label: string; spanMs: number; stepMs: number }> = {
  '1h': { label: '1 Std.', spanMs: 60 * MINUTE_MS, stepMs: MINUTE_MS },
  '24h': { label: '24 Std.', spanMs: DAY_MS, stepMs: 10 * MINUTE_MS },
  '7d': { label: '7 Tage', spanMs: 7 * DAY_MS, stepMs: 60 * MINUTE_MS },
}

/** Drawn in the validated adjacent order: CPU → RAM → GPU. */
const SERIES = [
  { key: 'cpuAvg', label: 'CPU', color: HUES.cpu },
  { key: 'memAvg', label: 'RAM', color: HUES.memory },
  { key: 'gpuAvg', label: 'GPU', color: HUES.gpu },
] as const

const GRID = '#262a33'
const AXIS_TEXT = '#8b93a3'

function axisLabel(range: RangeKey) {
  return (timestamp: number) =>
    new Date(timestamp).toLocaleString(
      'de-DE',
      range === '7d' ? { weekday: 'short', day: '2-digit' } : { hour: '2-digit', minute: '2-digit' },
    )
}

function HistoryTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as HistoryBucket | undefined
  if (!active || !point) return null

  return (
    <div className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 shadow-xl">
      <p className="text-[11px] text-muted tabular-nums">
        {new Date(point.t).toLocaleString('de-DE', {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
      {SERIES.map((series) => {
        const value = point[series.key]
        return (
          <p key={series.key} className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2 tabular-nums">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: series.color }} />
            <span className="w-8">{series.label}</span>
            <span className="font-semibold text-ink">{value === null ? 'n/v' : formatPercent(value)}</span>
          </p>
        )
      })}
      {point.cpuMax > (point.cpuAvg ?? 0) + 5 && (
        <p className="mt-1 text-[11px] text-muted tabular-nums">CPU-Spitze {formatPercent(point.cpuMax)}</p>
      )}
    </div>
  )
}

/** Plain-language forecast for the system drive, or `null` when there is nothing to say yet. */
function DriveForecast({ buckets }: { buckets: HistoryBucket[] }) {
  const forecast = forecastSystemDrive(buckets)
  const latest = [...buckets].reverse().find((bucket) => bucket.systemFreeBytes !== null)

  if (!forecast || !latest) {
    return (
      <p className="text-[11px] leading-4 text-muted">
        Prognose fürs Systemlaufwerk nach 6 Stunden Verlauf.
      </p>
    )
  }

  const gbPerDay = Math.abs(forecast.bytesPerDay) / 1024 ** 3
  const trend =
    forecast.daysUntilFull !== null
      ? `verliert ${gbPerDay.toFixed(1)} GB pro Tag`
      : forecast.bytesPerDay > 0
        ? `gewinnt ${gbPerDay.toFixed(1)} GB pro Tag`
        : 'stabil'
  const urgent = forecast.daysUntilFull !== null && forecast.daysUntilFull < 30

  return (
    <p className="text-[11px] leading-4 text-ink-2">
      Systemlaufwerk: {formatBytes(latest.systemFreeBytes!)} frei, {trend}
      {forecast.daysUntilFull !== null && (
        <>
          {' '}
          —{' '}
          <span className="font-semibold" style={urgent ? { color: STATUS_COLORS.warning } : undefined}>
            voll in etwa {Math.round(forecast.daysUntilFull)} Tagen
          </span>
        </>
      )}
      <span className="text-muted"> · Trend aus {forecast.basedOnHours} h</span>
    </p>
  )
}

/** Hands the buckets in range to the browser as a CSV download. No IPC: the data is already here. */
function downloadCsv(buckets: HistoryBucket[], range: RangeKey) {
  const blob = new Blob([historyToCsv(buckets)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const date = new Date().toISOString().slice(0, 10)
  const link = document.createElement('a')
  link.href = url
  link.download = `hardwareflow-verlauf-${range}-${date}.csv`
  link.click()
  // Revoked on the next turn, once the download has taken the reference.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function alertTime(t: number) {
  return new Date(t).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Long-term history recorded by the main process — also while the window sits in the
 * tray. Three averages share one percentage axis, so there is no second scale to misread.
 * Raised alerts sit on the same time axis as dashed markers and are listed underneath.
 */
export function HistoryCard({ buckets, alerts = [], className }: HistoryCardProps) {
  const [range, setRange] = useState<RangeKey>('24h')
  const { spanMs, stepMs } = RANGES[range]

  const all = buckets ?? []
  // Anchored to the newest bucket, not the clock: render stays pure, and an empty list has no range.
  const end = all.length > 0 ? all[all.length - 1].t : 0
  const inRange = all.filter((bucket) => bucket.t > end - spanMs)
  const data = downsample(inRange, stepMs)

  const cpuMean = inRange.length > 0 ? inRange.reduce((sum, b) => sum + b.cpuAvg, 0) / inRange.length : null
  const cpuPeak = inRange.length > 0 ? Math.max(...inRange.map((b) => b.cpuMax)) : null
  const gpuTemps = inRange.map((b) => b.gpuTempMax).filter((value): value is number => value !== null)
  const cpuTemps = inRange.map((b) => b.cpuTempMax).filter((value): value is number => value !== null)
  const alertsInRange = alerts.filter((alert) => alert.t > end - spanMs && alert.t <= end + MINUTE_MS)

  return (
    <Card
      title="Verlauf"
      subtitle="Minutenwerte, gespeichert für 7 Tage"
      icon={History}
      accent={HUES.neutral}
      emphasis="quiet"
      className={className}
      action={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadCsv(inRange, range)}
            disabled={inRange.length === 0}
            title="Minutenwerte des gewählten Zeitraums als CSV (Excel, deutsches Format)"
            className="flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-baseline hover:text-ink focus-visible:outline-2 focus-visible:outline-cpu disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download aria-hidden size={12} />
            CSV
          </button>
          <div role="tablist" aria-label="Zeitraum" className="flex rounded-lg border border-hairline p-0.5">
            {(Object.keys(RANGES) as RangeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={range === key}
                onClick={() => setRange(key)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-cpu ${
                  range === key ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink-2'
                }`}
              >
                {RANGES[key].label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          <div className="flex items-center gap-4 text-[11px] text-muted">
            {SERIES.map((series) => (
              <span key={series.key} className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: series.color }} />
                {series.label}
              </span>
            ))}
            <span className="ml-auto">Durchschnitt je {stepMs >= 60 * MINUTE_MS ? 'Stunde' : stepMs > MINUTE_MS ? '10 min' : 'Minute'}</span>
          </div>

          <div className="mt-2 h-52">
            {buckets === null ? (
              <div className="grid h-full place-items-center text-[11px] text-muted">Verlauf wird geladen …</div>
            ) : data.length < 2 ? (
              <div className="grid h-full place-items-center rounded-lg bg-surface-2 px-6 text-center text-[11px] leading-5 text-muted">
                Der Verlauf füllt sich minütlich — auch wenn das Fenster im Tray liegt.
                <br />
                Nach zwei Minuten erscheint hier die erste Kurve.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={axisLabel(range)}
                    tick={{ fill: AXIS_TEXT, fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#333845' }}
                    minTickGap={48}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 50, 100]}
                    tick={{ fill: AXIS_TEXT, fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(value: number) => `${value} %`}
                  />
                  {alertsInRange.map((alert) => (
                    <ReferenceLine
                      key={`${alert.key}-${alert.t}`}
                      x={alert.t}
                      stroke={alert.severity === 'critical' ? STATUS_COLORS.critical : STATUS_COLORS.warning}
                      strokeDasharray="3 3"
                      strokeOpacity={0.8}
                      ifOverflow="extendDomain"
                    />
                  ))}
                  <Tooltip content={HistoryTooltip} cursor={{ stroke: '#4b5263', strokeWidth: 1 }} />
                  {SERIES.map((series) => (
                    <Line
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      stroke={series.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: series.color, stroke: '#14161c', strokeWidth: 2 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:border-l lg:border-hairline lg:pl-6">
          <StatGrid columns={2}>
            <Stat label="Ø CPU" value={cpuMean === null ? '—' : formatPercent(cpuMean)} />
            <Stat label="CPU-Spitze" value={cpuPeak === null ? '—' : formatPercent(cpuPeak)} />
            <Stat
              label="CPU max."
              value={cpuTemps.length > 0 ? Math.round(Math.max(...cpuTemps)) : '—'}
              hint={cpuTemps.length > 0 ? '°C' : undefined}
            />
            <Stat
              label="GPU max."
              value={gpuTemps.length > 0 ? Math.round(Math.max(...gpuTemps)) : '—'}
              hint={gpuTemps.length > 0 ? '°C' : undefined}
            />
          </StatGrid>
          <div className="mt-auto border-t border-hairline pt-4">
            <DriveForecast buckets={all} />
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-hairline pt-4">
        <h3 className="text-[11px] leading-4 font-medium tracking-wide text-muted uppercase">
          Warnungen im Zeitraum
        </h3>
        {alertsInRange.length === 0 ? (
          <p className="mt-2 text-[11px] text-muted">Keine — alles im grünen Bereich.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {[...alertsInRange].reverse().map((alert) => {
              const critical = alert.severity === 'critical'
              const Icon = critical ? AlertOctagon : AlertTriangle
              return (
                <li key={`${alert.key}-${alert.t}`} className="flex items-baseline gap-2 text-[11px] leading-4">
                  <Icon
                    aria-hidden
                    size={12}
                    className="shrink-0 self-center"
                    style={{ color: critical ? STATUS_COLORS.critical : STATUS_COLORS.warning }}
                  />
                  <span className="w-28 shrink-0 text-muted tabular-nums">{alertTime(alert.t)}</span>
                  <span className="font-medium text-ink">
                    {critical ? 'Kritisch: ' : ''}
                    {alert.title}
                  </span>
                  <span className="min-w-0 truncate text-muted">{alert.message}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
