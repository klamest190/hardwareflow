/** Presentation helpers. Pure functions — no React, no side effects. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/**
 * Binary-prefixed byte formatting with vendor-style labels (1024-based maths,
 * `GB`/`TB` suffixes) — the convention Windows' own storage UI uses.
 */
export function formatBytes(bytes: number, fractionDigits?: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  const digits = fractionDigits ?? (exponent <= 1 ? 0 : value >= 100 ? 0 : 1)

  return `${value.toFixed(digits)} ${UNITS[exponent]}`
}

/** Rounded percentage with a `%` suffix. */
export function formatPercent(value: number, fractionDigits = 0): string {
  return `${value.toFixed(fractionDigits)} %`
}

/** `4 d 7 h 22 m` — drops leading units that are zero. */
export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (days > 0) return `${days} d ${hours} h ${minutes} m`
  if (hours > 0) return `${hours} h ${minutes} m`
  return `${minutes} m ${total % 60} s`
}

/** `14:32:07` — used for the live graph's time axis and tooltip. */
export function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Throughput in MB/s; an em dash when idle or unavailable. */
export function formatThroughput(mbPerSecond: number | null): string {
  if (mbPerSecond === null || mbPerSecond < 1) return '—'
  if (mbPerSecond >= 1000) return `${(mbPerSecond / 1000).toFixed(1)} GB/s`
  return `${Math.round(mbPerSecond)} MB/s`
}
