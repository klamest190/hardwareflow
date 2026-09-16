import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { HistoryAccumulator, isHistoryBucket, trimHistory } from '../src/lib/history'
import type { HardwareReading, HistoryBucket } from '../src/types/hardware'

/**
 * Persists a week of per-minute history under `userData/history.json`.
 *
 * Written every five minutes rather than every minute — the file is around a megabyte
 * once full, and a crash costs at most five minutes of chart. The write goes to a
 * temporary file first and is renamed over the old one, so a power cut mid-write
 * leaves the previous week intact instead of an empty file.
 */

const SAVE_INTERVAL_MS = 5 * 60_000

const historyFile = () => path.join(app.getPath('userData'), 'history.json')

export class HistoryStore {
  private buckets: HistoryBucket[] = []
  private readonly accumulator = new HistoryAccumulator()
  private dirty = false
  private timer: ReturnType<typeof setInterval> | null = null

  load(): void {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(historyFile(), 'utf8'))
      const list = Array.isArray(parsed) ? parsed.filter(isHistoryBucket) : []
      this.buckets = trimHistory(list, Date.now())
    } catch {
      // No history yet, or an unreadable file — start a fresh week.
      this.buckets = []
    }
    this.timer = setInterval(() => this.save(), SAVE_INTERVAL_MS)
  }

  record(reading: HardwareReading): void {
    const closed = this.accumulator.add(reading)
    if (!closed) return
    this.buckets.push(closed)
    this.dirty = true
  }

  /** Every completed minute of the last week; the running minute joins once it closes. */
  all(): HistoryBucket[] {
    return trimHistory(this.buckets, Date.now())
  }

  save(): void {
    if (!this.dirty) return
    this.buckets = trimHistory(this.buckets, Date.now())
    try {
      const file = historyFile()
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temp = `${file}.tmp`
      fs.writeFileSync(temp, JSON.stringify(this.buckets), 'utf8')
      fs.renameSync(temp, file)
      this.dirty = false
    } catch (error) {
      console.error('[hardwareflow] Verlauf konnte nicht gespeichert werden:', error)
    }
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
