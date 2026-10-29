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
