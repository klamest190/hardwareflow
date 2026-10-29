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
 *
 * It stays one line whatever the sentence: a diagnosis that wrapped to two lines when the
 * load rose pushed the whole page down mid-scroll. The full text sits in the tooltip.
 */
export function StatusLine({ diagnosis, headroom }: { diagnosis: Diagnosis; headroom: Headroom }) {
  const color = SEVERITY_COLOR[diagnosis.severity]
  const nominal = diagnosis.severity === 'nominal'
  const others = diagnosis.others.map((alert) => alert.title).join(', ')
  const sentence = [diagnosis.headline, diagnosis.detail, others && `außerdem ${others}`].filter(Boolean).join(' · ')

  return (
    <section
      aria-live="polite"
      className="flex items-center justify-between gap-6 rounded-lg border border-hairline bg-surface px-4 py-2.5"
      style={nominal ? undefined : { boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <p className="min-w-0 flex-1 truncate text-sm" title={sentence}>
        <span className="font-semibold" style={{ color }}>
          {diagnosis.headline}
        </span>
        <span className="ml-2 text-ink-2">{diagnosis.detail}</span>
        {others && <span className="ml-2 text-muted">· außerdem {others}</span>}
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
