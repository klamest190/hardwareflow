import { FolderOpen, X } from 'lucide-react'
import { useState } from 'react'

import { useProgramInfo } from '../hooks/useProgramInfo'
import { formatBytes, formatPercent } from '../lib/format'
import { STATUS_COLORS } from '../lib/status'
import type { KillResult, ProgramInfo } from '../types/bridge'
import type { ProcessGroup, ProcessSummary } from '../types/hardware'
import { Card } from './ui/Card'

/** What the card may do to a process — only offered in the desktop app. */
export interface ProcessActions {
  kill: (group: ProcessGroup) => Promise<KillResult>
  showInFolder: (path: string) => void
}

interface ProcessesCardProps {
  processes: ProcessSummary | null
  /** Installed RAM, so a program's memory bar is its share of the machine. */
  memoryTotalBytes: number
  /** `null` in the browser, where there is nothing to end. */
  actions?: ProcessActions | null
  className?: string
}

interface ProcessListProps {
  title: string
  /** What 100 % of the bar is. */
  scale: string
  groups: ProcessGroup[]
  value: (group: ProcessGroup) => string
  /** Bar length, 0–100 — the program's share of the whole machine. */
  share: (group: ProcessGroup) => number
  info: Record<string, ProgramInfo>
  actions: ProcessActions | null
  /** Program awaiting confirmation, shared by both lists so only one row asks at a time. */
  confirming: string | null
  onConfirm: (name: string | null) => void
  onKill: (group: ProcessGroup) => void
}

const ICON_BUTTON =
  'grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink'

const exeName = (name: string) => name.replace(/\.exe$/i, '')

/** The program's own icon, or an empty square of the same size so names stay aligned. */
function ProgramIcon({ src }: { src: string | null | undefined }) {
  if (!src) return <span aria-hidden className="size-4 shrink-0 rounded-[3px] bg-surface-2" />
  return <img src={src} alt="" aria-hidden className="size-4 shrink-0" />
}

