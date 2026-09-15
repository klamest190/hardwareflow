/**
 * Bündelt Main-Prozess und Preload nach dist-electron/ als CommonJS.
 * Aufruf: node scripts/build-electron.mjs [--watch]
 */
import { context } from 'esbuild'

const watch = process.argv.includes('--watch')

/**
 * electron und systeminformation bleiben extern: electron liefert die Runtime,
 * systeminformation lädt Plattform-Module dynamisch nach und übersteht das
 * Bündeln nicht. Beide liegen zur Laufzeit in node_modules (electron-builder
 * packt Produktions-Dependencies mit).
 */
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', 'systeminformation'],
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
}

const builds = await Promise.all([
  context({ ...shared, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' }),
  context({ ...shared, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' }),
  context({ ...shared, entryPoints: ['electron/probeReport.ts'], outfile: 'dist-electron/probeReport.cjs' }),
])

if (watch) {
  await Promise.all(builds.map((build) => build.watch()))
  console.log('[electron] watch aktiv')
} else {
  await Promise.all(builds.map((build) => build.rebuild()))
  await Promise.all(builds.map((build) => build.dispose()))
}
