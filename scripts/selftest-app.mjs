/**
 * Startet die gebaute App, liest den gerenderten Text aus und beendet sie wieder.
 * Aufruf: npm run selftest:app
 */
import { spawnElectron } from './electron-env.mjs'

const child = await spawnElectron(['.'], { HARDWAREFLOW_SELFTEST: '1' })
child.on('close', (code) => process.exit(code ?? 1))
