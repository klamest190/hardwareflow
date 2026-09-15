import type {
  HardwareReading,
  HardwareSnapshot,
  HardwareSource,
  LoadSample,
  PerformanceScore,
  ScoreComponent,
  ScoreGrade,
} from '../types/hardware'
import { MockHardwareSource } from './mockHardware'

/**
 * The one API the UI talks to.
 *
 * It picks the data source — the Electron probe when the bridge is present, the
 * simulation otherwise — and maintains the rolling window the live graphs draw.
 * Neither the components nor the hook know which source is active; they read
 * `snapshot.source` only to label it.
 */

const GIB = 1024 ** 3

/** Sample interval of the live graphs, in milliseconds. */
export const TICK_MS = 1000

/** Number of samples kept in the rolling window (60 s at `TICK_MS`). */
export const HISTORY_LENGTH = 60

/** Samples the score's headroom term averages over — 10 s at `TICK_MS`. */
const HEADROOM_WINDOW = 10

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Linear 0–1 normalisation, clamped at both ends. */
const ratio = (value: number, min: number, max: number) => clamp((value - min) / (max - min), 0, 1)

/** `true` when running inside the Electron shell, i.e. with real measurements. */
export function isNativeAvailable(): boolean {
  return typeof window !== 'undefined' && window.hardwareflow !== undefined
}

export function activeSource(): HardwareSource {
  return isNativeAvailable() ? 'native' : 'mock'
}

