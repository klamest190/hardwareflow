import { useEffect, useMemo, useRef, useState } from 'react'

import { computePerformanceScore, subscribeHardware, TICK_MS } from '../services/hardwareService'
import type { HardwareSnapshot, PerformanceScore } from '../types/hardware'

export interface HardwareMonitor {
  /** `null` only for the very first frame, before the first reading arrives. */
  snapshot: HardwareSnapshot | null
  /** Derived from `snapshot`; `null` while it is. */
  score: PerformanceScore | null
  /** Last error reported by the native probe, if any. */
  error: string | null
  paused: boolean
  setPaused: (paused: boolean) => void
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
export function useHardwareMonitor(intervalMs: number = TICK_MS): HardwareMonitor {
  const [snapshot, setSnapshot] = useState<HardwareSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)

  // The last window, kept in a ref so resubscribing does not depend on the snapshot's
  // identity — that changes every tick and would restart the subscription each second.
  const historyRef = useRef<HardwareSnapshot['history']>([])
  useEffect(() => {
    if (snapshot) historyRef.current = snapshot.history
  }, [snapshot])

  useEffect(() => {
    void window.hardwareflow?.setPaused(paused)
    if (paused) return
    return subscribeHardware(setSnapshot, { intervalMs, initialHistory: historyRef.current })
  }, [intervalMs, paused])

  useEffect(() => window.hardwareflow?.onProbeError(setError), [])

  const score = useMemo(() => (snapshot ? computePerformanceScore(snapshot) : null), [snapshot])

  return { snapshot, score, error, paused, setPaused }
}
