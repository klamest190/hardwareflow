import type { HardwareReading, HistoryBucket } from './hardware'

/** Desktop settings the main process owns and persists. */
export interface DesktopSettings {
  /** Start with Windows, hidden in the tray. Only possible in the installed app. */
  autostart: boolean
  /** `false` in a development build, where a login item would point at electron.exe. */
  autostartAvailable: boolean
  /** Desktop notifications for the conditions in `lib/alerts.ts`. */
  notifications: boolean
  /** Closing the window hides it in the tray instead of quitting. */
  closeToTray: boolean
}

/**
 * The surface the Electron preload script exposes to the renderer. Absent when the
 * app runs in a plain browser, which is how the facade decides between the native
 * probe and the simulation.
 */
export interface HardwareFlowBridge {
  /** `process.platform` of the main process. */
  readonly platform: string
  /** One measurement on demand — used for the first paint. */
  getReading(): Promise<HardwareReading>
  /** Stops or restarts the polling itself, so a paused dashboard stops measuring. */
  setPaused(paused: boolean): Promise<void>
  /** Subscribes to the probe's stream. Returns an unsubscribe function. */
  onReading(listener: (reading: HardwareReading) => void): () => void
  /**
   * Errors raised inside the probe, so the UI can say what broke — and `null` once
   * every tier reads cleanly again, so the warning can be retracted.
   */
  onProbeError(listener: (message: string | null) => void): () => void
  /** Stored per-minute history, oldest first, up to a week. */
  getHistory(): Promise<HistoryBucket[]>
  getSettings(): Promise<DesktopSettings>
  /** Applies a partial update and returns the settings as they now stand. */
  updateSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>
  /** Opens the always-on-top mini view, or focuses it. */
  openMiniView(): Promise<void>
  /** Closes the window this renderer lives in — the mini view's own close button. */
  closeWindow(): Promise<void>
  /** Brings the full dashboard to the front — from the mini view. */
  showDashboard(): Promise<void>
}

declare global {
  interface Window {
    hardwareflow?: HardwareFlowBridge
  }
}
