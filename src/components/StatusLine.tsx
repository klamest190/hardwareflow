import type { Diagnosis } from '../lib/diagnosis'
import { STATUS_COLORS } from '../lib/status'
import type { Headroom } from '../types/hardware'
import { HeadroomRing } from './ui/HeadroomRing'

const SEVERITY_COLOR = {
  nominal: 'var(--color-ink)',
  warning: STATUS_COLORS.warning,
  serious: STATUS_COLORS.serious,
  critical: STATUS_COLORS.critical,
} as const

/**
 * One quiet line above the tiles: whether the machine is fine and, if not, what is holding
 * it back. It names the bottleneck without shouting — the tile it refers to already
 * carries the colour — and the reserve sits at its right end.
 */
export function StatusLine({ diagnosis, headroom }: { diagnosis: Diagnosis; headroom: Headroom }) {
  const color = SEVERITY_COLOR[diagnosis.severity]
  const nominal = diagnosis.severity === 'nominal'

  return (
    <section
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-hairline bg-surface px-4 py-2.5"
      style={nominal ? undefined : { boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <p className="min-w-0 text-sm">
        <span className="font-semibold" style={{ color }}>
          {diagnosis.headline}
        </span>
        <span className="ml-2 text-ink-2">{diagnosis.detail}</span>
        {diagnosis.others.length > 0 && (
          <span className="ml-2 text-muted">· außerdem {diagnosis.others.map((alert) => alert.title).join(', ')}</span>
        )}
      </p>

      <p
        className="flex shrink-0 items-center gap-2 text-sm text-ink-2"
        title={`Frei im Schnitt der letzten ${headroom.windowSeconds} s: 100 − Last von CPU, RAM${headroom.gpuPercent === null ? '' : ' und GPU'}, gewichtet`}
      >
        <HeadroomRing headroom={headroom} size={20} />
        Reserve
        <span className="hf-figure font-semibold text-ink">{Math.round(headroom.percent)} %</span>
        <span className="text-muted">frei</span>
      </p>
    </section>
  )
}
