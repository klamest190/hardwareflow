import { contextBridge, ipcRenderer } from 'electron'

import type { DesktopSettings } from '../src/types/bridge'
import type { HardwareReading, HistoryBucket } from '../src/types/hardware'

/**
 * The entire surface the renderer gets. No `require`, no filesystem, no direct
 * `ipcRenderer` — only these functions, over a context bridge.
 */
contextBridge.exposeInMainWorld('hardwareflow', {
  platform: process.platform,

  getReading: (): Promise<HardwareReading> => ipcRenderer.invoke('hardware:getReading'),

  setPaused: (paused: boolean): Promise<void> => ipcRenderer.invoke('hardware:setPaused', paused),

  onReading: (listener: (reading: HardwareReading) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, reading: HardwareReading) => listener(reading)
    ipcRenderer.on('hardware:reading', handler)
    return () => ipcRenderer.removeListener('hardware:reading', handler)
  },

  onProbeError: (listener: (message: string | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string | null) => listener(message)
    ipcRenderer.on('hardware:error', handler)
    return () => ipcRenderer.removeListener('hardware:error', handler)
  },

  getHistory: (): Promise<HistoryBucket[]> => ipcRenderer.invoke('history:get'),

  getSettings: (): Promise<DesktopSettings> => ipcRenderer.invoke('settings:get'),

  updateSettings: (patch: Partial<DesktopSettings>): Promise<DesktopSettings> =>
    ipcRenderer.invoke('settings:update', patch),

  openMiniView: (): Promise<void> => ipcRenderer.invoke('window:openMini'),

  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),

  showDashboard: (): Promise<void> => ipcRenderer.invoke('window:showDashboard'),
})
