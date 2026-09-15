import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  /** Optional unit or qualifier, set one step down from the value. */
  hint?: string
  /** Small colour key placed *beside* the label — identity never colours text. */
  swatch?: string
  className?: string
}

/** Label-over-value pair. Values use tabular figures so columns stay aligned. */
export function Stat({ label, value, hint, swatch, className = '' }: StatProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5">
        {swatch && (
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: swatch }} />
        )}
        <span className="text-[11px] leading-4 font-medium tracking-wide text-muted uppercase">{label}</span>
      </div>
      <p className="mt-1 text-sm leading-5 font-semibold text-ink tabular-nums">
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-muted">{hint}</span>}
      </p>
    </div>
  )
}

interface StatGridProps {
  columns?: 2 | 3 | 4
  children: ReactNode
  className?: string
}

export function StatGrid({ columns = 3, children, className = '' }: StatGridProps) {
  const columnClass = columns === 2 ? 'grid-cols-2' : columns === 4 ? 'grid-cols-4' : 'grid-cols-3'
  return <div className={`grid ${columnClass} gap-x-4 gap-y-3 ${className}`}>{children}</div>
}
