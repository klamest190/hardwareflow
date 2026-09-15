import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'

import { HardwareProbe } from './hardwareProbe'
import { loadWindowState, saveWindowState, settledSize } from './windowState'

/**
 * Electron main process: owns the window and the hardware probe.
 *
 * The renderer gets no Node access at all — it receives readings over IPC and can call
 * back only through the handful of functions in `preload.ts`.
 */

// `getAppPath()` is the project root when unpackaged and the asar root when
// packaged, so both builds resolve without `__dirname` / `import.meta.url` games.
const APP_ROOT = app.getAppPath()
const DIST_ELECTRON = path.join(APP_ROOT, 'dist-electron')
const RENDERER_DIST = path.join(APP_ROOT, 'dist')

/** Set by `scripts/dev-electron.mjs`; absent in a packaged app. */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let window: BrowserWindow | null = null
let probe: HardwareProbe | null = null

/** Readings the probe has actually produced. Only read by the self-test. */
let readingsTaken = 0

function createWindow() {
  const state = loadWindowState()

  window = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 700,
    // Matches the app's page plane, so the frame does not flash white on open.
    backgroundColor: '#0a0b0f',
    show: false,
    autoHideMenuBar: true,
    title: 'HardwareFlow',
    icon: path.join(RENDERER_DIST, 'icon.png'),
    webPreferences: {
      preload: path.join(DIST_ELECTRON, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (state.maximized) window.maximize()
  window.once('ready-to-show', () => window?.show())

  // Persist on close rather than on every resize event: `getNormalBounds` gives the
  // restored geometry even while maximised, so both facts survive together.
  const persist = () => {
    if (!window || window.isDestroyed()) return
    const bounds = window.getNormalBounds()
    const { width, height } = settledSize(state, bounds)
    saveWindowState({ x: bounds.x, y: bounds.y, width, height, maximized: window.isMaximized() })
  }
  window.on('close', persist)

  // Nothing in this app should navigate away or open a second window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL)) return
    event.preventDefault()
  })

  window.on('closed', () => {
    window = null
  })

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL)
  } else {
    void window.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function send(channel: string, payload: unknown) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
}

async function startProbe() {
  probe = new HardwareProbe({
    intervalMs: 1000,
    onStatus: (message) => {
      if (message) console.error('[hardwareflow] Probe-Fehler:', message)
      send('hardware:error', message)
    },
  })

  // A failing warm-up must not stop the stream. Some tiers will have read fine, and a
  // dashboard that shows what it has beats one stuck on "Hardware wird ausgelesen …"
  // with no explanation.
  try {
    await probe.warmUp()
  } catch (error) {
    send('hardware:error', error instanceof Error ? error.message : String(error))
  }

  probe.start((reading) => {
    readingsTaken += 1
    send('hardware:reading', reading)
  })
}

ipcMain.handle('hardware:getReading', async () => {
  if (!probe) throw new Error('Hardware-Probe ist nicht aktiv')
  return probe.reading()
})

// Pausing stops the WMI polling itself, not just the delivery — see `HardwareProbe.pause`.
ipcMain.handle('hardware:setPaused', (_event, paused: boolean) => {
  if (!probe) return
  if (paused) probe.pause()
  else probe.resume()
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Headless-Selbsttest (`npm run selftest:app`): wartet, bis der Renderer gezeichnet
 * hat, liest den sichtbaren Text aus, bedient den Pause-Knopf und beendet die App.
 * Prüft damit die komplette Kette Probe → IPC → Preload → React und wieder zurück,
 * was sich sonst nur von Hand am Fenster verifizieren lässt.
 */
async function runSelfTest() {
  const target = window
  if (!target) {
    console.error('[selftest] Kein Fenster erzeugt')
    app.exit(1)
    return
  }

  // React logs a broken render to the console rather than blanking the page, so a test
  // that only reads text would pass while the UI is quietly falling apart.
  const consoleErrors: string[] = []
  target.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      consoleErrors.push(`${event.level}: ${event.message}`)
    }
  })

  await wait(5000)
  const text = (await target.webContents.executeJavaScript('document.body.innerText')) as string
  console.log(`[selftest] Sichtbarer Text:\n${text}`)

  const problems: string[] = []
  if (!text.includes('Live-Messung')) problems.push('keine Live-Messung im UI')
  if (text.includes('Hardware wird ausgelesen')) problems.push('Renderer hängt im Ladezustand')

  // Pause und Fortsetzen über den echten Knopf, nicht über die Bridge: nur so wird die
  // ganze Kette Klick → Hook → IPC → Probe-Timer geprüft. Gezählt wird dabei im
  // Main-Prozess, nicht im UI — die Anzeige friert schon ein, wenn bloß der Renderer
  // sein Abo schließt, und genau das war der Fehler, den diese Prüfung ausschließen soll.
  const clickButton = (label: string) =>
    target.webContents.executeJavaScript(
      `Boolean([...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(label)}))?.click() ?? true)`,
    )

  await clickButton('Pausieren')
  await wait(1500)
  const whilePaused = readingsTaken
  await wait(3000)
  const stillPaused = readingsTaken
  console.log(`[selftest] Messungen pausiert: ${whilePaused} → ${stillPaused} (erwartet: gleich)`)
  if (stillPaused !== whilePaused) {
    problems.push(`Pause stoppt die Messung nicht — ${stillPaused - whilePaused} Messungen in 3 s`)
  }

  await clickButton('Fortsetzen')
  await wait(3000)
  console.log(`[selftest] Messungen fortgesetzt: ${stillPaused} → ${readingsTaken}`)
  if (readingsTaken <= stillPaused) problems.push('Fortsetzen startet die Messung nicht')

  for (const message of consoleErrors) problems.push(`Renderer-Konsole — ${message}`)

  if (problems.length === 0) {
    console.log('[selftest] OK — Renderer zeigt Live-Messwerte, Konsole sauber')
    app.exit(0)
    return
  }

  console.error('[selftest] FEHLER:')
  for (const problem of problems) console.error(`  - ${problem}`)
  app.exit(1)
}

// One window is the whole app; a second instance should just focus the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  void app.whenReady().then(async () => {
    createWindow()
    await startProbe()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    if (process.env.HARDWAREFLOW_SELFTEST) void runSelfTest()
  })

  app.on('window-all-closed', () => {
    probe?.stop()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => probe?.stop())
}
