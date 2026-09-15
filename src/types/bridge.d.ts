import type { HardwareReading } from './hardware'

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
}

declare global {
  interface Window {
    hardwareflow?: HardwareFlowBridge
  }
}
