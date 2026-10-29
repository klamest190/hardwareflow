import { Check, FileDown, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { STATUS_COLORS } from '../lib/status'
import { BUTTON } from './ui/button'
import type { ReportExport } from '../services/reportService'

interface ReportExportButtonProps {
  /** Builds and writes the report. Resolves once the file is saved or the export was dropped. */
  onExport: () => Promise<ReportExport>
}

type Phase = 'idle' | 'working' | 'done' | 'failed'

/** How long the outcome stays on the button before it goes back to its resting label. */
const FEEDBACK_MS = 6000

/**
 * The PDF export, as one button that also reports what came of it.
 *
 * Writing a file is one of the few things in this app with an outcome the user cannot
 * see on screen: the report lands in Downloads and opens in the browser, not here. So the
 * button carries the result itself — saved or failed — and names the file it wrote.
 */
export function ReportExportButton({ onExport }: ReportExportButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const settle = (next: Phase, text: string | null) => {
    setPhase(next)
    setMessage(text)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setPhase('idle')
      setMessage(null)
    }, FEEDBACK_MS)
  }

  const run = async () => {
    if (phase === 'working') return
    setPhase('working')
    setMessage(null)

    try {
      const result = await onExport()
      if (result.status === 'cancelled') {
        setPhase('idle')
        return
      }
      settle(result.status === 'error' ? 'failed' : 'done', result.message)
    } catch (cause) {
      settle('failed', cause instanceof Error ? cause.message : 'Der Report konnte nicht erstellt werden.')
    }
  }

  const { Icon, label, spin } = {
    idle: { Icon: FileDown, label: 'PDF-Report', spin: false },
    working: { Icon: Loader2, label: 'Wird erstellt …', spin: true },
    done: { Icon: Check, label: 'Gespeichert', spin: false },
    failed: { Icon: TriangleAlert, label: 'Fehlgeschlagen', spin: false },
  }[phase]

  // Success is the expected outcome and stays neutral; only a failure takes a colour.
  const accent = phase === 'failed' ? STATUS_COLORS.critical : undefined

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void run()}
        disabled={phase === 'working'}
        title="Alle Hardware-Daten als PDF in Downloads speichern und im Browser öffnen"
        className={BUTTON}
        style={accent ? { borderColor: accent, color: accent } : undefined}
      >
        <Icon aria-hidden size={14} className={spin ? 'animate-spin' : undefined} />
        {label}
      </button>

      {message && (
        <p
          role="status"
          className="absolute top-full right-0 z-10 mt-1.5 max-w-96 truncate rounded-md border border-hairline bg-surface-2 px-3 py-1.5 text-xs text-ink-2 shadow-lg"
          title={message}
        >
          {message}
        </p>
      )}
    </div>
  )
}
