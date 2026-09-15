import { motion } from 'framer-motion'

interface MeterProps {
  /** Fill share, 0–100. */
  value: number
  /** Fill colour. Pass a status colour for utilisation, a series hue for identity. */
  color: string
  /** Bar height in px. */
  height?: number
  className?: string
  /** Accessible description of what the bar measures. */
  ariaLabel?: string
}

/**
 * A single ratio against a limit. The unfilled track is a translucent step of the
 * fill's own hue, so the state reads across the whole bar rather than only where
 * the fill stops.
 */
export function Meter({ value, color, height = 8, className = '', ariaLabel }: MeterProps) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`w-full overflow-hidden rounded-full ${className}`}
      style={{ height, backgroundColor: `${color}24` }}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 12px -2px ${color}` }}
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  )
}

export interface MeterSegment {
  key: string
  label: string
  /** Share of the whole, 0–100. */
  value: number
  color: string
}

interface SegmentedMeterProps {
  segments: MeterSegment[]
  height?: number
  className?: string
  ariaLabel?: string
}

/**
 * Part-to-whole in one bar. Segments are separated by a 2 px surface gap instead
 * of borders, which keeps each fill's own colour true.
 */
export function SegmentedMeter({ segments, height = 10, className = '', ariaLabel }: SegmentedMeterProps) {
  // A segment the platform reports as zero (Windows never reports page cache) would
  // otherwise show up as a misleading sliver.
  const visible = segments.filter((segment) => segment.value > 0.1)

  return (
    <div
      className={`flex w-full gap-0.5 overflow-hidden rounded-full bg-surface-2 ${className}`}
      style={{ height }}
      aria-label={ariaLabel}
      role="img"
    >
      {visible.map((segment) => (
        <motion.div
          key={segment.key}
          className="h-full rounded-full first:rounded-l-full last:rounded-r-full"
          style={{ backgroundColor: segment.color }}
          initial={{ flexGrow: 0 }}
          animate={{ flexGrow: Math.max(segment.value, 0.4) }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          title={`${segment.label}: ${segment.value.toFixed(1)} %`}
        />
      ))}
    </div>
  )
}
