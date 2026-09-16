import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  shell,
  Tray,
} from 'electron'
import os from 'node:os'
import path from 'node:path'

import { AlertEngine } from '../src/lib/alerts'
import type { DesktopSettings } from '../src/types/bridge'
import type { HardwareAlert, HardwareReading } from '../src/types/hardware'
import { HardwareProbe } from './hardwareProbe'
import { HistoryStore } from './historyStore'
import { isShowablePath, killProcesses } from './processControl'
import { applySettings, currentSettings, HIDDEN_ARG, storedSettings, storeSettings } from './settings'
import { renderTrayIcon, TRAY_ICON_SIZE } from './trayIcon'
import { loadWindowState, saveWindowState, settledSize } from './windowState'

/**
 * Electron main process: owns the windows, the tray, the probe, the history and the
 * notifications.
 *
 * The renderer gets no Node access at all — it receives readings over IPC and can call
 * back only through the handful of functions in `preload.ts`.
 *
 * A system monitor is most useful when it is *not* on screen: it keeps recording
 * history and watching for trouble while the window is hidden in the tray, and the mini
 * view keeps the three numbers that matter visible above everything else.
 */

// `getAppPath()` is the project root when unpackaged and the asar root when
// packaged, so both builds resolve without `__dirname` / `import.meta.url` games.
const APP_ROOT = app.getAppPath()
const DIST_ELECTRON = path.join(APP_ROOT, 'dist-electron')
const RENDERER_DIST = path.join(APP_ROOT, 'dist')
const ICON_PATH = path.join(RENDERER_DIST, 'icon.png')

/** Set by `scripts/dev-electron.mjs`; absent in a packaged app. */
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

const SELFTEST = Boolean(process.env.HARDWAREFLOW_SELFTEST)

// The self-test gets a throwaway profile: it must neither collide with an instance the
// user has running (the single-instance lock is per profile) nor write test minutes into
// their history, settings and remembered page.
if (SELFTEST) app.setPath('userData', path.join(os.tmpdir(), 'hardwareflow-selftest'))

/** Same notification twice within this window is noise, not information. */
const NOTIFICATION_COOLDOWN_MS = 30 * 60_000
/** The tray tooltip does not need to be rewritten every second. */
const TOOLTIP_INTERVAL_MS = 5000

const MINI_WIDTH = 320
const MINI_HEIGHT = 212

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let probe: HardwareProbe | null = null
const history = new HistoryStore()
// Thresholds are applied once settings are readable, in `whenReady`.
const alerts = new AlertEngine()
const lastNotified = new Map<string, number>()
let lastTooltipAt = 0
/** Set on the way out, so closing the window quits instead of hiding to the tray. */
let quitting = false

/** Readings the probe has actually produced. Only read by the self-test. */
let readingsTaken = 0

const webPreferences = {
  preload: path.join(DIST_ELECTRON, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}

/** Loads the renderer, optionally into one of its alternative views (`#mini`). */
function loadRenderer(target: BrowserWindow, hash?: string) {
  if (DEV_SERVER_URL) {
    void target.loadURL(hash ? `${DEV_SERVER_URL}#${hash}` : DEV_SERVER_URL)
  } else {
    void target.loadFile(path.join(RENDERER_DIST, 'index.html'), hash ? { hash } : undefined)
  }
}

/** Nothing in this app should navigate away or open a window of its own making. */
function lockNavigation(target: BrowserWindow) {
  target.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  target.webContents.on('will-navigate', (event, url) => {
    if (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL)) return
    event.preventDefault()
  })
}

function createMainWindow(show: boolean) {
  const state = loadWindowState()

  mainWindow = new BrowserWindow({
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
    icon: ICON_PATH,
    webPreferences,
  })

  if (state.maximized) mainWindow.maximize()
  if (show) mainWindow.once('ready-to-show', () => mainWindow?.show())

  const target = mainWindow
  target.on('close', (event) => {
    // Persist on close rather than on every resize event: `getNormalBounds` gives the
    // restored geometry even while maximised, so both facts survive together.
    const bounds = target.getNormalBounds()
    const { width, height } = settledSize(state, bounds)
    saveWindowState({ x: bounds.x, y: bounds.y, width, height, maximized: target.isMaximized() })

    if (quitting || !tray || !storedSettings().closeToTray) {
      app.quit()
      return
    }

    event.preventDefault()
    target.hide()
    if (!storedSettings().trayHintShown && !SELFTEST) {
      storeSettings({ trayHintShown: true })
      notify(
        'HardwareFlow läuft weiter',
        'Die Messung und der Verlauf laufen im Infobereich weiter. Beenden über das Tray-Menü.',
      )
    }
  })
  target.on('closed', () => {
    mainWindow = null
  })

  lockNavigation(target)
  loadRenderer(target)
}

