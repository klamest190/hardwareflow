import { totalRate } from '../lib/history'
import type {
  HardwareReading,
  HardwareSnapshot,
  HardwareSource,
  HistoryBucket,
  LoadSample,
} from '../types/hardware'
import { MockHardwareSource, mockHistory } from './mockHardware'

/**
 * The one API the UI talks to.
 *
 * It picks the data source — the Electron probe when the bridge is present, the
 * simulation otherwise — and maintains the rolling window the live graphs draw.
 * Neither the components nor the hook know which source is active; they read
 * `snapshot.source` only to label it.
 */

/** Sample interval of the live graphs, in milliseconds. */
export const TICK_MS = 1000

/** Number of samples kept in the rolling window (60 s at `TICK_MS`). */
export const HISTORY_LENGTH = 60

/** `true` when running inside the Electron shell, i.e. with real measurements. */
export function isNativeAvailable(): boolean {
  return typeof window !== 'undefined' && window.hardwareflow !== undefined
}

export function activeSource(): HardwareSource {
  return isNativeAvailable() ? 'native' : 'mock'
}

export function toSample(reading: HardwareReading): LoadSample {
  const adapters = reading.network.adapters
  return {
    timestamp: reading.capturedAt,
    cpuPercent: reading.cpuLoad.usagePercent,
    memoryPercent:
      reading.memory.totalBytes > 0 ? (reading.memory.usedBytes / reading.memory.totalBytes) * 100 : 0,
    gpuPercent: reading.gpus[0]?.usagePercent ?? null,
    netRxBytesPerSec: totalRate(adapters.map((adapter) => adapter.rxBytesPerSec)),
    netTxBytesPerSec: totalRate(adapters.map((adapter) => adapter.txBytesPerSec)),
  }
}

export interface SubscribeOptions {
  /** Sample interval in milliseconds. Defaults to `TICK_MS`. */
  intervalMs?: number
  /**
   * Window to continue from. A subscription that is torn down and reopened — which is
   * what pausing does — would otherwise start the graph from an empty axis and throw
   * away the minute the user was looking at.
   */
  initialHistory?: LoadSample[]
}

/**
 * Streams snapshots to `listener` until the returned unsubscribe function is called.
 *
 * The simulation emits its first snapshot synchronously with a pre-filled window, so
 * the graph opens with history instead of drawing itself in from an empty axis. The
 * native probe cannot invent a past, so there the window genuinely fills over the
 * first minute.
 */
export function subscribeHardware(
  listener: (snapshot: HardwareSnapshot) => void,
  options: SubscribeOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? TICK_MS
  let history: LoadSample[] = (options.initialHistory ?? []).slice(-HISTORY_LENGTH)
  let stopped = false

  const emit = (reading: HardwareReading) => {
    if (stopped) return
    history = [...history, toSample(reading)].slice(-HISTORY_LENGTH)
    listener({ ...reading, history })
  }

  if (isNativeAvailable()) {
    const bridge = window.hardwareflow!
    const unsubscribe = bridge.onReading(emit)
    // The probe's own first tick can be a second out; ask for one immediately.
    void bridge.getReading().then(emit).catch(() => {})

    return () => {
      stopped = true
      unsubscribe()
    }
  }

  const source = new MockHardwareSource()

  // Warm the window up with a minute of simulated past — unless a window was handed in,
  // in which case that one continues. One sample short of the full length, because the
  // first emit appends the current one through the same path as every later tick.
  if (history.length === 0) {
    const now = Date.now()
    for (let i = HISTORY_LENGTH - 1; i >= 1; i -= 1) {
      history.push(toSample(source.next(now - i * intervalMs)))
    }
  }
  emit(source.next())

  const handle = setInterval(() => emit(source.next()), intervalMs)
  return () => {
    stopped = true
    clearInterval(handle)
  }
}

/**
 * A single simulated snapshot with a filled window. For tests and for any caller
 * that needs data without opening a subscription.
 */
export function getMockSnapshot(): HardwareSnapshot {
  const source = new MockHardwareSource()
  const now = Date.now()
  const history: LoadSample[] = []
  for (let i = HISTORY_LENGTH - 1; i >= 1; i -= 1) {
    history.push(toSample(source.next(now - i * TICK_MS)))
  }
  // The returned reading is the window's last point, not a point beyond it.
  const reading = source.next(now)
  history.push(toSample(reading))
  return { ...reading, history }
}

/**
 * The stored per-minute history. From the main process when running natively — it
 * records even while the window is hidden in the tray — and a simulated week otherwise.
 */
export async function loadHistory(): Promise<HistoryBucket[]> {
  if (isNativeAvailable()) return window.hardwareflow!.getHistory()
  return mockHistory(Date.now())
}
