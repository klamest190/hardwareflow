import type { ScoreGrade } from '../types/hardware'

/**
 * The status palette. Reserved for state and never reused as a series colour, so a colour
 * on this dashboard never means two different things.
 *
 * `good` is deliberately not green: a reading inside its normal band takes the neutral
 * scale grey, and colour appears only once something deviates. A screen with no colour on
 * it is a machine with nothing wrong.
 *
 * Always paired with a label, never carrying meaning by hue alone.
 */
export const STATUS_COLORS = {
  good: '#a8a49b',
  warning: '#f2a93b',
  serious: '#ec7a4a',
  critical: '#e5484d',
} as const

/** Words for the deviating bands, written next to a coloured value so hue is never the only cue. */
export const STATUS_LABELS: Record<keyof typeof STATUS_COLORS, string | null> = {
  good: null,
  warning: 'erhöht',
  serious: 'hoch',
  critical: 'kritisch',
}

/**
 * Severity of a utilisation reading. Thresholds are deliberately generous: an
 * 80 %-busy CPU is a machine doing its job, not a fault.
 */
export function loadStatus(percent: number): keyof typeof STATUS_COLORS {
  if (percent >= 92) return 'critical'
  if (percent >= 80) return 'serious'
  if (percent >= 65) return 'warning'
  return 'good'
}

type Status = keyof typeof STATUS_COLORS

const RANK: Record<Status, number> = { good: 0, warning: 1, serious: 2, critical: 3 }
/** Readings averaged per step, so one noisy second neither raises nor clears a band. */
const SETTLE_SPAN = 3
/** Points the average must fall below a band's threshold before the band is left again. */
const SETTLE_MARGIN = 5
/** How far back the replay starts — long enough to reach a stable band, short enough to stay cheap. */
const SETTLE_WINDOW = 30

/**
 * The band a load has *settled* in, for colour on screen. Per-second readings swing by
 * ten points and more, so classifying each one alone made a tile hovering at 65 % flick
 * between grey and orange every second. This replays the recent window instead: each
 * step averages the last three readings, rises into a higher band at once, and leaves a
 * band only once the average is five points below its threshold. Pure — every view over
 * the same window agrees. Missing readings (`null`) are skipped.
 */
export function settledLoadStatus(values: ReadonlyArray<number | null>): Status {
  const recent = values.filter((value): value is number => value !== null).slice(-SETTLE_WINDOW)
  let state: Status = 'good'

  for (let index = 0; index < recent.length; index += 1) {
    const span = recent.slice(Math.max(0, index - SETTLE_SPAN + 1), index + 1)
    const mean = span.reduce((sum, value) => sum + value, 0) / span.length
    const raised = loadStatus(mean)
    const eased = loadStatus(mean + SETTLE_MARGIN)
    if (RANK[raised] > RANK[state]) state = raised
    else if (RANK[eased] < RANK[state]) state = eased
  }

  return state
}

/** Colour for a utilisation reading — used by meters, not by series marks. */
export function loadColor(percent: number): string {
  return STATUS_COLORS[loadStatus(percent)]
}

/** Storage runs out long before a CPU does, so the bands sit higher. */
export function capacityStatus(usedPercent: number): keyof typeof STATUS_COLORS {
  if (usedPercent >= 95) return 'critical'
  if (usedPercent >= 88) return 'serious'
  if (usedPercent >= 75) return 'warning'
  return 'good'
}

/**
 * Labels for the score bands. The colour says how comfortable the machine is for demanding
 * work; the label carries the same message in words, so hue is never the only cue.
 */
export const GRADE_META: Record<ScoreGrade, { label: string; color: string; summary: string }> = {
  'high-end': {
    label: 'Oberklasse',
    color: STATUS_COLORS.good,
    summary: 'Aktuelle Spitzenhardware — Reserven für alles, was man ihr zumutet.',
  },
  strong: {
    label: 'Leistungsstark',
    color: STATUS_COLORS.good,
    summary: 'Schnell genug für Spiele, Entwicklung und Medienbearbeitung.',
  },
  solid: {
    label: 'Solide',
    color: STATUS_COLORS.warning,
    summary: 'Für den Alltag gut aufgestellt; bei großen Projekten wird es zäh.',
  },
  entry: {
    label: 'Einstieg',
    color: STATUS_COLORS.serious,
    summary: 'Büro und Browser laufen, anspruchsvolle Aufgaben bremsen spürbar.',
  },
  dated: {
    label: 'Veraltet',
    color: STATUS_COLORS.critical,
    summary: 'Die Hardware ist an ihrer Grenze — ein Upgrade würde viel bringen.',
  },
}
