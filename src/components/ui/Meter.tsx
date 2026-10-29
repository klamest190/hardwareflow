interface MeterProps {
  /** Fill share, 0–100. */
  value: number
  /** Fill colour. Pass a status colour: grey while nominal, a hue once it deviates. */
  color: string
  /** Bar height in px. */
  height?: number
  className?: string
  /** Accessible description of what the bar measures. */
  ariaLabel?: string
}

/**
 * A single ratio against a limit, drawn like a scale: square ends, a flat track, the
 * fill in the reading's status colour. No glow — the bar is a measurement, not a light.
 * The fill is scaled, not resized: easing a width would re-run layout on every frame of
 * every reading and make scrolling stutter.
 */
export function Meter({ value, color, height = 6, className = '', ariaLabel }: MeterProps) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div
      role="meter"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`w-full overflow-hidden rounded-[2px] bg-surface-2 ${className}`}
      style={{ height }}
    >
      <div
        className="size-full origin-left transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `scaleX(${clamped / 100})`, backgroundColor: color }}
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
 * Part-to-whole in one bar. Segments are separated by a 2 px gap instead of borders,
 * which keeps each fill's own colour true. Shares jump to each reading: easing them would
 * mean easing flex sizes, a layout pass per frame that stutters scrolling.
 */
export function SegmentedMeter({ segments, height = 8, className = '', ariaLabel }: SegmentedMeterProps) {
  // A segment the platform reports as zero (Windows never reports page cache) would
  // otherwise show up as a misleading sliver.
  const visible = segments.filter((segment) => segment.value > 0.1)

  return (
    <div
      className={`flex w-full gap-0.5 overflow-hidden rounded-[2px] ${className}`}
      style={{ height }}
      aria-label={ariaLabel}
      role="img"
    >
      {visible.map((segment) => (
        <div
          key={segment.key}
          className="h-full"
          style={{ backgroundColor: segment.color, flexGrow: Math.max(segment.value, 0.4) }}
          title={`${segment.label}: ${segment.value.toFixed(1)} %`}
        />
      ))}
    </div>
  )
}
