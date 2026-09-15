import type { ScoreGrade } from '../types/hardware'

/**
 * The status palette. Reserved for state (good → critical) and never reused as a
 * series colour, so a colour on this dashboard never means two different things.
 * Always paired with a label, never carrying meaning by hue alone.
 */
export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const

export const GRADE_META: Record<ScoreGrade, { label: string; color: string; summary: string }> = {
  excellent: {
    label: 'Ausgezeichnet',
    color: STATUS_COLORS.good,
    summary: 'Das System hat reichlich Reserven für anspruchsvolle Workloads.',
  },
  good: {
    label: 'Gut',
    color: STATUS_COLORS.good,
    summary: 'Solide Leistung, alle Subsysteme im grünen Bereich.',
  },
  warning: {
    label: 'Ausreichend',
    color: STATUS_COLORS.warning,
    summary: 'Grundsätzlich ausreichend, einzelne Komponenten bremsen.',
  },
  serious: {
    label: 'Knapp',
    color: STATUS_COLORS.serious,
    summary: 'Die Reserven sind knapp — ein Upgrade würde sich lohnen.',
  },
  critical: {
    label: 'Kritisch',
    color: STATUS_COLORS.critical,
    summary: 'Das System arbeitet am Limit und bremst laufende Aufgaben.',
  },
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