function showDashboard() {
  if (!mainWindow) createMainWindow(true)
  const target = mainWindow!
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}

/** Small, frameless, always on top, bottom-right above the taskbar. */
function openMiniView() {
  if (miniWindow) {
    miniWindow.show()
    miniWindow.focus()
    return
  }

  const { workArea } = screen.getPrimaryDisplay()
  miniWindow = new BrowserWindow({
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    x: workArea.x + workArea.width - MINI_WIDTH - 16,
    y: workArea.y + workArea.height - MINI_HEIGHT - 16,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0a0b0f',
    show: false,
    title: 'HardwareFlow Mini',
    icon: ICON_PATH,
    webPreferences,
  })
  // Above full-screen windows too, which is where people watch temperatures while gaming.
  miniWindow.setAlwaysOnTop(true, 'floating')
  miniWindow.once('ready-to-show', () => miniWindow?.showInactive())
  miniWindow.on('closed', () => {
    miniWindow = null
  })
  lockNavigation(miniWindow)
  loadRenderer(miniWindow, 'mini')
}

function notify(title: string, body: string) {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, icon: ICON_PATH })
  notification.on('click', showDashboard)
  notification.show()
}

function notifyAlerts(fired: HardwareAlert[]) {
  if (fired.length === 0 || !storedSettings().notifications) return
  const now = Date.now()
  for (const alert of fired) {
    const last = lastNotified.get(alert.key) ?? 0
    if (now - last < NOTIFICATION_COOLDOWN_MS) continue
    lastNotified.set(alert.key, now)
    notify(alert.title, alert.message)
  }
}

function buildTrayMenu() {
  if (!tray) return
  const settings = currentSettings()
  const toggle = (patch: Partial<DesktopSettings>) => {
    applySettings(patch)
    buildTrayMenu()
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Dashboard öffnen', click: showDashboard },
      { label: 'Mini-Ansicht', click: openMiniView },
      { type: 'separator' },
      {
        label: settings.autostartAvailable
          ? 'Mit Windows starten'
          : 'Mit Windows starten (nur installierte App)',
        type: 'checkbox',
        checked: settings.autostart,
        enabled: settings.autostartAvailable,
        click: (item) => toggle({ autostart: item.checked }),
      },
      {
        label: 'Warnungen als Benachrichtigung',
        type: 'checkbox',
        checked: settings.notifications,
        click: (item) => toggle({ notifications: item.checked }),
      },
      {
        label: 'Beim Schließen im Tray weiterlaufen',
        type: 'checkbox',
        checked: settings.closeToTray,
        click: (item) => toggle({ closeToTray: item.checked }),
      },
      { type: 'separator' },
      { label: 'Beenden', click: () => app.quit() },
    ]),
  )
}

function createTray() {
  // The app icon until the first reading replaces it with the live gauge.
  const image = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 })
  tray = new Tray(image)
  tray.setToolTip('HardwareFlow')
  tray.on('click', showDashboard)
  buildTrayMenu()
}

/** Tooltip and the live gauge icon, on the same five-second beat. */
function updateTray(reading: HardwareReading) {
  const now = Date.now()
  if (!tray || now - lastTooltipAt < TOOLTIP_INTERVAL_MS) return
  lastTooltipAt = now
  const memory =
    reading.memory.totalBytes > 0 ? (reading.memory.usedBytes / reading.memory.totalBytes) * 100 : 0
  const gpu = reading.gpus[0]?.usagePercent

  tray.setImage(
    nativeImage.createFromBitmap(renderTrayIcon(reading.cpuLoad.usagePercent, memory), {
      width: TRAY_ICON_SIZE,
      height: TRAY_ICON_SIZE,
      scaleFactor: 2,
    }),
  )
  tray.setToolTip(
    [
      'HardwareFlow',
      `CPU ${Math.round(reading.cpuLoad.usagePercent)} %`,
      `RAM ${Math.round(memory)} %`,
      gpu == null ? null : `GPU ${Math.round(gpu)} %`,
    ]
      .filter(Boolean)
      .join(' · '),
  )
}

