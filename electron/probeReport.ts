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
