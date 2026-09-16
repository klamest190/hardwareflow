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

/**
 * Strips the legal marks vendors bake into device names — `(R)`, `(TM)`, `®`, `™` —
 * and collapses the whitespace they leave behind.
 */
function tidyDeviceName(value: string): string {
  return value
    .replace(/\((?:R|TM|C)\)/gi, '')
    .replace(/[®™©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Vendor and model as one line, without saying the vendor twice.
 *
 * Drivers disagree about whether the model already contains the manufacturer. Measured
 * on a real machine: NVIDIA reports vendor `NVIDIA` with model
 * `NVIDIA GeForce RTX 4070 Laptop GPU`, and Intel reports `Intel` with
 * `Intel(R) Arc(TM) Graphics` — joined naively both read the brand twice. The CPU on the
 * same machine reports `Intel` with `Core™ Ultra 7 155H`, which does need the vendor in
 * front. So the prefix is added only when it is actually missing.
 */
export function describeDevice(vendor: string, model: string): string {
  const cleanVendor = tidyDeviceName(vendor)
  const cleanModel = tidyDeviceName(model)

  if (!cleanVendor) return cleanModel
  if (!cleanModel) return cleanVendor

  return cleanModel.toLowerCase().startsWith(cleanVendor.toLowerCase())
    ? cleanModel
    : `${cleanVendor} ${cleanModel}`
}

/** Throughput in MB/s; an em dash when idle or unavailable. */
export function formatThroughput(mbPerSecond: number | null): string {
  if (mbPerSecond === null || mbPerSecond < 1) return '—'
  if (mbPerSecond >= 1000) return `${(mbPerSecond / 1000).toFixed(1)} GB/s`
  return `${Math.round(mbPerSecond)} MB/s`
}

/**
 * Network rate in bits per second — the unit providers and link speeds use, so a
 * reading can be held against "250 Mbit/s" on the contract without converting.
 */
export function formatBitrate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) return '—'
  const bits = Math.max(bytesPerSecond, 0) * 8
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbit/s`
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(bits >= 1e8 ? 0 : 1)} Mbit/s`
  if (bits >= 1e3) return `${Math.round(bits / 1e3)} kbit/s`
  return `${Math.round(bits)} bit/s`
}

/** Link speed: `2,5 Gbit/s`, `841 Mbit/s`. */
export function formatLinkSpeed(mbps: number | null): string {
  if (mbps === null) return '—'
  return mbps >= 1000 ? `${(mbps / 1000).toString()} Gbit/s` : `${Math.round(mbps)} Mbit/s`
}

/** `2 h 05 min`, `47 min`. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return hours > 0 ? `${hours} h ${String(rest).padStart(2, '0')} min` : `${rest} min`
}

/** Thousands with a narrow gap, German style: `5 930`. */
export function formatPoints(points: number): string {
  return Math.round(points).toLocaleString('de-DE').replace(/\./g, '\u202f')
}
