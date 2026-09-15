import { contextBridge, ipcRenderer } from 'electron'

import type { HardwareReading } from '../src/types/hardware'

/**
 * The entire surface the renderer gets. No `require`, no filesystem, no direct
 * `ipcRenderer` — only these four functions, over a context bridge.
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
})
