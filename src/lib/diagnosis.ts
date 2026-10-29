import type { HardwareAlert, HardwareSnapshot, Headroom } from '../types/hardware'
import { formatBytes, formatPercent } from './format'
import { capacityStatus, loadStatus } from './status'

/** The status bands of `status.ts`, with `good` named for what it means here. */
export type DiagnosisSeverity = 'nominal' | 'warning' | 'serious' | 'critical'

/** The one sentence the overview opens with: is the machine fine, and if not, what is limiting it. */
export interface Diagnosis {
  severity: DiagnosisSeverity
  headline: string
  detail: string
  /** Further raised alerts beyond the one in the headline. */
  others: HardwareAlert[]
}

interface Candidate {
  /** How far into its band the reading is, 0–1 — used to pick the worst. */
  pressure: number
  severity: DiagnosisSeverity
  headline: string
  detail: string
}

/** Same band as the channel strip shows, so the headline and the strip never disagree on colour. */
function severityOf(status: 'good' | 'warning' | 'serious' | 'critical'): DiagnosisSeverity {
  return status === 'good' ? 'nominal' : status
}

const RANK: Record<DiagnosisSeverity, number> = { nominal: 0, warning: 1, serious: 2, critical: 3 }

function programName(name: string): string {
  return name.replace(/\.exe$/i, '')
}

/**
 * Names the bottleneck.
 *
 * A raised alert wins, because it has already held long enough to be real. Without one,
 * the reading deepest into its band does — CPU and GPU averaged over the headroom window,
 * so a one-second spike does not rewrite the headline. Where the process list can say who
 * is responsible, the sentence names the program.
 */
export function diagnose(snapshot: HardwareSnapshot, headroom: Headroom, alerts: HardwareAlert[]): Diagnosis {
  if (alerts.length > 0) {
    const worst = alerts.find((alert) => alert.severity === 'critical') ?? alerts[0]
    return {
      severity: worst.severity,
      headline: worst.title,
      detail: worst.message,
      others: alerts.filter((alert) => alert !== worst),
    }
  }

  const { memory, processes, drives } = snapshot
  const candidates: Candidate[] = []

  const memoryPercent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0
  const memoryStatus = loadStatus(memoryPercent)
  if (memoryStatus !== 'good') {
    const top = processes?.byMemory[0]
    candidates.push({
      pressure: memoryPercent / 100,
      severity: severityOf(memoryStatus),
      headline: 'Arbeitsspeicher wird knapp',
      detail:
        `${formatPercent(memoryPercent)} belegt, ${formatBytes(memory.freeBytes)} frei.` +
        (top ? ` Am meisten braucht ${programName(top.name)} mit ${formatBytes(top.memoryBytes)}.` : ''),
    })
  }

  const cpuStatus = loadStatus(headroom.cpuPercent)
  if (cpuStatus !== 'good') {
    const top = processes?.byCpu[0]
    candidates.push({
      pressure: headroom.cpuPercent / 100,
      severity: severityOf(cpuStatus),
      headline: 'Prozessor ist ausgelastet',
      detail:
        `${formatPercent(headroom.cpuPercent)} im Schnitt der letzten ${headroom.windowSeconds} s.` +
        (top ? ` Größter Verbraucher: ${programName(top.name)} mit ${formatPercent(top.cpuPercent, 1)}.` : ''),
    })
  }

  // A busy GPU is usually a game doing its job, so it only asks for attention, never more.
  if (headroom.gpuPercent !== null && headroom.gpuPercent >= 90) {
    candidates.push({
      pressure: headroom.gpuPercent / 100,
      severity: 'warning',
      headline: 'Grafik läuft unter Volllast',
      detail: `${formatPercent(headroom.gpuPercent)} im Schnitt der letzten ${headroom.windowSeconds} s.`,
    })
  }

  const system = drives.find((drive) => drive.system && !drive.remote)
  if (system && system.totalBytes > 0) {
    const usedPercent = ((system.totalBytes - system.freeBytes) / system.totalBytes) * 100
    const driveStatus = capacityStatus(usedPercent)
    if (driveStatus !== 'good') {
      candidates.push({
        pressure: usedPercent / 100,
        severity: severityOf(driveStatus),
        headline: `Systemlaufwerk ${system.mountPoint} wird voll`,
        detail: `${formatPercent(usedPercent)} belegt, noch ${formatBytes(system.freeBytes)} frei.`,
      })
    }
  }

  if (candidates.length > 0) {
    const rank = (candidate: Candidate) => RANK[candidate.severity] + candidate.pressure
    const worst = candidates.reduce((a, b) => (rank(b) > rank(a) ? b : a))
    return { severity: worst.severity, headline: worst.headline, detail: worst.detail, others: [] }
  }

  const loads = [
    { label: 'der Prozessor', percent: headroom.cpuPercent },
    { label: 'der Arbeitsspeicher', percent: memoryPercent },
    ...(headroom.gpuPercent === null ? [] : [{ label: 'die Grafik', percent: headroom.gpuPercent }]),
  ]
  const busiest = loads.reduce((a, b) => (b.percent > a.percent ? b : a))
  return {
    severity: 'nominal',
    headline: 'Läuft rund',
    detail: `Kein Engpass. Die größte Last trägt ${busiest.label} mit ${formatPercent(busiest.percent)}.`,
    others: [],
  }
}