function toSample(reading: HardwareReading): LoadSample {
  return {
    timestamp: reading.capturedAt,
    cpuPercent: reading.cpuLoad.usagePercent,
    memoryPercent:
      reading.memory.totalBytes > 0 ? (reading.memory.usedBytes / reading.memory.totalBytes) * 100 : 0,
    gpuPercent: reading.gpus[0]?.usagePercent ?? null,
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

const GRADE_THRESHOLDS: Array<{ min: number; grade: ScoreGrade }> = [
  { min: 85, grade: 'excellent' },
  { min: 70, grade: 'good' },
  { min: 55, grade: 'warning' },
  { min: 40, grade: 'serious' },
  { min: 0, grade: 'critical' },
]

export function gradeForScore(total: number): ScoreGrade {
  return GRADE_THRESHOLDS.find((band) => total >= band.min)?.grade ?? 'critical'
}

/**
 * The HardwareFlow score: four capability terms (what the machine *is*) plus one
 * headroom term (what it currently has left). Capability dominates at 75 % so the
 * number stays a property of the system, with live load moving it a band or two
 * rather than flipping it on every tick.
 *
 * Where a value is unreadable the term falls back to a neutral 50 rather than 0, and
 * says so in its detail line — an unreadable sensor is not a slow machine.
 */
export function computePerformanceScore(snapshot: HardwareSnapshot): PerformanceScore {
  const { cpu, cpuLoad, memory, gpus, drives, physicalDisks } = snapshot

  // CPU: thread count and peak clock. The references span a current mid-range laptop
  // (100 points at 24 threads / 5 GHz) rather than the top of the workstation market,
  // so a strong consumer machine lands high and only genuinely weak hardware lands low.
  const cpuScore = ratio(cpu.threads, 4, 24) * 62 + ratio(cpu.maxClockGhz, 2, 5) * 38

  // Memory: installed capacity against a 48 GiB reference, minus a penalty once the
  // machine starts leaning on swap.
  const memoryCapacity = ratio(memory.totalBytes / GIB, 4, 48) * 100
  const swapPressure = memory.swapTotalBytes > 0 ? memory.swapUsedBytes / memory.swapTotalBytes : 0
  const memoryScore = clamp(memoryCapacity - swapPressure * 18, 0, 100)

  // GPU: VRAM of the best adapter against a 12 GiB reference.
  const gpu = gpus[0] ?? null
  const vramGib = (gpu?.vramTotalBytes ?? 0) / GIB
  let gpuScore: number
  let gpuDetail: string
  if (!gpu) {
    gpuScore = 12
    gpuDetail = 'Keine GPU erkannt'
  } else if (gpu.integrated) {
    gpuScore = 34
    gpuDetail = 'Integrierte Grafik'
  } else if (gpu.vramTotalBytes === null) {
    gpuScore = 50
    gpuDetail = 'Dediziert, VRAM nicht auslesbar'
  } else {
    gpuScore = ratio(vramGib, 2, 12) * 100
    gpuDetail = `${Math.round(vramGib)} GB VRAM`
  }

  // Storage: free headroom across the machine's own volumes, plus a bonus for the
  // fastest disk. Network shares are excluded — a full file server says nothing about
  // this machine, and counting one would move the score for a reason the user cannot
  // act on locally.
  const localDrives = drives.filter((drive) => !drive.remote)
  const totalBytes = localDrives.reduce((sum, drive) => sum + drive.totalBytes, 0)
  const freeBytes = localDrives.reduce((sum, drive) => sum + drive.freeBytes, 0)
  const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 0
  const kinds = physicalDisks.map((disk) => disk.kind)
  const diskBonus = kinds.includes('nvme') ? 18 : kinds.includes('ssd') ? 10 : kinds.length > 0 ? 0 : 9
  const storageScore = clamp(ratio(freeRatio, 0.05, 0.5) * 82 + diskBonus, 0, 100)
  const fastestDisk = kinds.includes('nvme')
    ? 'NVMe'
    : kinds.includes('ssd')
      ? 'SSD'
      : kinds.includes('hdd')
        ? 'HDD'
        : 'Typ unbekannt'

  // Headroom: how much of the machine is still free. Averaged over the last few
  // seconds rather than read off the current tick — a one-second spike is not a
  // property of the system, and an instantaneous reading makes the score flip
  // between grade bands while nothing meaningful changes.
  const recent = snapshot.history.slice(-HEADROOM_WINDOW)
  const mean = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

  const memoryLoadNow = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0
  const cpuLoadAvg =
    recent.length > 0 ? mean(recent.map((sample) => sample.cpuPercent)) : cpuLoad.usagePercent
  const memoryLoadAvg =
    recent.length > 0 ? mean(recent.map((sample) => sample.memoryPercent)) : memoryLoadNow
  const gpuSamples = recent
    .map((sample) => sample.gpuPercent)
    .filter((value): value is number => value !== null)
  const gpuLoadAvg = gpuSamples.length > 0 ? mean(gpuSamples) : (gpu?.usagePercent ?? null)

  // Without a GPU reading the remaining two terms carry the whole weight, rather than
  // a missing sensor counting as an idle GPU.
  const weightedLoad =
    gpuLoadAvg === null
      ? cpuLoadAvg * 0.625 + memoryLoadAvg * 0.375
      : cpuLoadAvg * 0.5 + memoryLoadAvg * 0.3 + gpuLoadAvg * 0.2
  const headroomScore = clamp(100 - weightedLoad, 0, 100)

  const components: ScoreComponent[] = [
    {
      key: 'cpu',
      label: 'CPU-Leistung',
      score: cpuScore,
      weight: 0.28,
      // On a real system the peak clock is the highest value observed so far —
      // Windows reports no nameplate turbo figure, so the term can only grow into
      // accuracy. Saying so keeps a low CPU term from looking arbitrary.
      detail: `${cpu.cores} Kerne / ${cpu.threads} Threads · bis ${cpu.maxClockGhz.toFixed(1)} GHz${
        snapshot.source === 'native' ? ' (beobachtet)' : ''
      }`,
    },
    {
      key: 'memory',
      label: 'Arbeitsspeicher',
      score: memoryScore,
      weight: 0.2,
      detail: [
        `${Math.round(memory.totalBytes / GIB)} GB`,
        memory.type && memory.speedMhz ? `${memory.type}-${memory.speedMhz}` : memory.type,
      ]
        .filter(Boolean)
        .join(' '),
    },
    { key: 'gpu', label: 'Grafik', score: gpuScore, weight: 0.15, detail: gpuDetail },
    {
      key: 'storage',
      label: 'Speicher-Reserve',
      score: storageScore,
      weight: 0.12,
      detail: `${Math.round(freeRatio * 100)} % frei · schnellster Datenträger ${fastestDisk}`,
    },
    {
      key: 'headroom',
      label: 'Aktuelle Reserve',
      score: headroomScore,
      weight: 0.25,
      detail: `${Math.round(weightedLoad)} % belegt im Schnitt der letzten ${HEADROOM_WINDOW} s`,
    },
  ]

  const total = Math.round(
    components.reduce((sum, component) => sum + component.score * component.weight, 0),
  )

  return { total, grade: gradeForScore(total), components }
}
