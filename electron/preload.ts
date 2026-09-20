import { contextBridge, ipcRenderer } from 'electron'

import type { DesktopSettings, KillResult, PdfReportResult } from '../src/types/bridge'
import type { HardwareReading, HistoryBucket, LoggedAlert } from '../src/types/hardware'

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

  getAlertLog: (): Promise<LoggedAlert[]> => ipcRenderer.invoke('history:alerts'),

  killProcesses: (name: string, pids: number[]): Promise<KillResult> =>
    ipcRenderer.invoke('process:kill', name, pids),

  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke('process:showInFolder', path),

  getSettings: (): Promise<DesktopSettings> => ipcRenderer.invoke('settings:get'),

  updateSettings: (patch: Partial<DesktopSettings>): Promise<DesktopSettings> =>
    ipcRenderer.invoke('settings:update', patch),

  exportPdfReport: (html: string, fileName: string): Promise<PdfReportResult> =>
    ipcRenderer.invoke('report:exportPdf', html, fileName),

  openMiniView: (): Promise<void> => ipcRenderer.invoke('window:openMini'),

  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),

  showDashboard: (): Promise<void> => ipcRenderer.invoke('window:showDashboard'),
})
