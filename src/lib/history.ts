import type { HardwareReading, HistoryBucket, LoggedAlert } from '../types/hardware'

/**
 * Long-term history: one bucket per minute, kept for a week.
 *
 * The main process feeds every reading into a `HistoryAccumulator` and persists the
 * closed buckets; the renderer only reads them. A minute is fine enough to see what
 * happened this afternoon and coarse enough that a week fits in about a megabyte.
 * Everything here is pure, so the maths is tested without Electron.
 */

export const MINUTE_MS = 60_000
export const DAY_MS = 24 * 60 * MINUTE_MS
export const HISTORY_RETENTION_MS = 7 * DAY_MS

const mean = (values: number[]) =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null

const maxOrNull = (values: number[]) => (values.length > 0 ? Math.max(...values) : null)

const present = <T>(value: T | null): value is T => value !== null

interface OpenBucket {
  t: number
  cpu: number[]
  mem: number[]
  gpu: number[]
  cpuTemp: number[]
  gpuTemp: number[]
  rx: number[]
  tx: number[]
  systemFreeBytes: number | null
  systemTotalBytes: number | null
}

function openBucket(t: number): OpenBucket {
  return {
    t,
    cpu: [],
    mem: [],
    gpu: [],
    cpuTemp: [],
    gpuTemp: [],
    rx: [],
    tx: [],
    systemFreeBytes: null,
    systemTotalBytes: null,
  }
}

function closeBucket(open: OpenBucket): HistoryBucket | null {
  const cpuAvg = mean(open.cpu)
  const memAvg = mean(open.mem)
  if (cpuAvg === null || memAvg === null) return null

  return {
    t: open.t,
    cpuAvg,
    cpuMax: maxOrNull(open.cpu) ?? cpuAvg,
    memAvg,
    gpuAvg: mean(open.gpu),
    cpuTempMax: maxOrNull(open.cpuTemp),
    gpuTempMax: maxOrNull(open.gpuTemp),
    netRxAvg: mean(open.rx),
    netTxAvg: mean(open.tx),
    systemFreeBytes: open.systemFreeBytes,
    systemTotalBytes: open.systemTotalBytes,
  }
}

/** Sum of a per-adapter rate, or `null` when no adapter reports one. */
export function totalRate(values: Array<number | null>): number | null {
  const known = values.filter(present)
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null
}

export class HistoryAccumulator {
  private current: OpenBucket | null = null

  /** Adds a reading; returns the previous minute once a new one starts. */
  add(reading: HardwareReading, now: number = reading.capturedAt): HistoryBucket | null {
    const minute = Math.floor(now / MINUTE_MS) * MINUTE_MS
    let closed: HistoryBucket | null = null

    if (this.current && this.current.t !== minute) {
      closed = closeBucket(this.current)
      this.current = null
    }
    const bucket = (this.current ??= openBucket(minute))

    const { cpuLoad, memory, gpus, drives, network } = reading
    bucket.cpu.push(cpuLoad.usagePercent)
    if (memory.totalBytes > 0) bucket.mem.push((memory.usedBytes / memory.totalBytes) * 100)
    const gpu = gpus[0]
    if (gpu?.usagePercent != null) bucket.gpu.push(gpu.usagePercent)
    if (cpuLoad.temperatureC !== null) bucket.cpuTemp.push(cpuLoad.temperatureC)
    const gpuTemps = gpus.map((adapter) => adapter.temperatureC).filter(present)
    if (gpuTemps.length > 0) bucket.gpuTemp.push(Math.max(...gpuTemps))

    const rx = totalRate(network.adapters.map((adapter) => adapter.rxBytesPerSec))
    const tx = totalRate(network.adapters.map((adapter) => adapter.txBytesPerSec))
    if (rx !== null) bucket.rx.push(rx)
    if (tx !== null) bucket.tx.push(tx)

    const system = drives.find((drive) => drive.system)
    if (system) {
      bucket.systemFreeBytes = system.freeBytes
      bucket.systemTotalBytes = system.totalBytes
    }

    return closed
  }

  /** Closes the running minute early — on quit, so the last minute is not lost. */
  flush(): HistoryBucket | null {
    const closed = this.current ? closeBucket(this.current) : null
    this.current = null
    return closed
  }
}

/** Drops buckets older than the retention window and keeps the list sorted. */
export function trimHistory(buckets: HistoryBucket[], now: number): HistoryBucket[] {
  const cutoff = now - HISTORY_RETENTION_MS
  return buckets.filter((bucket) => bucket.t >= cutoff).sort((a, b) => a.t - b.t)
}

/** Loose validation for data read back from disk — a corrupt file must not crash the app. */
export function isHistoryBucket(value: unknown): value is HistoryBucket {
  if (value === null || typeof value !== 'object') return false
  const bucket = value as Record<string, unknown>
  return (
    typeof bucket.t === 'number' &&
    typeof bucket.cpuAvg === 'number' &&
    typeof bucket.cpuMax === 'number' &&
    typeof bucket.memAvg === 'number'
  )
}

/** A week of alerts is a lot only when something is badly wrong; the cap keeps the file small then too. */
const ALERT_LOG_LIMIT = 500

/** Drops alerts older than the retention window, oldest first, at most `ALERT_LOG_LIMIT`. */
export function trimAlertLog(log: LoggedAlert[], now: number): LoggedAlert[] {
  const cutoff = now - HISTORY_RETENTION_MS
  return log
    .filter((entry) => entry.t >= cutoff)
    .sort((a, b) => a.t - b.t)
    .slice(-ALERT_LOG_LIMIT)
}

