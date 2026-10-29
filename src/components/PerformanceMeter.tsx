import { GRADE_META } from '../lib/status'
import type { HardwareScore } from '../types/hardware'
import { Card } from './ui/Card'

interface PerformanceMeterProps {
  score: HardwareScore
  className?: string
}

/** Lower edge of each band, as in `hardwareScore.ts`. */
const BANDS = [
  { from: 0, label: 'Veraltet' },
  { from: 40, label: 'Einstieg' },
  { from: 55, label: 'Solide' },
  { from: 70, label: 'Leistungsstark' },
  { from: 85, label: 'Oberklasse' },
]

/**
 * The score as a measured position on a scale, not a gauge: the bands are marked, so
 * "74" reads as "low in Leistungsstark" at a glance. The score is what the machine *is*,
 * not a state, so it carries no status colour.
 */
function ScoreScale({ total }: { total: number }) {
  return (
    <div className="mt-6" aria-hidden>
      <div className="relative h-2 rounded-[2px] bg-surface-2">
        <div className="absolute inset-y-0 left-0 rounded-[2px] bg-nominal" style={{ width: `${total}%` }} />
        {BANDS.slice(1).map((band) => (
          <span key={band.from} className="absolute -top-1 h-4 w-px bg-baseline" style={{ left: `${band.from}%` }} />
        ))}
        <span className="absolute -top-2 h-6 w-0.5 bg-ink" style={{ left: `calc(${total}% - 1px)` }} />
      </div>
      <div className="relative mt-2 h-4 text-xs text-muted">
        {BANDS.map((band, index) => {
          const to = BANDS[index + 1]?.from ?? 100
          return (
            <span
              key={band.from}
              className="absolute truncate text-center"
              style={{ left: `${band.from}%`, width: `${to - band.from}%` }}
            >
              {band.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * HardwareFlow Score: one number for what this machine can do, with the weighted inputs
 * listed underneath so the score is auditable rather than magic. It does not move with
 * load — that is the reserve.
 */
export function PerformanceMeter({ score, className }: PerformanceMeterProps) {
  const meta = GRADE_META[score.grade]

  return (
    <Card title="HardwareFlow Score" subtitle="Was diese Maschine kann — unabhängig von der Last" className={className}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <p className="leading-none">
          <span className="hf-figure text-display font-semibold text-ink">{score.total}</span>
          <span className="ml-2 text-md text-muted">von 100</span>
        </p>
        <div className="pb-1">
          <p className="text-lg font-semibold text-ink">{meta.label}</p>
          <p className="text-sm text-ink-2">{meta.summary}</p>
        </div>
      </div>

      <ScoreScale total={score.total} />

      <table className="mt-6 w-full border-t border-hairline text-sm">
        <caption className="sr-only">Teilwertungen des Scores</caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-2 font-normal">Baustein</th>
            <th scope="col" className="hidden py-2 font-normal sm:table-cell">
              <span className="sr-only">Balken</span>
            </th>
            <th scope="col" className="py-2 text-right font-normal">Punkte</th>
            <th scope="col" className="py-2 pl-4 text-right font-normal">Gewicht</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline border-t border-hairline">
          {score.components.map((component) => (
            <tr key={component.key} className="align-top">
              <td className="py-2.5 pr-4">
                <span className="font-medium text-ink">{component.label}</span>
                {component.estimated && (
                  <span
                    className="ml-2 cursor-help rounded-[3px] border border-hairline px-1.5 text-xs text-muted"
                    title="Modell nicht in der Leistungstabelle — aus Threads, Takt bzw. VRAM geschätzt"
                  >
                    geschätzt
                  </span>
                )}
                <span className="block text-xs text-muted">{component.detail}</span>
              </td>
              <td className="hidden w-[38%] py-4 sm:table-cell">
                <div
                  role="meter"
                  aria-label={`${component.label}: ${Math.round(component.score)} von 100`}
                  aria-valuenow={Math.round(component.score)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 rounded-[2px] bg-surface-2"
                >
                  <div className="h-full rounded-[2px] bg-nominal" style={{ width: `${component.score}%` }} />
                </div>
              </td>
              <td className="hf-figure py-2.5 text-right font-semibold text-ink">{Math.round(component.score)}</td>
              <td className="hf-figure py-2.5 pl-4 text-right text-muted">{Math.round(component.weight * 100)} %</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
