import { HardwareProbe } from './hardwareProbe'

/**
 * Diagnose-CLI: liest die Hardware einmal aus und schreibt das Ergebnis als JSON
 * nach stdout — ohne Electron, ohne Fenster.
 *
 * Aufruf: npm run probe
 *
 * Dient dazu, auf einem fremden Rechner zu sehen, welche Werte dort tatsächlich
 * ankommen und welche `null` bleiben, bevor man die UI dafür verantwortlich macht.
 */

/** Zählt, wie viele Felder das System nicht herausgegeben hat. */
function countNulls(value: unknown, path = ''): string[] {
  if (value === null) return [path]
  if (Array.isArray(value)) return value.flatMap((item, index) => countNulls(item, `${path}[${index}]`))
  if (typeof value === 'object' && value !== undefined) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      countNulls(item, path ? `${path}.${key}` : key),
    )
  }
  return []
}

/**
 * Felder, die einen Rechner oder ein Netz identifizieren. Ein Fixture landet im Repo,
 * also werden sie ersetzt, bevor irgendetwas geschrieben wird. Die Struktur bleibt
 * gleich, damit das Mapping dieselben Pfade durchläuft.
 */
const IDENTIFYING = new Set([
  'hostname', 'fqdn', 'serial', 'serialNum', 'serialNumber', 'uuid', 'mac', 'bssid', 'ssid',
  'ip4', 'ip6', 'ip4subnet', 'ip6subnet', 'dnsSuffix', 'user', 'id',
])

function anonymize(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => anonymize(item))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, anonymize(v, k)]),
    )
  }
  if (typeof value === 'string' && value !== '' && IDENTIFYING.has(key)) {
    return key === 'hostname' ? 'FIXTURE-HOST' : key.startsWith('ip4') ? '192.0.2.10' : 'anonym'
  }
  return value
}

// Kein Top-Level-await: das Bundle ist CommonJS.
async function main() {
  const probe = new HardwareProbe({
    onStatus: (message: string | null) => {
      if (message) console.error(`[probe] ${message}`)
    },
  })

  const started = Date.now()
  await probe.warmUp()
  const reading = probe.reading()
  probe.stop()

  if (process.argv.includes('--raw')) {
    // Rohdaten als Test-Fixture: npm run probe -- --raw > scripts/fixtures/<name>.json
    console.log(JSON.stringify(anonymize(probe.rawState()), null, 2))
    return
  }

  console.log(JSON.stringify(reading, null, 2))

  const missing = countNulls(reading)
  console.error(`\n[probe] ${Date.now() - started} ms für den ersten vollständigen Durchlauf`)
  console.error(
    missing.length === 0
      ? '[probe] Alle Felder wurden vom System gemeldet.'
      : `[probe] ${missing.length} Feld(er) nicht verfügbar: ${missing.join(', ')}`,
  )
}

void main()
