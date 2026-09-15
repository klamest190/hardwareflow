/**
 * Führt ein TSX-Skript ohne Browser aus: esbuild bündelt es, die nötigen
 * DOM-Globals werden gestubbt, dann läuft es in Node.
 * Aufruf: node scripts/headless.mjs <datei.tsx>
 * Genutzt von "npm run smoke".
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const entry = process.argv[2]
if (!entry) throw new Error('Aufruf: node scripts/headless.mjs <datei.tsx>')

const dir = mkdtempSync(join(tmpdir(), 'hardwareflow-'))
const outfile = join(dir, 'bundle.cjs')

try {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.json': 'json' },
    outfile,
    logLevel: 'error',
  })

  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'de-DE', languages: ['de-DE'] },
    configurable: true,
  })
  // Kein window-Stub: Framer Motion und Recharts erkennen daran den Browser und
  // würden dann echte DOM-APIs erwarten. Ohne window läuft der SSR-Pfad.

  await import(pathToFileURL(outfile).href)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
