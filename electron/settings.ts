import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import type { DesktopSettings } from '../src/types/bridge'

/**
 * Desktop settings. Autostart is not stored here: Windows keeps the login item itself,
 * and reading it back from the OS means a user who removes it in the Task Manager sees
 * the switch turn off here too.
 */

interface StoredSettings {
  notifications: boolean
  closeToTray: boolean
  /** Set once the "still running in the tray" hint has been shown. */
  trayHintShown: boolean
}

const DEFAULTS: StoredSettings = { notifications: true, closeToTray: true, trayHintShown: false }

/** Started by the login item — open straight into the tray. */
export const HIDDEN_ARG = '--hidden'

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

let cached: StoredSettings | null = null

export function storedSettings(): StoredSettings {
  if (cached) return cached
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<StoredSettings>
    cached = {
      notifications: typeof saved.notifications === 'boolean' ? saved.notifications : DEFAULTS.notifications,
      closeToTray: typeof saved.closeToTray === 'boolean' ? saved.closeToTray : DEFAULTS.closeToTray,
      trayHintShown: saved.trayHintShown === true,
    }
  } catch {
    cached = { ...DEFAULTS }
  }
  return cached
}

export function storeSettings(patch: Partial<StoredSettings>): StoredSettings {
  cached = { ...storedSettings(), ...patch }
  try {
    const file = settingsFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(cached, null, 2), 'utf8')
  } catch {
    // A setting that does not survive a restart is not worth an error dialog.
  }
  return cached
}

/**
 * Only the installed app may register itself: in development the executable is the
 * shared electron.exe, and a login item pointing there would start a bare Electron
 * window at every boot.
 */
export const autostartAvailable = () => app.isPackaged

export function currentSettings(): DesktopSettings {
  const stored = storedSettings()
  return {
    autostart: autostartAvailable() && app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin,
    autostartAvailable: autostartAvailable(),
    notifications: stored.notifications,
    closeToTray: stored.closeToTray,
  }
}

export function applySettings(patch: Partial<DesktopSettings>): DesktopSettings {
  if (typeof patch.autostart === 'boolean' && autostartAvailable()) {
    app.setLoginItemSettings({ openAtLogin: patch.autostart, args: [HIDDEN_ARG] })
  }
  const stored: Partial<StoredSettings> = {}
  if (typeof patch.notifications === 'boolean') stored.notifications = patch.notifications
  if (typeof patch.closeToTray === 'boolean') stored.closeToTray = patch.closeToTray
  if (Object.keys(stored).length > 0) storeSettings(stored)
  return currentSettings()
}
