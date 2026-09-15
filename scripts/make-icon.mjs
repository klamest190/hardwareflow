import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { spawnElectron } from './electron-env.mjs'

/**
 * Renders the app icon from an inline SVG.
 *
 * Electron is already a dependency and ships a full renderer, so it can rasterise the
 * SVG itself — no image library, no binary asset checked in that nobody can edit. Run
 * `npm run icon` after changing the artwork below.
 *
 * Three outputs, because they are consumed differently:
 *   public/icon.png    → copied into `dist` by Vite; the window icon at runtime
 *   build/icon.png     → electron-builder's source for the .ico / .icns it generates
 *   public/favicon.svg → the same mark as vector, for the browser tab in web mode
 */

const SIZE = 512

/**
 * The mark: the pulse line from the dashboard header, on the app's own page plane.
 * Deliberately one shape and one accent — at 16 px in a taskbar anything more is mud.
 */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="plane" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1b1e26"/>
      <stop offset="100%" stop-color="#0a0b0f"/>
    </linearGradient>
    <radialGradient id="bloom" cx="0.5" cy="0.44" r="0.55">
      <stop offset="0%" stop-color="#3987e5" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#3987e5" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#plane)"/>
  <rect x="0" y="0" width="512" height="512" rx="112" fill="url(#bloom)"/>
  <rect x="6" y="6" width="500" height="500" rx="106" fill="none" stroke="#3987e5" stroke-opacity="0.38" stroke-width="12"/>

  <path d="M84 268 H164 L206 156 L268 356 L310 268 H428"
        fill="none" stroke="#3987e5" stroke-width="38"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

async function main() {
  const root = process.cwd()
  const targets = [path.join(root, 'public', 'icon.png'), path.join(root, 'build', 'icon.png')]

  // The renderer script runs inside Electron, prints the PNG as base64 and exits.
  const runner = path.join(root, 'scripts', 'render-icon.cjs')
  await writeFile(
    runner,
    `const { app, BrowserWindow } = require('electron')
const svg = ${JSON.stringify(SVG)}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: ${SIZE},
    height: ${SIZE},
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<body style="margin:0;background:transparent">' + svg + '</body>'
  ))
  // One frame of settling, otherwise the capture can come back empty.
  await new Promise((resolve) => setTimeout(resolve, 400))
  // capturePage works in device pixels, so on a scaled display the capture comes back
  // larger than the window; resize so the file is exactly the size we asked for.
  const image = (await win.webContents.capturePage()).resize({ width: ${SIZE}, height: ${SIZE}, quality: 'best' })
  process.stdout.write('ICON:' + image.toPNG().toString('base64') + '\\n')
  app.exit(0)
})
`,
    'utf8',
  )

  const child = await spawnElectron([runner], {}, ['pipe', 'pipe', 'inherit'])
  let out = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    out += chunk
  })
  const code = await new Promise((resolve) => child.on('exit', resolve))

  const match = /ICON:([A-Za-z0-9+/=]+)/.exec(out)
  if (code !== 0 || !match) {
    console.error(`[icon] Electron hat kein Bild geliefert (exit ${code}).`)
    process.exit(1)
  }

  const png = Buffer.from(match[1], 'base64')
  for (const target of targets) {
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, png)
    console.log(`[icon] ${path.relative(root, target)} — ${png.length} Bytes`)
  }

  // The tab icon is the same artwork, kept as vector so it stays sharp at 16 px.
  const favicon = path.join(root, 'public', 'favicon.svg')
  await writeFile(favicon, `${SVG}\n`, 'utf8')
  console.log(`[icon] ${path.relative(root, favicon)}`)
}

await main()
