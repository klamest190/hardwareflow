import { AlertTriangle } from 'lucide-react'
import { useRef, useState } from 'react'

import { AlertBanner } from './components/AlertBanner'
import { BatteryCard } from './components/BatteryCard'
import { ComponentTiles } from './components/ComponentTiles'
import { CpuCard } from './components/CpuCard'
import { DashboardHeader } from './components/DashboardHeader'
import { DeviceCard } from './components/DeviceCard'
import { GpuCard } from './components/GpuCard'
import { HistoryCard } from './components/HistoryCard'
import { MemoryCard } from './components/MemoryCard'
import { Navigation, TitleBar } from './components/Navigation'
import { ConnectionsCard, NetworkCard } from './components/NetworkCard'
import { PerformanceMeter } from './components/PerformanceMeter'
import { ProcessesCard } from './components/ProcessesCard'
import { SettingsCard } from './components/SettingsCard'
import { StatusLine } from './components/StatusLine'
import { StorageCard } from './components/StorageCard'
import { useDesktopSettings } from './hooks/useDesktopSettings'
import { useHardwareMonitor } from './hooks/useHardwareMonitor'
import { useHistory } from './hooks/useHistory'
import { diagnose } from './lib/diagnosis'
import { formatBitrate } from './lib/format'
import { PAGE_ICONS, type NavItem, type PageKey } from './lib/pages'
import { STATUS_COLORS } from './lib/status'
import { exportReport } from './services/reportService'
import type { AlertKey } from './types/hardware'

const PAGE_TITLES: Record<PageKey, string> = {
  overview: 'Übersicht',
  network: 'Netzwerk',
  processes: 'Prozesse',
  history: 'Verlauf',
  device: 'Gerät',
  settings: 'Einstellungen',
}

/** Where each alert belongs, so the navigation can point at it. */
const ALERT_PAGE: Record<AlertKey, PageKey> = {
  'cpu-temp': 'overview',
  'gpu-temp': 'overview',
  memory: 'overview',
  'system-drive': 'overview',
  battery: 'overview',
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
    <div className="grid min-h-dvh place-items-center bg-plane">
      <p className="text-sm text-muted">Hardware wird ausgelesen …</p>
    </div>
  )
}

/**
 * The app shell: title strip on top, navigation on the left, one page at a time on the
 * right. Only the page scrolls; the frame stays.
 *
 * The overview opens with one quiet line on whether the machine is fine, then a tile per
 * component for the glance, then the detail behind each tile. Facts
 * that never change while the app runs (score, data sheet) have their own page.
 */
export default function App() {
  const { settings, update } = useDesktopSettings()
  const { snapshot, score, headroom, alerts, error, paused, setPaused } = useHardwareMonitor({
    thresholds: settings?.thresholds,
  })
  const history = useHistory()
  const [page, setPage] = useState<PageKey>(initialPage)
  const scroller = useRef<HTMLDivElement>(null)

  if (!snapshot || !score || !headroom) return <LoadingState />

  const bridge = window.hardwareflow
  const openMini = bridge ? () => void bridge.openMiniView() : null
  const current = page

  const selectPage = (next: PageKey) => {
    setPage(next)
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, next)
    } catch {
      // Remembering the page is a convenience.
    }
    scroller.current?.scrollTo({ top: 0 })
  }

  const alertsOn = (key: PageKey) => alerts.filter((alert) => ALERT_PAGE[alert.key] === key).length
  const latest = snapshot.history[snapshot.history.length - 1]

  const navItems: NavItem[] = [
    { key: 'overview', label: 'Übersicht', icon: PAGE_ICONS.overview, alertCount: alertsOn('overview') },
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
    { key: 'history', label: 'Verlauf', icon: PAGE_ICONS.history },
    { key: 'device', label: 'Gerät', icon: PAGE_ICONS.device, hint: `Score ${score.total}` },
    { key: 'settings', label: 'Einstellungen', icon: PAGE_ICONS.settings },
  ]

  return (
    <div className="hf-shell flex h-dvh flex-col">
      <TitleBar />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <Navigation items={navItems} active={current} onSelect={selectPage} onOpenMini={openMini} headroom={headroom} />

        <div ref={scroller} className="hf-content hf-scroll min-w-0 flex-1 overflow-y-auto bg-plane">
          <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
            <DashboardHeader
              title={PAGE_TITLES[current]}
              source={snapshot.source}
              capturedAt={snapshot.capturedAt}
              paused={paused}
              onTogglePaused={() => setPaused(!paused)}
              onExportReport={() =>
                exportReport({ snapshot, score, headroom, alerts, buckets: history.buckets, alertLog: history.alerts })
              }
            />

            {/* The overview names its alerts in the status line; every other page lists them. */}
            {current !== 'overview' && <AlertBanner alerts={alerts} />}

            {error && (
              <p className="mt-5 flex items-start gap-2 rounded-md border bg-surface px-4 py-3 text-sm text-ink-2" style={{ borderColor: STATUS_COLORS.warning }}>
                <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0" style={{ color: STATUS_COLORS.warning }} />
                <span>
                  Ein Sensor konnte nicht gelesen werden — die übrigen Werte laufen weiter.
                  <span className="ml-1 text-muted">{error}</span>
                </span>
              </p>
            )}

            <main className="mt-6">
              {current === 'overview' && (
                <div className="space-y-6">
                  <StatusLine diagnosis={diagnose(snapshot, headroom, alerts)} headroom={headroom} />
                  <ComponentTiles snapshot={snapshot} />
                  <h2 className="pt-2 text-md font-semibold text-ink">Details</h2>
                  <div className="-mt-3 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-12">
                    <CpuCard
                      className="md:col-span-2 xl:col-span-7"
                      cpu={snapshot.cpu}
                      load={snapshot.cpuLoad}
                      fans={snapshot.fans}
                      sensorProvider={snapshot.sensorProvider}
                    />
                    <GpuCard className="md:col-span-2 xl:col-span-5" gpus={snapshot.gpus} />
                    <MemoryCard className={snapshot.battery ? 'xl:col-span-4' : 'xl:col-span-6'} memory={snapshot.memory} />
                    <StorageCard
                      className={snapshot.battery ? 'xl:col-span-4' : 'xl:col-span-6'}
                      drives={snapshot.drives}
                      physicalDisks={snapshot.physicalDisks}
                    />
                    {snapshot.battery && <BatteryCard className="md:col-span-2 xl:col-span-4" battery={snapshot.battery} />}
                  </div>
                </div>
              )}

              {current === 'network' && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
                  <NetworkCard className="xl:col-span-8" network={snapshot.network} history={snapshot.history} />
                  <ConnectionsCard className="xl:col-span-4" network={snapshot.network} />
                </div>
              )}

              {current === 'processes' && (
                <ProcessesCard
                  processes={snapshot.processes}
                  memoryTotalBytes={snapshot.memory.totalBytes}
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

              {current === 'history' && <HistoryCard buckets={history.buckets} alerts={history.alerts} />}

              {current === 'device' && (
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
                  <PerformanceMeter className="xl:col-span-7" score={score} />
                  <DeviceCard className="xl:col-span-5" snapshot={snapshot} />
                </div>
              )}

              {current === 'settings' && (
                <SettingsCard className="max-w-[920px]" settings={settings} onUpdate={update} onOpenMini={openMini} />
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  )
}
