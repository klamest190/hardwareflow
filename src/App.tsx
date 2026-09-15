import { motion } from 'framer-motion'
import { AlertTriangle, FlaskConical, Radio } from 'lucide-react'

import { CpuCard } from './components/CpuCard'
import { DashboardHeader } from './components/DashboardHeader'
import { GpuCard } from './components/GpuCard'
import { MemoryCard } from './components/MemoryCard'
import { PerformanceMeter } from './components/PerformanceMeter'
import { StorageCard } from './components/StorageCard'
import { useHardwareMonitor } from './hooks/useHardwareMonitor'
import { formatClockTime } from './lib/format'
import { STATUS_COLORS } from './lib/status'

/** Cards fade in bottom-up once, on a short stagger. */
const GRID_VARIANTS = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}

function LoadingState() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <p className="text-sm text-muted">Hardware wird ausgelesen …</p>
    </div>
  )
}

/**
 * Single-page dashboard: everything that matters is on screen at once, no tabs and no
 * scrolling between modules on a desktop viewport.
 */
export default function App() {
  const { snapshot, score, error, paused, setPaused } = useHardwareMonitor()

  if (!snapshot || !score) return <LoadingState />

  const native = snapshot.source === 'native'

  return (
    <div className="hf-plane min-h-dvh">
      <div className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <DashboardHeader
          system={snapshot.system}
          score={score}
          source={snapshot.source}
          paused={paused}
          onTogglePaused={() => setPaused(!paused)}
        />

        {error && (
          <p
            className="mt-5 flex items-start gap-2 rounded-xl border border-hairline bg-surface px-4 py-3 text-xs leading-5 text-ink-2"
            style={{ borderColor: `${STATUS_COLORS.warning}4d` }}
          >
            <AlertTriangle
              aria-hidden
              size={14}
              className="mt-0.5 shrink-0"
              style={{ color: STATUS_COLORS.warning }}
            />
            <span>
              Ein Sensor konnte nicht gelesen werden — die übrigen Werte laufen weiter.
              <span className="ml-1 text-muted">{error}</span>
            </span>
          </p>
        )}

        <motion.main
          variants={GRID_VARIANTS}
          initial="hidden"
          animate="visible"
          className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-12"
        >
          <CpuCard
            className="md:col-span-2 xl:col-span-8"
            cpu={snapshot.cpu}
            load={snapshot.cpuLoad}
            history={snapshot.history}
          />
          <PerformanceMeter className="md:col-span-2 xl:col-span-4" score={score} />
          <MemoryCard
            className="xl:col-span-4"
            memory={snapshot.memory}
            history={snapshot.history}
          />
          <GpuCard className="xl:col-span-4" gpus={snapshot.gpus} />
          <StorageCard
            className="md:col-span-2 xl:col-span-4"
            drives={snapshot.drives}
            physicalDisks={snapshot.physicalDisks}
          />
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
  )
}
