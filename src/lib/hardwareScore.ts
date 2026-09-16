import type {
  HardwareReading,
  HardwareScore,
  Headroom,
  LoadSample,
  ScoreBadge,
  ScoreComponent,
  ScoreGrade,
} from '../types/hardware'
import { lookupCpu, lookupGpu } from './benchmarks'
import { describeDevice } from './format'

/**
 * The HardwareFlow score, 0–100: what the machine *is*.
 *
 * It reads only static capability — chips, memory, disks, ports — and never load, so it
 * is the same number on every tick and two machines can be compared by it. What the
 * machine has left right now is a separate figure, `computeHeadroom`.
 *
 * | Component       | Weight | 100 at                                                  |
 * | --------------- | ------ | ------------------------------------------------------- |
 * | CPU             | 35 %   | performance index 60 000 (Ryzen 9 7950X, Core i9-14900K) |
 * | GPU             | 30 %   | performance index 36 000 (GeForce RTX 4080/5080)         |
 * | RAM             | 15 %   | 64 GB, +5 for DDR5                                       |
 * | Storage         | 10 %   | NVMe with 4 TB                                           |
 * | Extras          | 10 %   | enough badges (fast LAN, Wi-Fi 7, ECC, …)                |
 *
 * CPU, GPU and RAM rise on a square-root curve rather than linearly. Performance is
 * felt that way — going from 4 to 16 GB is a different machine, going from 48 to 64 GB
 * is not — and it lets a strong notebook land high instead of halfway, while only a
 * current top desktop reaches 100.
 */

const GIB = 1024 ** 3
const TB = 1000 ** 4

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** `sqrt(value / reference)` as 0–100, capped at the reference. */
const rootScale = (value: number, reference: number) => clamp(Math.sqrt(Math.max(value, 0) / reference), 0, 1) * 100

const CPU_REFERENCE = 60_000
const GPU_REFERENCE = 36_000
const MEMORY_REFERENCE_GIB = 64

const GRADE_THRESHOLDS: Array<{ min: number; grade: ScoreGrade }> = [
  { min: 85, grade: 'high-end' },
  { min: 70, grade: 'strong' },
  { min: 55, grade: 'solid' },
  { min: 40, grade: 'entry' },
  { min: 0, grade: 'dated' },
]

export function gradeForScore(total: number): ScoreGrade {
  return GRADE_THRESHOLDS.find((band) => total >= band.min)?.grade ?? 'dated'
}

/**
 * Fallback for processors the table does not know. Uses the *base* clock rather than
 * the observed peak: the peak grows over the runtime, and a score that climbs during
 * the first minutes looks broken.
 */
function estimateCpuIndex(threads: number, baseClockGhz: number): number {
  const clockFactor = clamp(baseClockGhz / 3.5, 0.6, 1.4)
  return threads * 1_000 * clockFactor
}

/** Fallback for unknown adapters: dedicated cards by VRAM, integrated ones flat. */
function estimateGpuIndex(integrated: boolean, vramBytes: number | null): number {
  if (integrated) return 2_000
  if (vramBytes === null) return 8_000
  return clamp((vramBytes / GIB) * 2_000, 4_000, 30_000)
}

function cpuComponent(reading: HardwareReading): ScoreComponent {
  const { cpu } = reading
  const match = lookupCpu(cpu.vendor, cpu.model)
  const index = match?.index ?? estimateCpuIndex(cpu.threads, cpu.baseClockGhz)

  return {
    key: 'cpu',
    label: 'CPU-Leistung',
    score: rootScale(index, CPU_REFERENCE),
    weight: 0.35,
    detail: match
      ? `${match.label} · ${cpu.cores} Kerne / ${cpu.threads} Threads`
      : `${cpu.threads} Threads, ${cpu.baseClockGhz.toFixed(1)} GHz · Modell unbekannt, geschätzt`,
    estimated: match === null,
  }
}

function gpuComponent(reading: HardwareReading): ScoreComponent {
  // The strongest adapter counts, not the first listed: the probe ranks by telemetry,
  // and a sleeping Optimus dGPU reports none.
  const best = reading.gpus
    .map((gpu) => {
      const match = lookupGpu(gpu.vendor, gpu.model)
      return { gpu, match, index: match?.index ?? estimateGpuIndex(gpu.integrated, gpu.vramTotalBytes) }
    })
    .sort((a, b) => b.index - a.index)[0]

  if (!best) {
    return { key: 'gpu', label: 'Grafik', score: 0, weight: 0.3, detail: 'Keine GPU erkannt', estimated: true }
  }

  const name = best.match?.label ?? describeDevice(best.gpu.vendor, best.gpu.model)
  const vram = best.gpu.vramTotalBytes !== null && !best.gpu.integrated
    ? ` · ${Math.round(best.gpu.vramTotalBytes / GIB)} GB VRAM`
    : best.gpu.integrated
      ? ' · integriert'
      : ''
  return {
    key: 'gpu',
    label: 'Grafik',
    score: rootScale(best.index, GPU_REFERENCE),
    weight: 0.3,
    detail: best.match ? `${name}${vram}` : `${name}${vram} · Modell unbekannt, geschätzt`,
    estimated: best.match === null,
  }
}

function memoryComponent(reading: HardwareReading): ScoreComponent {
  const { memory } = reading
  const gib = Math.round(memory.totalBytes / GIB)
  const ddr5 = memory.type === 'DDR5' ? 5 : 0

  return {
    key: 'memory',
    label: 'Arbeitsspeicher',
    score: clamp(rootScale(gib, MEMORY_REFERENCE_GIB) + ddr5, 0, 100),
    weight: 0.15,
    detail: [
      `${gib} GB`,
      memory.type && memory.speedMhz ? `${memory.type}-${memory.speedMhz}` : memory.type,
    ]
      .filter(Boolean)
      .join(' '),
    estimated: false,
  }
}

