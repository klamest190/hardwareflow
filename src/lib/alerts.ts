import type { AlertKey, AlertThresholds, HardwareAlert, HardwareReading } from '../types/hardware'

/**
 * Warnings worth interrupting someone for.
 *
 * A condition has to *hold* before it counts: a CPU touching 95 °C for two seconds
 * during a compile is normal, the same CPU sitting there for a minute is not. Once
 * raised, an alert stays raised until the condition clears, and the engine reports it
 * as newly `fired` only on that first transition — the main process turns those into
 * desktop notifications and log entries, and adds its own cooldown on top.
 *
 * The same engine runs in the renderer for the in-app banner, with the same thresholds,
 * so the dashboard and the notification can never disagree about what is wrong.
 */

const GIB = 1024 ** 3

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  cpuTempC: 95,
  gpuTempC: 87,
  memoryPercent: 95,
  systemDriveFreePercent: 5,
  systemDriveFreeGb: 10,
  batteryPercent: 15,
}

/** Allowed range per threshold — the settings form uses it, and so does loading a saved file. */
export const ALERT_THRESHOLD_LIMITS: Record<keyof AlertThresholds, { min: number; max: number }> = {
  cpuTempC: { min: 60, max: 110 },
  gpuTempC: { min: 60, max: 110 },
  memoryPercent: { min: 10, max: 100 },
  systemDriveFreePercent: { min: 1, max: 50 },
  systemDriveFreeGb: { min: 1, max: 500 },
  batteryPercent: { min: 5, max: 50 },
}

/**
 * Thresholds from untrusted input — a hand-edited settings file, an IPC message — with
 * every value clamped into its range and anything unreadable replaced by the default.
 */
export function sanitizeThresholds(input: unknown): AlertThresholds {
  const source = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const result = { ...DEFAULT_ALERT_THRESHOLDS }
  for (const key of Object.keys(DEFAULT_ALERT_THRESHOLDS) as Array<keyof AlertThresholds>) {
    const value = source[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const { min, max } = ALERT_THRESHOLD_LIMITS[key]
    result[key] = Math.min(max, Math.max(min, Math.round(value)))
  }
  return result
}

interface Rule {
  key: AlertKey
  /** How long the condition must hold before the alert is raised. */
  holdMs: number
  check: (reading: HardwareReading, limits: AlertThresholds) => Omit<HardwareAlert, 'key'> | null
}

const RULES: Rule[] = [
  {
    key: 'cpu-temp',
    holdMs: 60_000,
    check: ({ cpuLoad }, limits) =>
      cpuLoad.temperatureC !== null && cpuLoad.temperatureC >= limits.cpuTempC
        ? {
            title: 'CPU sehr heiß',
            message: `${Math.round(cpuLoad.temperatureC)} °C seit über einer Minute — Lüfter und Luftzufuhr prüfen.`,
            severity: 'critical',
          }
        : null,
  },
  {
    key: 'gpu-temp',
    holdMs: 30_000,
    check: ({ gpus }, limits) => {
      const hottest = Math.max(...gpus.map((gpu) => gpu.temperatureC ?? 0), 0)
      return hottest >= limits.gpuTempC
        ? {
            title: 'GPU sehr heiß',
            message: `${Math.round(hottest)} °C seit über 30 Sekunden.`,
            severity: 'warning',
          }
        : null
    },
  },
  {
    key: 'memory',
    holdMs: 60_000,
    check: ({ memory }, limits) => {
      const percent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0
      return percent >= limits.memoryPercent
        ? {
            title: 'Arbeitsspeicher voll',
            message: `${Math.round(percent)} % belegt seit über einer Minute — Windows lagert aus, alles wird langsam.`,
            severity: 'warning',
          }
        : null
    },
  },
  {
    key: 'system-drive',
    holdMs: 0,
    check: ({ drives }, limits) => {
      const system = drives.find((drive) => drive.system)
      if (!system || system.totalBytes <= 0) return null
      const freePercent = (system.freeBytes / system.totalBytes) * 100
      const low =
        freePercent < limits.systemDriveFreePercent || system.freeBytes < limits.systemDriveFreeGb * GIB
      return low
        ? {
            title: `Systemlaufwerk ${system.mountPoint} fast voll`,
            message: `Nur noch ${(system.freeBytes / GIB).toFixed(1)} GB frei (${Math.round(freePercent)} %). Updates und Auslagerung brauchen Platz.`,
            severity: freePercent < 2 ? 'critical' : 'warning',
          }
        : null
    },
  },
  {
    key: 'battery',
    holdMs: 0,
    check: ({ battery }, limits) =>
      battery && !battery.acConnected && battery.percent <= limits.batteryPercent
        ? {
            title: 'Akku fast leer',
            message: `${Math.round(battery.percent)} % — Netzteil anschließen.`,
            severity: battery.percent <= 7 ? 'critical' : 'warning',
          }
        : null,
  },
]

export interface AlertUpdate {
  /** Every alert currently raised. */
  active: HardwareAlert[]
  /** Alerts raised by this update — the ones worth a notification. */
  fired: HardwareAlert[]
}

export class AlertEngine {
  /** When each condition started holding. */
  private readonly since = new Map<AlertKey, number>()
  private readonly raised = new Set<AlertKey>()
  private thresholds: AlertThresholds

  constructor(thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS) {
    this.thresholds = thresholds
  }

  /**
   * Takes effect on the next update. A condition that no longer holds under the new
   * limits clears there; one that newly holds starts its hold time from that update.
   */
  setThresholds(thresholds: AlertThresholds): void {
    this.thresholds = thresholds
  }

  update(reading: HardwareReading, now: number = reading.capturedAt): AlertUpdate {
    const active: HardwareAlert[] = []
    const fired: HardwareAlert[] = []

    for (const rule of RULES) {
      const result = rule.check(reading, this.thresholds)
      if (!result) {
        this.since.delete(rule.key)
        this.raised.delete(rule.key)
        continue
      }

      const start = this.since.get(rule.key) ?? now
      this.since.set(rule.key, start)
      if (now - start < rule.holdMs) continue

      const alert: HardwareAlert = { key: rule.key, ...result }
      active.push(alert)
      if (!this.raised.has(rule.key)) {
        this.raised.add(rule.key)
        fired.push(alert)
      }
    }

    return { active, fired }
  }
}
