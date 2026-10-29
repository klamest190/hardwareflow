import type { ReactNode } from 'react'

interface CardProps {
  /** Panel heading. Omitted where the page title already names the content. */
  title?: string
  /** The hardware's own name, or what the panel covers — one step below the title. */
  subtitle?: ReactNode
  /** Right-hand slot of the header: a reading, a control. */
  action?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * The single panel every module sits in: an opaque, flat surface with a hairline edge.
 *
 * No accent colour, no glow, no icon chip. The panel is the instrument's housing; the
 * readings inside it are what may take colour, and only when they leave their band.
 */
export function Card({ title, subtitle, action, className = '', children }: CardProps) {
  const hasHeader = title !== undefined || subtitle !== undefined || action !== undefined

  return (
    <section className={`flex flex-col rounded-lg border border-hairline bg-surface ${className}`}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-md font-semibold text-ink">{title}</h2>}
            {/*
              The hardware's own name — which processor, which card. It is why someone
              opens a system monitor, so it wraps rather than being cut off mid-word.
            */}
            {subtitle && <p className="mt-0.5 text-sm wrap-break-word text-ink-2">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0 text-right">{action}</div>}
        </header>
      )}

      <div className={`flex flex-1 flex-col px-5 pb-5 ${hasHeader ? 'pt-4' : 'pt-5'}`}>{children}</div>
    </section>
  )
}

/** A heading inside a panel, with an optional reading on the right. */
export function PanelHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-medium text-ink-2">{children}</h3>
      {aside !== undefined && <span className="text-xs text-muted tabular-nums">{aside}</span>}
    </div>
  )
}