export function isLoggedAlert(value: unknown): value is LoggedAlert {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.t === 'number' &&
    typeof entry.key === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.message === 'string' &&
    (entry.severity === 'warning' || entry.severity === 'critical')
  )
}

/**
 * The buckets as CSV, for a spreadsheet. Semicolons and decimal commas, because that is
 * what Excel expects on a German system; empty cells where a sensor gave nothing.
 */
export function historyToCsv(buckets: HistoryBucket[]): string {
  const number = (value: number | null, digits = 1) => (value === null ? '' : value.toFixed(digits).replace('.', ','))
  const megabitsPerSecond = (bytes: number | null) => (bytes === null ? null : (bytes * 8) / 1e6)
  const gigabytes = (bytes: number | null) => (bytes === null ? null : bytes / 1024 ** 3)

  const header = [
    'Zeit',
    'CPU Ø %',
    'CPU max %',
    'RAM Ø %',
    'GPU Ø %',
    'CPU max °C',
    'GPU max °C',
    'Empfang Ø Mbit/s',
    'Senden Ø Mbit/s',
    'Systemlaufwerk frei GB',
  ]
  const rows = buckets.map((bucket) => {
    const date = new Date(bucket.t)
    const pad = (value: number) => String(value).padStart(2, '0')
    const time = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    return [
      time,
      number(bucket.cpuAvg),
      number(bucket.cpuMax),
      number(bucket.memAvg),
      number(bucket.gpuAvg),
      number(bucket.cpuTempMax, 0),
      number(bucket.gpuTempMax, 0),
      number(megabitsPerSecond(bucket.netRxAvg), 2),
      number(megabitsPerSecond(bucket.netTxAvg), 2),
      number(gigabytes(bucket.systemFreeBytes), 1),
    ].join(';')
  })
  // The BOM tells Excel the file is UTF-8, so "Ø" and "°C" survive the import.
  return `\uFEFF${[header.join(';'), ...rows].join('\r\n')}\r\n`
}

/**
 * Merges consecutive buckets into `stepMs` slots: averages stay averages, maxima stay
 * maxima, and the disk figure is the last one in the slot. A week at one point per
 * minute is 10 080 points — more than a chart has pixels.
 */
export function downsample(buckets: HistoryBucket[], stepMs: number): HistoryBucket[] {
  if (stepMs <= MINUTE_MS) return buckets

  const slots = new Map<number, HistoryBucket[]>()
  for (const bucket of buckets) {
    const slot = Math.floor(bucket.t / stepMs) * stepMs
    const list = slots.get(slot)
    if (list) list.push(bucket)
    else slots.set(slot, [bucket])
  }

  return [...slots.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, list]) => {
      const pick = (read: (bucket: HistoryBucket) => number | null) => list.map(read).filter(present)
      const last = [...list].reverse().find((bucket) => bucket.systemFreeBytes !== null)
      return {
        t,
        cpuAvg: mean(pick((b) => b.cpuAvg)) ?? 0,
        cpuMax: maxOrNull(pick((b) => b.cpuMax)) ?? 0,
        memAvg: mean(pick((b) => b.memAvg)) ?? 0,
        gpuAvg: mean(pick((b) => b.gpuAvg)),
        cpuTempMax: maxOrNull(pick((b) => b.cpuTempMax)),
        gpuTempMax: maxOrNull(pick((b) => b.gpuTempMax)),
        netRxAvg: mean(pick((b) => b.netRxAvg)),
        netTxAvg: mean(pick((b) => b.netTxAvg)),
        systemFreeBytes: last?.systemFreeBytes ?? null,
        systemTotalBytes: last?.systemTotalBytes ?? null,
      }
    })
}

export interface DiskForecast {
  /** Negative when the drive is filling up. */
  bytesPerDay: number
  /** `null` when the trend is flat or the drive is emptying. */
  daysUntilFull: number | null
  /** Hours of data the trend is based on. */
  basedOnHours: number
}

/** Less data than this, and a trend is mostly the last download. */
const MIN_FORECAST_SPAN_MS = 6 * 60 * MINUTE_MS
/** Below this loss per day a drive counts as stable. */
const STABLE_BYTES_PER_DAY = 200 * 1024 ** 2

/**
 * Least-squares trend of the system volume's free space. Deliberately conservative:
 * it says nothing until six hours of data exist, and ignores drift under 200 MB a day,
 * so a single large download does not announce the end of the disk.
 */
export function forecastSystemDrive(buckets: HistoryBucket[]): DiskForecast | null {
  const points = buckets.filter((bucket) => bucket.systemFreeBytes !== null)
  if (points.length < 2) return null

  const span = points[points.length - 1].t - points[0].t
  if (span < MIN_FORECAST_SPAN_MS) return null

  const xs = points.map((bucket) => (bucket.t - points[0].t) / DAY_MS)
  const ys = points.map((bucket) => bucket.systemFreeBytes!)
  const xMean = xs.reduce((sum, x) => sum + x, 0) / xs.length
  const yMean = ys.reduce((sum, y) => sum + y, 0) / ys.length
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < xs.length; i += 1) {
    numerator += (xs[i] - xMean) * (ys[i] - yMean)
    denominator += (xs[i] - xMean) ** 2
  }
  if (denominator === 0) return null

  const bytesPerDay = numerator / denominator
  const freeNow = ys[ys.length - 1]
  const daysUntilFull = bytesPerDay < -STABLE_BYTES_PER_DAY ? freeNow / -bytesPerDay : null

  return { bytesPerDay, daysUntilFull, basedOnHours: Math.round(span / (60 * MINUTE_MS)) }
}
