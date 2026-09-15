/**
 * Startet Vite und Electron zusammen, ohne zusätzliche Runner-Dependency:
 * Vite läuft programmatisch, seine URL geht per Env an den Main-Prozess.
 * Aufruf: npm run dev
 */
import { createServer } from 'vite'

import { spawnElectron } from './electron-env.mjs'

const server = await createServer({ server: { strictPort: true } })
await server.listen()
server.printUrls()

const url = server.resolvedUrls?.local?.[0]
if (!url) throw new Error('Vite hat keine lokale URL gemeldet')

const child = await spawnElectron(['.'], { VITE_DEV_SERVER_URL: url })

child.on('close', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
