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
 * The mark: three channel strips on the app's graphite housing, one of them flagged in the
 * warning amber — the app's idea in one picture: readings stay neutral until one leaves its
 * band. Bars survive 16 px in a taskbar where a line drawing turns to mud, and they echo
 * the two live bars of the tray icon. Same artwork as `src/components/ui/LogoMark.tsx`.
 */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" rx="112" fill="#1e2124"/>
  <rect x="8" y="8" width="496" height="496" rx="104" fill="none" stroke="#3a4047" stroke-width="16"/>
  <rect x="80" y="120" width="232" height="64" rx="14" fill="#e6e3dc"/>
  <rect x="80" y="224" width="352" height="64" rx="14" fill="#f2a93b"/>
  <rect x="80" y="328" width="152" height="64" rx="14" fill="#e6e3dc"/>
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
