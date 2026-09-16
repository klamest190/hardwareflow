import { motion } from 'framer-motion'
import { AlertTriangle, FlaskConical, Radio } from 'lucide-react'
import { useState } from 'react'

import { AlertBanner } from './components/AlertBanner'
import { BatteryCard } from './components/BatteryCard'
import { CpuCard } from './components/CpuCard'
import { DashboardHeader } from './components/DashboardHeader'
import { GpuCard } from './components/GpuCard'
import { HistoryCard } from './components/HistoryCard'
import { MemoryCard } from './components/MemoryCard'
import { Navigation } from './components/Navigation'
import { NetworkCard } from './components/NetworkCard'
import { PerformanceMeter } from './components/PerformanceMeter'
import { ProcessesCard } from './components/ProcessesCard'
import { SettingsCard } from './components/SettingsCard'
import { StorageCard } from './components/StorageCard'
import { useDesktopSettings } from './hooks/useDesktopSettings'
import { useHardwareMonitor } from './hooks/useHardwareMonitor'
import { useHistory } from './hooks/useHistory'
import { formatBitrate, formatClockTime } from './lib/format'
import { PAGE_ICONS, type NavItem, type PageKey } from './lib/pages'
import { STATUS_COLORS } from './lib/status'
import type { AlertKey } from './types/hardware'

/** Cards fade in bottom-up once per page, on a short stagger. */
const GRID_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.03 } },
}

const PAGE_TITLES: Record<PageKey, string> = {
  overview: 'Übersicht',
  network: 'Netzwerk',
  processes: 'Prozesse',
  battery: 'Akku',
  history: 'Verlauf',
  settings: 'Einstellungen',
}

/** Where each alert belongs, so the navigation can point at it. */
const ALERT_PAGE: Record<AlertKey, PageKey> = {
  'cpu-temp': 'overview',
  'gpu-temp': 'overview',
  memory: 'overview',
  'system-drive': 'overview',
  battery: 'battery',
}

const PAGE_STORAGE_KEY = 'hardwareflow:page'

/** The last page, remembered per machine. Storage may be unavailable; the overview is the fallback. */
function initialPage(): PageKey {
  try {
    const saved = localStorage.getItem(PAGE_STORAGE_KEY)
    if (saved && saved in PAGE_TITLES) return saved as PageKey
  } catch {
    // No storage — start on the overview.
  }
  return 'overview'
}

function LoadingState() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <p className="text-sm text-muted">Hardware wird ausgelesen …</p>
    </div>
  )
}

/**
 * The app shell: navigation on the left, one page at a time on the right.
 *
 * The overview holds what someone opens a system monitor for — the score and the four
 * core modules. Everything else has its own page, so no single screen has to carry ten
 * panels. Alerts stay visible on every page.
 */
