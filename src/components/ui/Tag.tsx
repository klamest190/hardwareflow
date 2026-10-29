import type { ReactNode } from 'react'

/** A short qualifier beside a name — drive type, adapter kind. Outlined, never filled. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-[3px] border border-hairline px-1.5 text-xs leading-[18px] text-muted">
      {children}
    </span>
  )
}