function ProcessList({ title, scale, groups, value, share, info, actions, confirming, onConfirm, onKill }: ProcessListProps) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2">
        <h3 className="text-md font-semibold text-ink">{title}</h3>
        <span className="text-xs text-muted">{scale}</span>
      </div>
      <ol className="divide-y divide-hairline">
        {groups.map((group) => {
          const asking = confirming === group.name
          const program = group.path ? info[group.path] : undefined
          const name = program?.description ?? exeName(group.name)

          return (
            <li key={group.name} className="group py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5" title={group.path ?? group.name}>
                  <ProgramIcon src={program?.icon} />
                  <span className="min-w-0 truncate text-sm text-ink">{name}</span>
                  {program?.description && <span className="hidden shrink-0 text-xs text-muted sm:inline">{exeName(group.name)}</span>}
                  {group.instances > 1 && <span className="shrink-0 text-xs text-muted tabular-nums">×{group.instances}</span>}
                </span>

                {asking ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-sm">
                    <span className="text-ink-2">{group.instances > 1 ? `Alle ${group.instances} beenden?` : 'Beenden?'}</span>
                    <button
                      type="button"
                      onClick={() => onKill(group)}
                      className="rounded-md px-2 py-0.5 font-semibold text-plane"
                      style={{ backgroundColor: STATUS_COLORS.critical }}
                    >
                      Beenden
                    </button>
                    <button
                      type="button"
                      onClick={() => onConfirm(null)}
                      className="rounded-md border border-hairline px-2 py-0.5 text-ink-2 hover:text-ink"
                    >
                      Abbrechen
                    </button>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    {actions && (
                      // Hidden until the row is pointed at or focused, so the list stays calm.
                      <span className="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                        {group.path && (
                          <button
                            type="button"
                            className={ICON_BUTTON}
                            onClick={() => actions.showInFolder(group.path!)}
                            aria-label={`Speicherort von ${name} öffnen`}
                            title="Speicherort öffnen"
                          >
                            <FolderOpen aria-hidden size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          className={ICON_BUTTON}
                          onClick={() => onConfirm(group.name)}
                          aria-label={`${name} beenden`}
                          title="Beenden"
                        >
                          <X aria-hidden size={14} />
                        </button>
                      </span>
                    )}
                    <span className="hf-figure w-16 text-right text-sm font-semibold text-ink">{value(group)}</span>
                  </span>
                )}
              </div>
              <div className="mt-1.5 ml-[26px] h-1 overflow-hidden rounded-[2px] bg-surface-2" aria-hidden>
                <div
                  className="size-full origin-left bg-nominal transition-transform duration-500 motion-reduce:transition-none"
                  style={{ transform: `scaleX(${Math.min(share(group), 100) / 100})` }}
                />
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** One sentence for what a kill request did — including when it did nothing. */
function describeResult(name: string, result: KillResult): { text: string; ok: boolean } {
  if (result.refused) return { text: result.refused, ok: false }
  const program = exeName(name)
  if (result.failed.length === 0) {
    return { text: `${program}: ${result.ended} ${result.ended === 1 ? 'Prozess' : 'Prozesse'} beendet.`, ok: true }
  }
  const reasons = [...new Set(result.failed.map((failure) => failure.reason))].join(', ')
  return {
    text: `${program}: ${result.ended} beendet, ${result.failed.length} nicht (${reasons}).`,
    ok: result.ended > 0,
  }
}

/**
 * The programs behind the numbers. Processes are folded by name, so Chrome's forty
 * helpers are one line — which is how a person thinks about "what is eating my RAM".
 *
 * Bars are the share of the whole machine, not of the busiest program: a list whose top
 * entry uses 0.8 % of the CPU must not draw it as a full bar. In the desktop app each row
 * names the program as Windows does, with its icon, and can open its folder or end it.
 */
export function ProcessesCard({ processes, memoryTotalBytes, actions = null, className }: ProcessesCardProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null)
  const info = useProgramInfo(processes)

  if (!processes) {
    return (
      <Card subtitle="Wird ausgelesen …" className={className}>
        <p className="text-sm text-muted">Die Prozessliste wird alle 15 Sekunden gelesen.</p>
      </Card>
    )
  }

  const kill = (group: ProcessGroup) => {
    setConfirming(null)
    if (!actions) return
    actions
      .kill(group)
      .then((result) => setOutcome(describeResult(group.name, result)))
      .catch((error: unknown) => setOutcome({ text: `Fehler: ${String(error)}`, ok: false }))
  }

  const shared = { info, actions, confirming, onConfirm: setConfirming, onKill: kill }

  return (
    <Card subtitle={`${processes.count} laufend · nach Programm gruppiert · aktualisiert alle 15 s`} className={className}>
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <ProcessList
          title="Prozessor"
          scale="Balken = Anteil an der ganzen CPU"
          groups={processes.byCpu}
          value={(group) => formatPercent(group.cpuPercent, 1)}
          share={(group) => group.cpuPercent}
          {...shared}
        />
        <ProcessList
          title="Arbeitsspeicher"
          scale={`Balken = Anteil an ${formatBytes(memoryTotalBytes, 0)}`}
          groups={processes.byMemory}
          value={(group) => formatBytes(group.memoryBytes)}
          share={(group) => (memoryTotalBytes > 0 ? (group.memoryBytes / memoryTotalBytes) * 100 : 0)}
          {...shared}
        />
      </div>

      {outcome && (
        <p role="status" className="mt-4 text-sm text-ink-2">
          <span className="font-medium" style={{ color: outcome.ok ? undefined : STATUS_COLORS.warning }}>
            {outcome.text}
          </span>
          <span className="ml-1 text-muted">Die Liste aktualisiert sich mit der nächsten Abfrage.</span>
        </p>
      )}

      {actions && (
        <p className="mt-auto pt-4 text-xs text-muted">
          Zeile mit der Maus oder per Tab ansteuern für Speicherort und Beenden. Windows-Systemprozesse sind gesperrt.
        </p>
      )}
    </Card>
  )
}