export default function App() {
  const { settings, update } = useDesktopSettings()
  const { snapshot, score, headroom, alerts, error, paused, setPaused } = useHardwareMonitor({
    thresholds: settings?.thresholds,
  })
  const history = useHistory()
  const [page, setPage] = useState<PageKey>(initialPage)

  if (!snapshot || !score || !headroom) return <LoadingState />

  const native = snapshot.source === 'native'
  const bridge = window.hardwareflow
  const openMini = bridge ? () => void bridge.openMiniView() : null
  // A machine without a battery has no battery page — and a remembered one falls back.
  const current: PageKey = page === 'battery' && !snapshot.battery ? 'overview' : page

  const selectPage = (next: PageKey) => {
    setPage(next)
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, next)
    } catch {
      // Remembering the page is a convenience.
    }
    window.scrollTo({ top: 0 })
  }

  const alertsOn = (key: PageKey) => alerts.filter((alert) => ALERT_PAGE[alert.key] === key).length
  const latest = snapshot.history[snapshot.history.length - 1]

  const navItems: NavItem[] = [
    { key: 'overview', label: 'Übersicht', icon: PAGE_ICONS.overview, hint: `${score.total}`, alertCount: alertsOn('overview') },
    {
      key: 'network',
      label: 'Netzwerk',
      icon: PAGE_ICONS.network,
      hint: latest?.netRxBytesPerSec == null ? undefined : `↓ ${formatBitrate(latest.netRxBytesPerSec)}`,
    },
    {
      key: 'processes',
      label: 'Prozesse',
      icon: PAGE_ICONS.processes,
      hint: snapshot.processes ? `${snapshot.processes.count}` : undefined,
    },
    ...(snapshot.battery
      ? [
          {
            key: 'battery' as const,
            label: 'Akku',
            icon: PAGE_ICONS.battery,
            hint: `${Math.round(snapshot.battery.percent)} %`,
            alertCount: alertsOn('battery'),
          },
        ]
      : []),
    { key: 'history', label: 'Verlauf', icon: PAGE_ICONS.history },
    { key: 'settings', label: 'Einstellungen', icon: PAGE_ICONS.settings },
  ]

  return (
    <div className="hf-plane min-h-dvh lg:flex">
      <Navigation items={navItems} active={current} onSelect={selectPage} onOpenMini={openMini} />

      <div className="min-w-0 flex-1">
        <div className="mx-auto max-w-350 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <DashboardHeader
            title={PAGE_TITLES[current]}
            system={snapshot.system}
            headroom={headroom}
            source={snapshot.source}
            paused={paused}
            onTogglePaused={() => setPaused(!paused)}
          />

          <AlertBanner alerts={alerts} />

          {error && (
            <p
              className="mt-5 flex items-start gap-2 rounded-xl border border-hairline bg-surface px-4 py-3 text-xs leading-5 text-ink-2"
              style={{ borderColor: `${STATUS_COLORS.warning}4d` }}
            >
              <AlertTriangle aria-hidden size={14} className="mt-0.5 shrink-0" style={{ color: STATUS_COLORS.warning }} />
              <span>
                Ein Sensor konnte nicht gelesen werden — die übrigen Werte laufen weiter.
                <span className="ml-1 text-muted">{error}</span>
              </span>
            </p>
          )}

          <motion.main
            key={current}
            variants={GRID_VARIANTS}
            initial="hidden"
            animate="visible"
            className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-12"
          >
            {current === 'overview' && (
              <>
                <CpuCard
                  className="md:col-span-2 xl:col-span-8"
                  cpu={snapshot.cpu}
                  load={snapshot.cpuLoad}
                  history={snapshot.history}
                  fans={snapshot.fans}
                  sensorProvider={snapshot.sensorProvider}
                />
                <PerformanceMeter className="md:col-span-2 xl:col-span-4" score={score} />
                <MemoryCard className="xl:col-span-4" memory={snapshot.memory} history={snapshot.history} />
                <GpuCard className="xl:col-span-4" gpus={snapshot.gpus} />
                <StorageCard
                  className="md:col-span-2 xl:col-span-4"
                  drives={snapshot.drives}
                  physicalDisks={snapshot.physicalDisks}
                />
              </>
            )}

            {current === 'network' && (
              <NetworkCard className="md:col-span-2 xl:col-span-12" network={snapshot.network} history={snapshot.history} tall />
            )}

            {current === 'processes' && (
              <ProcessesCard
                className="md:col-span-2 xl:col-span-12"
                processes={snapshot.processes}
                actions={
                  bridge
                    ? {
                        kill: (group) => bridge.killProcesses(group.name, group.pids),
                        showInFolder: (path) => void bridge.showInFolder(path),
                      }
                    : null
                }
              />
            )}

            {current === 'battery' && snapshot.battery && (
              <BatteryCard className="md:col-span-2 xl:col-span-6" battery={snapshot.battery} />
            )}

            {current === 'history' && <HistoryCard className="md:col-span-2 xl:col-span-12" buckets={history.buckets} alerts={history.alerts} />}

            {current === 'settings' && (
              <SettingsCard
                className="md:col-span-2 xl:col-span-8"
                settings={settings}
                onUpdate={update}
                onOpenMini={openMini}
              />
            )}
          </motion.main>

          <footer className="mt-6 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            {native ? <Radio aria-hidden size={12} /> : <FlaskConical aria-hidden size={12} />}
            <span>
              {native
                ? `Live-Messung über systeminformation · letzter Stand ${formatClockTime(snapshot.capturedAt)}`
                : 'Browser-Modus ohne Hardware-Zugriff: die Werte kommen aus dem Simulator. Für echte Messwerte "npm run dev" starten.'}
              {paused && ' · Aktualisierung pausiert'}
            </span>
          </footer>
        </div>
      </div>
    </div>
  )
}