function broadcast(channel: string, payload: unknown) {
  for (const target of [mainWindow, miniWindow]) {
    if (target && !target.isDestroyed()) target.webContents.send(channel, payload)
  }
}

async function startProbe() {
  probe = new HardwareProbe({
    intervalMs: 1000,
    onStatus: (message) => {
      if (message) console.error('[hardwareflow] Probe-Fehler:', message)
      broadcast('hardware:error', message)
    },
  })

  // A failing warm-up must not stop the stream. Some tiers will have read fine, and a
  // dashboard that shows what it has beats one stuck on "Hardware wird ausgelesen …"
  // with no explanation.
  try {
    await probe.warmUp()
  } catch (error) {
    broadcast('hardware:error', error instanceof Error ? error.message : String(error))
  }

  probe.start((reading) => {
    readingsTaken += 1
    broadcast('hardware:reading', reading)
    history.record(reading)
    const { fired } = alerts.update(reading)
    history.logAlerts(fired)
    notifyAlerts(fired)
    updateTray(reading)
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

ipcMain.handle('history:get', () => history.all())

ipcMain.handle('history:alerts', () => history.alertLog())

ipcMain.handle('process:kill', (_event, name: unknown, pids: unknown) => {
  if (typeof name !== 'string' || !Array.isArray(pids)) {
    return { ended: 0, failed: [], refused: 'Ungültige Anfrage.' }
  }
  return killProcesses(name, pids.filter((pid): pid is number => typeof pid === 'number'))
})

ipcMain.handle('process:showInFolder', (_event, target: unknown) => {
  if (typeof target === 'string' && isShowablePath(target)) shell.showItemInFolder(target)
})

ipcMain.handle('settings:get', () => currentSettings())

ipcMain.handle('settings:update', (_event, patch: Partial<DesktopSettings>) => {
  const next = applySettings(patch)
  alerts.setThresholds(next.thresholds)
  buildTrayMenu()
  return next
})

ipcMain.handle('window:openMini', () => openMiniView())

ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())

ipcMain.handle('window:showDashboard', () => showDashboard())

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Headless-Selbsttest (`npm run selftest:app`): wartet, bis der Renderer gezeichnet
 * hat, bedient den Pause-Knopf, öffnet jede Seite der Navigation und die Mini-Ansicht
 * und beendet die App. Prüft damit die komplette Kette Probe → IPC → Preload → React
 * und wieder zurück, was sich sonst nur von Hand am Fenster verifizieren lässt.
 */
async function runSelfTest() {
  const target = mainWindow
  if (!target) {
    console.error('[selftest] Kein Fenster erzeugt')
    app.exit(1)
    return
  }

  // React logs a broken render to the console rather than blanking the page, so a test
  // that only reads text would pass while the UI is quietly falling apart.
  const consoleErrors: string[] = []
  const watchConsole = (window: BrowserWindow, name: string) =>
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error' || event.level === 'warning') {
        consoleErrors.push(`${name} ${event.level}: ${event.message}`)
      }
    })
  watchConsole(target, 'Dashboard')

  // Ein verdecktes oder minimiertes Fenster rendert gedrosselt; dann hinkt die Seite dem
  // Klick hinterher und die Textprüfung schlägt zufällig fehl.
  target.webContents.setBackgroundThrottling(false)

  await wait(5000)
  const text = (await target.webContents.executeJavaScript('document.body.innerText')) as string
  console.log(`[selftest] Sichtbarer Text der Startseite:\n${text}`)

  // Case-insensitive: `innerText` applies CSS `uppercase`, so labels read "RESERVE".
  const contains = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase())

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

  // Feste Wartezeiten reichen auf einem ausgelasteten Rechner nicht: gewartet wird, bis
  // das UI den Klick sichtbar übernommen hat, höchstens zehn Sekunden.
  const waitFor = async (condition: () => Promise<boolean>, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await condition()) return true
      await wait(200)
    }
    return false
  }
  const buttonShows = (label: string) =>
    target.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].some((b) => b.textContent.includes(${JSON.stringify(label)}))`,
    ) as Promise<boolean>

  await clickButton('Pausieren')
  if (!(await waitFor(() => buttonShows('Fortsetzen')))) problems.push('Pause-Knopf reagiert nicht')
  // Ein WMI-Aufruf, der beim Pausieren schon lief, darf noch zu Ende laufen.
  await wait(2500)
  const whilePaused = readingsTaken
  await wait(3000)
  const stillPaused = readingsTaken
  console.log(`[selftest] Messungen pausiert: ${whilePaused} → ${stillPaused} (erwartet: gleich)`)
  if (stillPaused !== whilePaused) {
    problems.push(`Pause stoppt die Messung nicht — ${stillPaused - whilePaused} Messungen in 3 s`)
  }
  if (probe?.countersRunning) problems.push('Pause beendet den PowerShell-Prozess für die Leistungsindikatoren nicht')

  await clickButton('Fortsetzen')
  await waitFor(() => buttonShows('Pausieren'))
  await waitFor(async () => readingsTaken > stillPaused)
  console.log(`[selftest] Messungen fortgesetzt: ${stillPaused} → ${readingsTaken}`)
  if (readingsTaken <= stillPaused) problems.push('Fortsetzen startet die Messung nicht')
  if (process.platform === 'win32' && !(await waitFor(async () => probe?.countersRunning === true))) {
    problems.push('Fortsetzen startet den PowerShell-Prozess für die Leistungsindikatoren nicht')
  }

  // Optional: jede Seite als PNG, um das Layout anzusehen statt nur den Text zu prüfen.
  // HARDWAREFLOW_SCREENSHOTS=<Ordner> npm run selftest:app
  const screenshotDir = process.env.HARDWAREFLOW_SCREENSHOTS
  const screenshot = async (window: BrowserWindow, name: string) => {
    if (!screenshotDir) return
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(screenshotDir, { recursive: true })
    const contents = window.webContents
    const height = (await contents.executeJavaScript('document.documentElement.scrollHeight')) as number
    const width = (await contents.executeJavaScript('document.documentElement.clientWidth')) as number
    contents.debugger.attach()
    const shot = (await contents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    })) as { data: string }
    contents.debugger.detach()
    const file = path.join(screenshotDir, `${name}.png`)
    writeFileSync(file, Buffer.from(shot.data, 'base64'))
    console.log(`[selftest] Screenshot: ${file}`)
  }

  // Jede Seite über die Navigation öffnen und an einem Inhalt erkennen, der nur dort steht.
  const pages: Array<{ nav: string; expect: string[]; optional?: boolean }> = [
    { nav: 'Übersicht', expect: ['HardwareFlow Score', 'Prozessor', 'Massenspeicher', 'Reserve'] },
    { nav: 'Netzwerk', expect: ['Empfang', 'Senden'] },
    { nav: 'Prozesse', expect: ['nach Programm gruppiert'] },
    // Nur auf Rechnern mit Akku in der Navigation.
    { nav: 'Akku', expect: ['Zustand', 'Zyklen'], optional: true },
    { nav: 'Verlauf', expect: ['Minutenwerte'] },
    { nav: 'Einstellungen', expect: ['Mit Windows starten'] },
  ]
  for (const page of pages) {
    const navText = (await target.webContents.executeJavaScript(
      `document.querySelector('nav')?.innerText ?? ''`,
    )) as string
    if (!navText.includes(page.nav)) {
      if (!page.optional) problems.push(`Navigation ohne "${page.nav}"`)
      continue
    }
    await clickButton(page.nav)
    const arrived = await waitFor(
      async () =>
        ((await target.webContents.executeJavaScript(`document.querySelector('h1')?.textContent ?? ''`)) as string) ===
        page.nav,
    )
    if (!arrived) problems.push(`Navigation zu "${page.nav}" hat die Seite nicht gewechselt`)
    // Karten blenden gestaffelt ein; der Screenshot soll den fertigen Zustand zeigen.
    await wait(800)
    const pageText = (await target.webContents.executeJavaScript('document.body.innerText')) as string
    for (const expected of page.expect) {
      if (!contains(pageText, expected)) problems.push(`Seite "${page.nav}": "${expected}" fehlt`)
    }
    console.log(`[selftest] Seite ${page.nav}: geprüft`)
    await screenshot(target, `seite-${page.nav.toLowerCase().replace('ü', 'ue')}`)
  }
  await clickButton('Übersicht')

  // Mini-Ansicht über die Navigation öffnen. Sie darf die Messung nicht anhalten oder
  // fortsetzen — sie ist nur ein zweiter Zuschauer.
  await clickButton('Mini-Ansicht')
  await wait(3000)
  if (!miniWindow) {
    problems.push('Mini-Ansicht wurde nicht geöffnet')
  } else {
    watchConsole(miniWindow, 'Mini')
    await wait(1500)
    const miniText = (await miniWindow.webContents.executeJavaScript('document.body.innerText')) as string
    console.log(`[selftest] Mini-Ansicht:\n${miniText}`)
    for (const expected of ['CPU', 'RAM', 'Reserve']) {
      if (!contains(miniText, expected)) problems.push(`"${expected}" fehlt in der Mini-Ansicht`)
    }
    await screenshot(miniWindow, 'mini')
  }

  // Leistungsindikatoren: Der PowerShell-Leser muss Disk-I/O fürs Systemlaufwerk und eine
  // GPU-Auslastung für jeden Adapter liefern. Die erste WMI-Abfrage einer frischen Sitzung
  // ist langsam, daher bis zu einer Minute.
  if (process.platform === 'win32') {
    const countersComplete = () => {
      const reading = probe?.reading()
      const systemDrive = reading?.drives.find((drive) => drive.system)
      return Boolean(systemDrive && systemDrive.readMbPerSec !== null && reading?.gpus.every((gpu) => gpu.usagePercent !== null))
    }
    const countersArrived = await waitFor(async () => countersComplete(), 60_000)
    const reading = probe?.reading()
    const systemRead = reading?.drives.find((drive) => drive.system)?.readMbPerSec
    const gpuLoads = reading?.gpus.map((gpu) => `${gpu.model} ${gpu.usagePercent ?? 'n/v'} %`).join(', ')
    console.log(`[selftest] Leistungsindikatoren: C: ${systemRead?.toFixed(2) ?? 'n/v'} MB/s lesen · ${gpuLoads}`)
    if (!countersArrived) {
      problems.push('Leistungsindikatoren liefern nach 60 s nicht Disk-I/O und GPU-Auslastung für alle Adapter')
    }
  }

  // Desktop-Verhalten: Tray vorhanden, Schließen versteckt nur (wenn so eingestellt).
  if (!tray) problems.push('Kein Tray-Symbol')
  if (tray && storedSettings().closeToTray) {
    target.close()
    await wait(500)
    if (target.isDestroyed()) problems.push('Schließen beendet das Fenster, statt es in den Tray zu legen')
    else if (target.isVisible()) problems.push('Fenster bleibt nach dem Schließen sichtbar')
    else console.log('[selftest] Schließen legt das Fenster in den Tray: ok')
    showDashboard()
  }

  // Nur in der installierten App: Autostart setzen, zurücklesen, alten Zustand herstellen.
  if (process.env.HARDWAREFLOW_EXPECT_PACKAGED) {
    if (!app.isPackaged) problems.push('Erwartet installierte App, läuft aber unpaketiert')
    const before = currentSettings().autostart
    applySettings({ autostart: !before })
    const toggled = currentSettings().autostart
    applySettings({ autostart: before })
    const restored = currentSettings().autostart
    console.log(`[selftest] Autostart: ${before} → ${toggled} → ${restored}`)
    if (toggled === before || restored !== before) problems.push('Autostart lässt sich nicht schalten')
  }

  for (const message of consoleErrors) problems.push(`Renderer-Konsole — ${message}`)

  // Ein Tray-Symbol überlebt sonst den Prozess, bis jemand mit der Maus darüberfährt.
  tray?.destroy()

  if (problems.length === 0) {
    console.log('[selftest] OK — alle Seiten und die Mini-Ansicht zeigen Live-Messwerte, Konsole sauber')
    app.exit(0)
    return
  }

  console.error('[selftest] FEHLER:')
  for (const problem of problems) console.error(`  - ${problem}`)
  app.exit(1)
}

// One instance is the whole app; a second launch should just bring the first forward.
if (!app.requestSingleInstanceLock()) {
  // Silently quitting would let a self-test pass without having run.
  if (SELFTEST) {
    console.error('[selftest] FEHLER: Einzelinstanz-Sperre nicht erhalten')
    app.exit(1)
  } else {
    app.quit()
  }
} else {
  // Without it, Windows attributes notifications to "electron.app.HardwareFlow".
  app.setAppUserModelId('com.hardwareflow.desktop')

  app.on('second-instance', showDashboard)

  void app.whenReady().then(async () => {
    history.load()
    alerts.setThresholds(storedSettings().thresholds)
    createTray()
    createMainWindow(!process.argv.includes(HIDDEN_ARG))
    await startProbe()

    app.on('activate', showDashboard)

    if (SELFTEST) void runSelfTest()
  })

  // With a tray the app deliberately outlives its windows; `app.quit()` ends it.
  app.on('window-all-closed', () => {
    if (!tray) app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    probe?.stop()
    history.close()
  })
}
