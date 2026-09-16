import { ListTree } from 'lucide-react'

import { formatBytes, formatPercent } from '../lib/format'
import { HUES } from '../lib/palette'
import type { ProcessGroup, ProcessSummary } from '../types/hardware'
import { Card } from './ui/Card'

interface ProcessesCardProps {
  processes: ProcessSummary | null
  className?: string
}

interface ProcessListProps {
  title: string
  groups: ProcessGroup[]
  value: (group: ProcessGroup) => string
  /** Bar length, 0–100, relative to the list's top entry. */
  share: (group: ProcessGroup) => number
  color: string
}

function ProcessList({ title, groups, value, share, color }: ProcessListProps) {
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] leading-4 font-medium tracking-wide text-muted uppercase">{title}</h3>
      <ol className="mt-2 space-y-2">
        {groups.map((group) => (
          <li key={group.name}>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 truncate text-ink-2" title={group.name}>
                {group.name.replace(/\.exe$/i, '')}
                {group.instances > 1 && <span className="ml-1 text-muted">×{group.instances}</span>}
              </span>
              <span className="shrink-0 font-semibold text-ink tabular-nums">{value(group)}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div
                className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${Math.max(share(group), 2)}%`, backgroundColor: color }}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * The programs behind the numbers. Processes are folded by name, so Chrome's forty
 * helpers are one line — which is how a person thinks about "what is eating my RAM".
 */
export function ProcessesCard({ processes, className }: ProcessesCardProps) {
  if (!processes) {
    return (
      <Card
        title="Prozesse"
        subtitle="Wird ausgelesen …"
        icon={ListTree}
        accent={HUES.neutral}
        className={className}
      >
        <p className="my-auto py-6 text-center text-xs text-muted">
          Die Prozessliste wird alle 15 Sekunden gelesen.
        </p>
      </Card>
    )
  }

  const topCpu = processes.byCpu[0]?.cpuPercent ?? 0
  const topMemory = processes.byMemory[0]?.memoryBytes ?? 0

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
        />
        <ProcessList
          title="Arbeitsspeicher"
          groups={processes.byMemory}
          value={(group) => formatBytes(group.memoryBytes)}
          share={(group) => (topMemory > 0 ? (group.memoryBytes / topMemory) * 100 : 0)}
          color={HUES.memory}
        />
      </div>
      <p className="mt-auto pt-4 text-[10px] text-muted">
        Aktualisiert alle 15 s · CPU als Anteil der ganzen Maschine
      </p>
    </Card>
  )
}
