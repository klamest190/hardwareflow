/**
 * Startet die gebaute App. Aufruf: npm start
 */
import { spawnElectron } from './electron-env.mjs'

const child = await spawnElectron()
child.on('close', (code) => process.exit(code ?? 0))
