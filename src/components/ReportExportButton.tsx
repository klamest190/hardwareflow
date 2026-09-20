import { Check, FileDown, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { STATUS_COLORS } from '../lib/status'
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
 * see on screen: the report opens in their PDF viewer, not here. So the button carries
 * the result itself — saved, cancelled, or failed — instead of leaving a save dialog to
 * close silently.
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

  const accent = phase === 'done' ? STATUS_COLORS.good : phase === 'failed' ? STATUS_COLORS.critical : undefined

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void run()}
        disabled={phase === 'working'}
        title="Alle Hardware-Daten als PDF-Bericht sichern"
        className="flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2.5 text-xs font-medium text-ink-2 transition-colors hover:border-baseline hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cpu disabled:opacity-70"
        style={accent ? { borderColor: `${accent}59`, color: accent } : undefined}
      >
        <Icon aria-hidden size={13} className={spin ? 'animate-spin' : undefined} />
        {label}
      </button>

      {message && (
        <p
          role="status"
          className="absolute top-full right-0 z-10 mt-1.5 max-w-80 truncate rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-2 shadow-lg"
          title={message}
        >
          {message}
        </p>
      )}
    </div>
  )
}
