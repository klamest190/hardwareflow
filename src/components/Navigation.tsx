import { Activity, PanelTopOpen } from 'lucide-react'

import type { NavItem, PageKey } from '../lib/pages'
import { STATUS_COLORS } from '../lib/status'

interface NavigationProps {
  items: NavItem[]
  active: PageKey
  onSelect: (page: PageKey) => void
  /** `null` in the browser, where there is no second window to open. */
  onOpenMini: (() => void) | null
}

function AlertCount({ count }: { count: number }) {
  return (
    <span
      className="ml-auto grid min-w-5 place-items-center rounded-full px-1.5 text-[10px] leading-4 font-semibold text-plane"
      style={{ backgroundColor: STATUS_COLORS.warning }}
      aria-label={`${count} ${count === 1 ? 'Warnung' : 'Warnungen'}`}
    >
      {count}
    </span>
  )
}

/**
 * Page navigation. On a desktop width it is a sidebar that stays put while the page
 * scrolls; below `lg` it becomes a horizontal bar under the header, scrolling sideways
 * rather than wrapping into a second row.
 */
export function Navigation({ items, active, onSelect, onOpenMini }: NavigationProps) {
  return (
    <nav
      aria-label="Bereiche"
      className="border-b border-hairline bg-plane/80 backdrop-blur lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0"
    >
      <div className="hidden items-center gap-2.5 px-5 pt-6 pb-5 lg:flex">
        <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-cpu/15 text-cpu ring-1 ring-cpu/25">
          <Activity size={17} strokeWidth={2.25} />
        </span>
        <div>
          <p className="text-[15px] leading-5 font-semibold tracking-tight text-ink">HardwareFlow</p>
          <p className="text-[11px] leading-4 text-muted">System Monitor</p>
        </div>
      </div>

      <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-visible lg:py-0">
        {items.map((item) => {
          const selected = item.key === active
          const Icon = item.icon
          return (
            <li key={item.key} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(item.key)}
                aria-current={selected ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-cpu ${
                  selected ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink'
                }`}
              >
                <Icon aria-hidden size={16} className={selected ? 'text-cpu' : 'text-muted'} />
                <span>{item.label}</span>
                {item.alertCount ? (
                  <AlertCount count={item.alertCount} />
                ) : (
                  item.hint && (
                    <span className="ml-auto hidden text-[11px] font-normal text-muted tabular-nums lg:inline">
                      {item.hint}
                    </span>
                  )
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {onOpenMini && (
        <div className="hidden px-3 pb-5 lg:mt-auto lg:block">
          <button
            type="button"
            onClick={onOpenMini}
            title="Kleines Fenster, immer im Vordergrund"
            className="flex w-full items-center gap-2.5 rounded-xl border border-hairline px-3 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:border-baseline hover:text-ink focus-visible:outline-2 focus-visible:outline-cpu"
          >
            <PanelTopOpen aria-hidden size={16} className="text-muted" />
            Mini-Ansicht
          </button>
        </div>
      )}
    </nav>
  )
}
