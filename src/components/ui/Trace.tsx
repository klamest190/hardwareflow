import type { LoadSample } from '../../types/hardware'

/** The window every trace spans. All tiles share it, so the curves are comparable. */
export const SPAN_MS = 60_000
const VIEW_W = 1000
const VIEW_H = 100

export interface TraceSeries {
  pick: (sample: LoadSample) => number | null
  /** The quieter second series (upload): a thin dashed line, no fill. */
  secondary?: boolean
}

interface TraceProps {
  samples: LoadSample[]
  series: TraceSeries[]
  /** Top of the scale. Percent channels use 100; throughput scales to its own peak. */
  max: number
  color: string
  /** Newest timestamp — the right edge of the window. */
  end: number
}

const toX = (t: number, t0: number) => ((t - t0) / SPAN_MS) * VIEW_W
const toY = (value: number, max: number) => VIEW_H - 2 - (Math.min(Math.max(value, 0), max) / max) * (VIEW_H - 4)

/**
 * One measured trace as plain SVG, drawn the way the data was taken: straight segments
 * between samples, no smoothing that would invent peaks between two readings, and a gap
 * where a reading is missing instead of a bridge across it.
 */
export function Trace({ samples, series, max, color, end }: TraceProps) {
  const t0 = end - SPAN_MS
  const paths = series.map(({ pick, secondary }) => {
    const runs: Array<Array<[number, number]>> = []
    let run: Array<[number, number]> = []
    for (const sample of samples) {
      const value = pick(sample)
      if (value === null) {
        if (run.length > 0) runs.push(run)
        run = []
        continue
      }
      run.push([toX(sample.timestamp, t0), toY(value, max)])
    }
    if (run.length > 0) runs.push(run)

    const points = (run: Array<[number, number]>) => run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')
    const line = runs.map((run) => `M${points(run)}`).join('')
    const area = secondary
      ? ''
      : runs
          .filter((run) => run.length > 1)
          .map((run) => `M${run[0][0].toFixed(1)},${VIEW_H}L${points(run)}L${run[run.length - 1][0].toFixed(1)},${VIEW_H}Z`)
          .join('')
    return { line, area, secondary }
  })

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden>
      <line x1="0" x2={VIEW_W} y1={VIEW_H / 2} y2={VIEW_H / 2} stroke="var(--color-hairline)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2={VIEW_W} y1={VIEW_H - 0.5} y2={VIEW_H - 0.5} stroke="var(--color-baseline)" vectorEffect="non-scaling-stroke" />
      {paths.map((path, index) => (
        <g key={index}>
          {path.area && <path d={path.area} fill={color} fillOpacity={0.12} />}
          <path
            d={path.line}
            fill="none"
            stroke={path.secondary ? 'var(--color-muted)' : color}
            strokeWidth={path.secondary ? 1 : 1.5}
            strokeDasharray={path.secondary ? '3 3' : undefined}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </svg>
  )
}

/** A capacity reading where a tile has no minute of history — drive fill, battery charge. */
export function CapacityBar({ percent, color, label }: { percent: number; color: string; label: string }) {
  return (
    <div className="flex h-full items-end pb-1">
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2.5 w-full overflow-hidden rounded-[2px] bg-surface-2"
      >
        <div className="h-full" style={{ width: `${Math.min(Math.max(percent, 0), 100)}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}
