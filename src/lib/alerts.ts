import type { AlertKey, HardwareAlert, HardwareReading } from '../types/hardware'

/**
 * Warnings worth interrupting someone for.
 *
 * A condition has to *hold* before it counts: a CPU touching 95 °C for two seconds
 * during a compile is normal, the same CPU sitting there for half a minute is not. Once
 * raised, an alert stays raised until the condition clears, and the engine reports it
 * as newly `fired` only on that first transition — the main process turns those into
 * desktop notifications and adds its own cooldown on top.
 *
 * The same engine runs in the renderer for the in-app banner, so the dashboard and the
 * notification can never disagree about what is wrong.
 */

interface Rule {
  key: AlertKey
  /** How long the condition must hold before the alert is raised. */
  holdMs: number
  check: (reading: HardwareReading) => Omit<HardwareAlert, 'key'> | null
}

const GIB = 1024 ** 3

export const ALERT_THRESHOLDS = {
  cpuTempC: 95,
  gpuTempC: 87,
  memoryPercent: 95,
  systemDriveFreePercent: 5,
  systemDriveFreeBytes: 10 * GIB,
  batteryPercent: 15,
} as const

const RULES: Rule[] = [
  {
    key: 'cpu-temp',
    holdMs: 60_000,
    check: ({ cpuLoad }) =>
      cpuLoad.temperatureC !== null && cpuLoad.temperatureC >= ALERT_THRESHOLDS.cpuTempC
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
    check: ({ gpus }) => {
      const hottest = Math.max(...gpus.map((gpu) => gpu.temperatureC ?? 0), 0)
      return hottest >= ALERT_THRESHOLDS.gpuTempC
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
    check: ({ memory }) => {
      const percent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0
      return percent >= ALERT_THRESHOLDS.memoryPercent
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
    check: ({ drives }) => {
      const system = drives.find((drive) => drive.system)
      if (!system || system.totalBytes <= 0) return null
      const freePercent = (system.freeBytes / system.totalBytes) * 100
      const low =
        freePercent < ALERT_THRESHOLDS.systemDriveFreePercent ||
        system.freeBytes < ALERT_THRESHOLDS.systemDriveFreeBytes
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
    check: ({ battery }) =>
      battery && !battery.acConnected && battery.percent <= ALERT_THRESHOLDS.batteryPercent
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

  update(reading: HardwareReading, now: number = reading.capturedAt): AlertUpdate {
    const active: HardwareAlert[] = []
    const fired: HardwareAlert[] = []

    for (const rule of RULES) {
      const result = rule.check(reading)
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
