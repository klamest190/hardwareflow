import { Pause, Play } from 'lucide-react'
import type { ReactNode } from 'react'

import { formatClockTime } from '../lib/format'
import { STATUS_COLORS } from '../lib/status'
import type { ReportExport } from '../services/reportService'
import type { HardwareSource } from '../types/hardware'
import { ReportExportButton } from './ReportExportButton'
import { BUTTON } from './ui/button'

/**
 * States plainly whether the numbers are measured or simulated — a monitor that cannot be
 * trusted on that point is worse than no monitor. The dot blinks once per reading, so a
 * frozen probe is visible as a dot that stopped.
 */
function SourceBadge({ source, paused, capturedAt }: { source: HardwareSource; paused: boolean; capturedAt: number }) {
  const native = source === 'native'
  const color = native ? (paused ? 'var(--color-muted)' : 'var(--color-ink)') : STATUS_COLORS.warning

  return (
    <span
      className="inline-flex items-center gap-2 text-sm text-ink-2"
      title={
        native
          ? `Werte werden live vom System gemessen · letzter Stand ${formatClockTime(capturedAt)}`
          : 'Kein Hardware-Zugriff im Browser — die Werte kommen aus dem Simulator. Für echte Messwerte "npm run dev" starten.'
      }
    >
      <span
        key={paused ? 'paused' : capturedAt}
        aria-hidden
        className={`size-2 rounded-full ${paused ? '' : 'hf-tick'}`}
        style={{ backgroundColor: color }}
      />
      <span style={native ? undefined : { color }}>
        {native ? (paused ? 'Live-Messung pausiert' : 'Live-Messung') : 'Simulation'}
      </span>
    </span>
  )
}

interface DashboardHeaderProps {
  /** Name of the page on screen. */
  title: string
  /** One line under the title, where the page has something to say about its content. */
  subtitle?: ReactNode
  source: HardwareSource
  capturedAt: number
  paused: boolean
  onTogglePaused: () => void
  /** Writes the PDF report. Absent in views that have no report to write. */
  onExportReport?: () => Promise<ReportExport>
}

/**
 * The page header: which page, whether the numbers are live, and the two actions that
 * apply to every page. Facts about the machine itself live on the device page.
 */
export function DashboardHeader({
  title,
  subtitle,
  source,
  capturedAt,
  paused,
  onTogglePaused,
  onExportReport,
}: DashboardHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <SourceBadge source={source} paused={paused} capturedAt={capturedAt} />
        {onExportReport && <ReportExportButton onExport={onExportReport} />}
        <button type="button" onClick={onTogglePaused} aria-pressed={paused} className={BUTTON}>
          {paused ? <Play aria-hidden size={14} /> : <Pause aria-hidden size={14} />}
          {paused ? 'Fortsetzen' : 'Pausieren'}
        </button>
      </div>
    </header>
  )
}
