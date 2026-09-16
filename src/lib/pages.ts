import type { LucideIcon } from 'lucide-react'
import { BatteryMedium, History, LayoutDashboard, ListTree, Network, Settings } from 'lucide-react'

/** The app's pages. Kept apart from the navigation component so both can import it. */
export type PageKey = 'overview' | 'network' | 'processes' | 'battery' | 'history' | 'settings'

export interface NavItem {
  key: PageKey
  label: string
  icon: LucideIcon
  /** A live figure beside the label, so the bar is worth glancing at on its own. */
  hint?: string
  /** Raised alerts on this page — shown as a count, never by colour alone. */
  alertCount?: number
}

export const PAGE_ICONS: Record<PageKey, LucideIcon> = {
  overview: LayoutDashboard,
  network: Network,
  processes: ListTree,
  battery: BatteryMedium,
  history: History,
  settings: Settings,
}

