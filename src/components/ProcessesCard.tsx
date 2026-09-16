import { FolderOpen, ListTree, X } from 'lucide-react'
import { useState } from 'react'

import { formatBytes, formatPercent } from '../lib/format'
import { HUES } from '../lib/palette'
import { STATUS_COLORS } from '../lib/status'
import type { KillResult } from '../types/bridge'
import type { ProcessGroup, ProcessSummary } from '../types/hardware'
import { Card } from './ui/Card'

/** What the card may do to a process — only offered in the desktop app. */
export interface ProcessActions {
  kill: (group: ProcessGroup) => Promise<KillResult>
  showInFolder: (path: string) => void
}

interface ProcessesCardProps {
  processes: ProcessSummary | null
  /** `null` in the browser, where there is nothing to end. */
  actions?: ProcessActions | null
  className?: string
}

interface ProcessListProps {
  title: string
  groups: ProcessGroup[]
  value: (group: ProcessGroup) => string
  /** Bar length, 0–100, relative to the list's top entry. */
  share: (group: ProcessGroup) => number
  color: string
  actions: ProcessActions | null
  /** Program awaiting confirmation, shared by both lists so only one row asks at a time. */
  confirming: string | null
  onConfirm: (name: string | null) => void
  onKill: (group: ProcessGroup) => void
}

const ICON_BUTTON =
  'grid size-5 place-items-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-cpu'

function ProcessList({ title, groups, value, share, color, actions, confirming, onConfirm, onKill }: ProcessListProps) {
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] leading-4 font-medium tracking-wide text-muted uppercase">{title}</h3>
      <ol className="mt-2 space-y-2">
        {groups.map((group) => {
          const asking = confirming === group.name
          return (
            <li key={group.name} className="group">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 truncate text-ink-2" title={group.path ?? group.name}>
                  {group.name.replace(/\.exe$/i, '')}
                  {group.instances > 1 && <span className="ml-1 text-muted">×{group.instances}</span>}
                </span>

                {asking ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-ink-2">
                      {group.instances > 1 ? `Alle ${group.instances} beenden?` : 'Beenden?'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onKill(group)}
                      className="rounded px-1.5 py-0.5 font-semibold text-plane focus-visible:outline-2 focus-visible:outline-cpu"
                      style={{ backgroundColor: STATUS_COLORS.critical }}
                    >
                      Ja
                    </button>
                    <button
                      type="button"
                      onClick={() => onConfirm(null)}
                      className="rounded border border-hairline px-1.5 py-0.5 text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-cpu"
                    >
                      Nein
                    </button>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    {actions && (
                      // Hidden until the row is pointed at or focused, so the list stays calm.
                      <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                        {group.path && (
                          <button
                            type="button"
                            className={ICON_BUTTON}
                            onClick={() => actions.showInFolder(group.path!)}
                            aria-label={`Speicherort von ${group.name} öffnen`}
                            title="Speicherort öffnen"
                          >
                            <FolderOpen aria-hidden size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          className={ICON_BUTTON}
                          onClick={() => onConfirm(group.name)}
                          aria-label={`${group.name} beenden`}
                          title="Beenden"
                        >
                          <X aria-hidden size={12} />
                        </button>
                      </span>
                    )}
                    <span className="font-semibold text-ink tabular-nums">{value(group)}</span>
                  </span>
                )}
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div
                  className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${Math.max(share(group), 2)}%`, backgroundColor: color }}
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
  const program = name.replace(/\.exe$/i, '')
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
 * In the desktop app each row can open the program's folder or end it, after a
 * confirmation in the row itself.
 */
export function ProcessesCard({ processes, actions = null, className }: ProcessesCardProps) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null)

  if (!processes) {
    return (
      <Card title="Prozesse" subtitle="Wird ausgelesen …" icon={ListTree} accent={HUES.neutral} className={className}>
        <p className="my-auto py-6 text-center text-xs text-muted">Die Prozessliste wird alle 15 Sekunden gelesen.</p>
      </Card>
    )
  }

  const topCpu = processes.byCpu[0]?.cpuPercent ?? 0
  const topMemory = processes.byMemory[0]?.memoryBytes ?? 0

  const kill = (group: ProcessGroup) => {
    setConfirming(null)
    if (!actions) return
    actions
      .kill(group)
      .then((result) => setOutcome(describeResult(group.name, result)))
      .catch((error: unknown) => setOutcome({ text: `Fehler: ${String(error)}`, ok: false }))
  }

  const shared = { actions, confirming, onConfirm: setConfirming, onKill: kill }

  return (
    <Card
      title="Prozesse"
      subtitle={`${processes.count} laufend · nach Programm gruppiert`}
      icon={ListTree}
      accent={HUES.neutral}
      className={className}
    >
      <div className="grid grid-cols-2 gap-5">
        <ProcessList
          title="CPU"
          groups={processes.byCpu}
          value={(group) => formatPercent(group.cpuPercent, 1)}
          share={(group) => (topCpu > 0 ? (group.cpuPercent / topCpu) * 100 : 0)}
          color={HUES.cpu}
          {...shared}
        />
        <ProcessList
          title="Arbeitsspeicher"
          groups={processes.byMemory}
          value={(group) => formatBytes(group.memoryBytes)}
          share={(group) => (topMemory > 0 ? (group.memoryBytes / topMemory) * 100 : 0)}
          color={HUES.memory}
          {...shared}
        />
      </div>

      {outcome && (
        <p role="status" className="mt-4 text-xs text-ink-2">
          <span
            aria-hidden
            className="mr-2 inline-block size-2 rounded-full"
            style={{ backgroundColor: outcome.ok ? STATUS_COLORS.good : STATUS_COLORS.warning }}
          />
          {outcome.text}
          <span className="ml-1 text-muted">Die Liste aktualisiert sich mit der nächsten Abfrage.</span>
        </p>
      )}

      <p className="mt-auto pt-4 text-[10px] text-muted">
        Aktualisiert alle 15 s · CPU als Anteil der ganzen Maschine
        {actions && ' · Zeile berühren für Speicherort und Beenden; Windows-Systemprozesse sind gesperrt'}
      </p>
    </Card>
  )
}
