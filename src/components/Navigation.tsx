import { PanelTopOpen } from 'lucide-react'

import type { NavItem, PageKey } from '../lib/pages'
import { STATUS_COLORS } from '../lib/status'
import type { Headroom } from '../types/hardware'
import { HeadroomRing } from './ui/HeadroomRing'
import { LogoMark } from './ui/LogoMark'

interface NavigationProps {
  items: NavItem[]
  active: PageKey
  onSelect: (page: PageKey) => void
  /** `null` in the browser, where there is no second window to open. */
  onOpenMini: (() => void) | null
  headroom: Headroom
}

function AlertCount({ count }: { count: number }) {
  return (
    <span
      className="ml-auto grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold text-plane"
      style={{ backgroundColor: STATUS_COLORS.warning }}
      aria-label={`${count} ${count === 1 ? 'Warnung' : 'Warnungen'}`}
    >
      {count}
    </span>
  )
}

/**
 * Page navigation. On a desktop width it is a sidebar that stays put while the content
 * scrolls, with the live reserve at its foot so it is in view on every page; below `lg`
 * it becomes a horizontal bar under the title strip, scrolling sideways rather than
 * wrapping into a second row.
 */
export function Navigation({ items, active, onSelect, onOpenMini, headroom }: NavigationProps) {
  return (
    <nav
      aria-label="Bereiche"
      className="hf-chrome shrink-0 border-b border-hairline lg:flex lg:w-60 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0"
    >
      <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-visible lg:pt-4">
        {items.map((item) => {
          const selected = item.key === active
          const Icon = item.icon
          return (
            <li key={item.key} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(item.key)}
                aria-current={selected ? 'page' : undefined}
                className={`relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selected ? 'bg-surface font-medium text-ink' : 'text-ink-2 hover:bg-surface/50 hover:text-ink'
                }`}
              >
                {/* The selected page is marked by position as well as tint. */}
                {selected && <span aria-hidden className="absolute inset-y-1.5 left-0 hidden w-0.5 rounded-full bg-signal lg:block" />}
                <Icon aria-hidden size={17} strokeWidth={1.75} className={selected ? 'text-signal' : 'text-muted'} />
                <span>{item.label}</span>
                {item.alertCount ? (
                  <AlertCount count={item.alertCount} />
                ) : (
                  item.hint && <span className="ml-auto hidden text-xs text-muted tabular-nums lg:inline">{item.hint}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="hidden px-3 pb-4 lg:mt-auto lg:block">
        <div
          className="flex items-center gap-3 border-t border-hairline px-3 pt-4 pb-3"
          title={`Frei im Schnitt der letzten ${headroom.windowSeconds} s`}
        >
          <HeadroomRing headroom={headroom} size={32} />
          <p className="text-sm text-ink-2">
            Reserve
            <span className="hf-figure ml-2 font-semibold text-ink">{Math.round(headroom.percent)} %</span>
            <span className="ml-1 text-muted">frei</span>
          </p>
        </div>
        {onOpenMini && (
          <button
            type="button"
            onClick={onOpenMini}
            title="Kleines Fenster, immer im Vordergrund"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-ink-2 transition-colors hover:bg-surface/50 hover:text-ink"
          >
            <PanelTopOpen aria-hidden size={17} strokeWidth={1.75} className="text-muted" />
            Mini-Ansicht
          </button>
        )}
      </div>
    </nav>
  )
}

/**
 * The title strip across the top of the window. It is the drag handle of the frameless
 * window; on Windows the native minimise, maximise and close buttons sit over its right
 * end, so nothing interactive is placed there.
 */
export function TitleBar() {
  return (
    <div className="hf-chrome hf-drag flex h-10 shrink-0 items-center gap-2.5 border-b border-hairline px-4 select-none">
      <LogoMark size={20} />
      <span className="text-sm font-semibold text-ink">HardwareFlow</span>
    </div>
  )
}
