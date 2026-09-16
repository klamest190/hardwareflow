import { useEffect, useMemo, useRef, useState } from 'react'

import { AlertEngine } from '../lib/alerts'
import { computeHardwareScore, computeHeadroom } from '../lib/hardwareScore'
import { subscribeHardware, TICK_MS } from '../services/hardwareService'
import type { HardwareAlert, HardwareScore, HardwareSnapshot, Headroom } from '../types/hardware'

export interface HardwareMonitor {
  /** `null` only for the very first frame, before the first reading arrives. */
  snapshot: HardwareSnapshot | null
  /** Derived from `snapshot`; `null` while it is. */
  score: HardwareScore | null
  headroom: Headroom | null
  /** Alerts whose condition currently holds. */
  alerts: HardwareAlert[]
  /** Last error reported by the native probe, if any. */
  error: string | null
  paused: boolean
  setPaused: (paused: boolean) => void
}

export interface MonitorOptions {
  intervalMs?: number
  /**
   * Whether this view owns the probe's pause state. The mini view does not: it opens
   * while the dashboard may be paused, and must not quietly restart the measurement.
   */
  controlsProbe?: boolean
}

/**
 * Subscribes to the hardware stream for the lifetime of the component and keeps the
 * latest snapshot in state.
 *
 * Pausing closes the subscription *and* tells the main process to stop polling, so a
 * paused dashboard really stops measuring instead of quietly keeping WMI busy. The
 * rolling window is handed back in on resume, so the minute on screen survives the
 * pause rather than restarting from an empty axis.
 */
export function useHardwareMonitor({
  intervalMs = TICK_MS,
  controlsProbe = true,
}: MonitorOptions = {}): HardwareMonitor {
  const [snapshot, setSnapshot] = useState<HardwareSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [alerts, setAlerts] = useState<HardwareAlert[]>([])

  // The last window, kept in a ref so resubscribing does not depend on the snapshot's
  // identity — that changes every tick and would restart the subscription each second.
  const historyRef = useRef<HardwareSnapshot['history']>([])
  const engineRef = useRef(new AlertEngine())

  useEffect(() => {
    if (!snapshot) return
    historyRef.current = snapshot.history
    setAlerts(engineRef.current.update(snapshot).active)
  }, [snapshot])

  useEffect(() => {
    if (controlsProbe) void window.hardwareflow?.setPaused(paused)
    if (paused) return
    return subscribeHardware(setSnapshot, { intervalMs, initialHistory: historyRef.current })
  }, [intervalMs, paused, controlsProbe])

  useEffect(() => window.hardwareflow?.onProbeError(setError), [])

  // The score depends only on static capability, so the number never moves; it is
  // recomputed per snapshot because the table lookup costs microseconds.
  const score = useMemo(() => (snapshot ? computeHardwareScore(snapshot) : null), [snapshot])
  const headroom = useMemo(() => (snapshot ? computeHeadroom(snapshot.history) : null), [snapshot])

  return { snapshot, score, headroom, alerts, error, paused, setPaused }
}
