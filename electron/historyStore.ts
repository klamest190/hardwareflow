import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { HistoryAccumulator, isHistoryBucket, isLoggedAlert, trimAlertLog, trimHistory } from '../src/lib/history'
import type { HardwareAlert, HardwareReading, HistoryBucket, LoggedAlert } from '../src/types/hardware'

/**
 * Persists a week of per-minute history under `userData/history.json`, and the alerts
 * raised in that week under `userData/alert-log.json`.
 *
 * Written every five minutes rather than every minute — the history file is around a
 * megabyte once full, and a crash costs at most five minutes of chart. Each write goes
 * to a temporary file first and is renamed over the old one, so a power cut mid-write
 * leaves the previous week intact instead of an empty file.
 */

const SAVE_INTERVAL_MS = 5 * 60_000

const dataFile = (name: string) => path.join(app.getPath('userData'), name)

function readList<T>(name: string, guard: (value: unknown) => value is T): T[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(dataFile(name), 'utf8'))
    return Array.isArray(parsed) ? parsed.filter(guard) : []
  } catch {
    // Nothing saved yet, or an unreadable file — start a fresh week.
    return []
  }
}

function writeAtomically(name: string, data: unknown): boolean {
  try {
    const file = dataFile(name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    fs.writeFileSync(temp, JSON.stringify(data), 'utf8')
    fs.renameSync(temp, file)
    return true
  } catch (error) {
    console.error(`[hardwareflow] ${name} konnte nicht gespeichert werden:`, error)
    return false
  }
}

export class HistoryStore {
  private buckets: HistoryBucket[] = []
  private alerts: LoggedAlert[] = []
  private readonly accumulator = new HistoryAccumulator()
  private dirty = false
  private timer: ReturnType<typeof setInterval> | null = null

  load(): void {
    const now = Date.now()
    this.buckets = trimHistory(readList('history.json', isHistoryBucket), now)
    this.alerts = trimAlertLog(readList('alert-log.json', isLoggedAlert), now)
    this.timer = setInterval(() => this.save(), SAVE_INTERVAL_MS)
  }

  record(reading: HardwareReading): void {
    const closed = this.accumulator.add(reading)
    if (!closed) return
    this.buckets.push(closed)
    this.dirty = true
  }

  /**
   * Logs raised alerts. Unlike notifications these are not rate-limited: the log is
   * the record of what happened, and the engine only reports an alert once per episode.
   */
  logAlerts(fired: HardwareAlert[], now: number = Date.now()): void {
    if (fired.length === 0) return
    this.alerts.push(...fired.map((alert) => ({ ...alert, t: now })))
    this.alerts = trimAlertLog(this.alerts, now)
    this.dirty = true
  }

  /** Every completed minute of the last week; the running minute joins once it closes. */
  all(): HistoryBucket[] {
    return trimHistory(this.buckets, Date.now())
  }

  alertLog(): LoggedAlert[] {
    return trimAlertLog(this.alerts, Date.now())
  }

  save(): void {
    if (!this.dirty) return
    const now = Date.now()
    this.buckets = trimHistory(this.buckets, now)
    this.alerts = trimAlertLog(this.alerts, now)
    const saved = writeAtomically('history.json', this.buckets) && writeAtomically('alert-log.json', this.alerts)
    if (saved) this.dirty = false
  }

  /** Closes the running minute and writes everything out — on quit. */
  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const last = this.accumulator.flush()
    if (last) {
      this.buckets.push(last)
      this.dirty = true
    }
    this.save()
  }
}