function storageComponent(reading: HardwareReading): ScoreComponent {
  const disks = reading.physicalDisks
  const kinds = disks.map((disk) => disk.kind)
  const fastest = kinds.includes('nvme') ? 'NVMe' : kinds.includes('ssd') ? 'SSD' : kinds.includes('hdd') ? 'HDD' : null
  const base = fastest === 'NVMe' ? 70 : fastest === 'SSD' ? 50 : fastest === 'HDD' ? 20 : 35
  const terabytes = disks.reduce((sum, disk) => sum + disk.sizeBytes, 0) / TB
  const capacity = clamp(Math.sqrt(terabytes / 4), 0, 1) * 30

  return {
    key: 'storage',
    label: 'Massenspeicher',
    score: clamp(base + capacity, 0, 100),
    weight: 0.1,
    detail:
      disks.length === 0
        ? 'Datenträger nicht auslesbar'
        : `${fastest ?? 'Typ unbekannt'} · ${terabytes.toFixed(1)} TB auf ${disks.length} ${disks.length === 1 ? 'Datenträger' : 'Datenträgern'}`,
    // Network shares never count: they are not this machine's storage.
    estimated: disks.length === 0,
  }
}

interface BadgeRule extends ScoreBadge {
  applies: (reading: HardwareReading) => boolean
}

/** What sets a machine apart beyond its chips. The extras sub-score caps at 100. */
const BADGES: BadgeRule[] = [
  { key: 'many-cores', label: '16+ Kerne', points: 30, applies: ({ cpu }) => cpu.cores >= 16 },
  { key: 'big-ram', label: '64 GB+ RAM', points: 25, applies: ({ memory }) => memory.totalBytes >= 63 * GIB },
  { key: 'ecc', label: 'ECC-Speicher', points: 30, applies: ({ memory }) => memory.ecc === true },
  {
    key: 'multi-gpu',
    label: 'Mehrere dedizierte GPUs',
    points: 40,
    applies: ({ gpus }) => gpus.filter((gpu) => !gpu.integrated).length >= 2,
  },
  {
    key: 'big-vram',
    label: '16 GB+ VRAM',
    points: 20,
    applies: ({ gpus }) => gpus.some((gpu) => (gpu.vramTotalBytes ?? 0) >= 15.5 * GIB),
  },
  {
    key: 'nvme-4tb',
    label: '4 TB+ NVMe',
    points: 15,
    applies: ({ physicalDisks }) =>
      physicalDisks.filter((disk) => disk.kind === 'nvme').reduce((sum, disk) => sum + disk.sizeBytes, 0) >=
      3.6 * TB,
  },
  { key: 'fast-lan', label: '10 GbE', points: 40, applies: ({ network }) => (network.bestWiredMbps ?? 0) >= 10_000 },
  {
    key: 'multi-gig',
    label: '2.5 GbE',
    points: 25,
    applies: ({ network }) => (network.bestWiredMbps ?? 0) >= 2_500 && (network.bestWiredMbps ?? 0) < 10_000,
  },
  { key: 'wifi-7', label: 'Wi-Fi 7', points: 30, applies: ({ network }) => network.wifiGeneration === 'Wi-Fi 7' },
  { key: 'wifi-6e', label: 'Wi-Fi 6E', points: 20, applies: ({ network }) => network.wifiGeneration === 'Wi-Fi 6E' },
]

export function earnedBadges(reading: HardwareReading): ScoreBadge[] {
  return BADGES.filter((rule) => rule.applies(reading)).map(({ key, label, points }) => ({ key, label, points }))
}

export function computeHardwareScore(reading: HardwareReading): HardwareScore {
  const badges = earnedBadges(reading)
  const extras: ScoreComponent = {
    key: 'extras',
    label: 'Ausstattung',
    score: clamp(
      badges.reduce((sum, badge) => sum + badge.points, 0),
      0,
      100,
    ),
    weight: 0.1,
    detail: badges.length > 0 ? badges.map((badge) => badge.label).join(' · ') : 'Nichts Besonderes erkannt',
    estimated: false,
  }

  const components = [
    cpuComponent(reading),
    gpuComponent(reading),
    memoryComponent(reading),
    storageComponent(reading),
    extras,
  ]
  const total = Math.round(components.reduce((sum, part) => sum + part.score * part.weight, 0))

  return { total, grade: gradeForScore(total), components, badges }
}

/** Samples the headroom averages over — 10 s at a 1 s tick. */
export const HEADROOM_WINDOW = 10

const mean = (values: number[]) =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

/**
 * How much of the machine is free right now, averaged over the last few samples so a
 * one-second spike does not swing it. Without a GPU reading, CPU and RAM carry the
 * whole weight rather than a missing sensor counting as an idle GPU.
 */
export function computeHeadroom(history: LoadSample[]): Headroom {
  const recent = history.slice(-HEADROOM_WINDOW)
  const cpuPercent = mean(recent.map((sample) => sample.cpuPercent))
  const memoryPercent = mean(recent.map((sample) => sample.memoryPercent))
  const gpuSamples = recent
    .map((sample) => sample.gpuPercent)
    .filter((value): value is number => value !== null)
  const gpuPercent = gpuSamples.length > 0 ? mean(gpuSamples) : null

  const load =
    gpuPercent === null
      ? cpuPercent * 0.625 + memoryPercent * 0.375
      : cpuPercent * 0.5 + memoryPercent * 0.3 + gpuPercent * 0.2

  return {
    percent: clamp(100 - load, 0, 100),
    cpuPercent,
    memoryPercent,
    gpuPercent,
    windowSeconds: recent.length,
  }
}
