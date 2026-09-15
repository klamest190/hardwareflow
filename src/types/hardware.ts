/**
 * Domain model for everything HardwareFlow renders.
 *
 * Two rules shape this file, both learned from what real systems actually expose:
 *
 * 1. Anything the OS may refuse to report is `| null`, never a fallback number.
 *    Windows gives no CPU temperature without a helper driver, no per-volume disk
 *    I/O, and no page-cache size; a `0` there would be a lie.
 * 2. Static capability and sampled load are separate types, because they are read
 *    at different cadences.
 */

export type OsPlatform = 'windows' | 'macos' | 'linux' | 'unknown'

export interface SystemInfo {
  hostname: string
  platform: OsPlatform
  osName: string
  osVersion: string
  kernel: string
  architecture: string
  /** Seconds since boot. */
  uptimeSeconds: number
}

/** Static CPU capabilities — read once at startup. */
export interface CpuInfo {
  vendor: string
  model: string
  /** Physical cores. */
  cores: number
  /** Logical cores (SMT/Hyper-Threading and E-cores included). */
  threads: number
  baseClockGhz: number
  /**
   * Peak clock. Several CPUs (Intel Core Ultra among them) report their base clock
   * as the maximum, so the native probe raises this to the highest clock it has
   * actually observed.
   */
  maxClockGhz: number
  /** `null` when the cache topology is not exposed. */
  cacheL3Mb: number | null
}

/** Sampled CPU state — changes on every tick. */
export interface CpuLoad {
  /** Aggregate load, 0–100. */
  usagePercent: number
  /** `null` when current clock cannot be read. */
  currentClockGhz: number | null
  /** `null` without a thermal sensor — the normal case on Windows. */
  temperatureC: number | null
  /** Per-logical-core load, 0–100, `threads` entries long. */
  perCore: number[]
  /** `null` when the process table is not sampled this tick. */
  processCount: number | null
}

export interface MemoryInfo {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  /** Reclaimable page cache. `null` on Windows, which does not report it. */
  cachedBytes: number | null
  swapTotalBytes: number
  swapUsedBytes: number
  /** e.g. `DDR5`; `null` when the module layout is unreadable. */
  type: string | null
  speedMhz: number | null
  slotsUsed: number | null
  slotsTotal: number | null
}

export type DriveKind = 'nvme' | 'ssd' | 'hdd'

/**
 * A physical disk. Listed in its own right because a disk carries facts no volume has
 * — model, interface, temperature, SMART state — and because several volumes can share
 * one disk.
 */
export interface PhysicalDisk {
  id: string
  name: string
  kind: DriveKind | null
  interfaceType: string | null
  sizeBytes: number
  temperatureC: number | null
  smartStatus: string | null
}

/**
 * A mounted volume.
 *
 * `remote` volumes are network shares. They are reported — hiding a drive the user can
 * see in Explorer would look like a bug — but they are not this machine's storage, so
 * they stay out of the capacity totals and out of the score.
 */
export interface StorageDrive {
  id: string
  /** Volume label as the OS shows it, e.g. `OS`; `null` when unnamed. */
  label: string | null
  mountPoint: string
  /** Type of the physical disk the volume lives on; `null` for shares and unmapped volumes. */
  kind: DriveKind | null
  /** `true` for a network share. */
  remote: boolean
  /** `true` for removable media. */
  removable: boolean
  filesystem: string
  totalBytes: number
  freeBytes: number
  /** `null` when the platform reports no per-volume throughput (Windows). */
  readMbPerSec: number | null
  writeMbPerSec: number | null
  /** `true` for the volume the OS booted from. */
  system: boolean
}

/**
 * GPU telemetry. Every sampled field is nullable: integrated GPUs and locked-down
 * drivers routinely expose the model name and nothing else.
 */
export interface GpuInfo {
  id: string
  vendor: string
  model: string
  driverVersion: string | null
  /** `true` for iGPUs sharing system memory. */
  integrated: boolean
  vramTotalBytes: number | null
  vramUsedBytes: number | null
  usagePercent: number | null
  temperatureC: number | null
  coreClockMhz: number | null
  powerDrawWatts: number | null
}

/** One point in the rolling live-graph window. */
export interface LoadSample {
  /** Epoch milliseconds. */
  timestamp: number
  cpuPercent: number
  memoryPercent: number
  gpuPercent: number | null
}

/** Where the numbers came from — surfaced in the UI so the two are never confused. */
export type HardwareSource = 'native' | 'mock'

/** One measurement, without the rolling window the facade maintains around it. */
export interface HardwareReading {
  capturedAt: number
  source: HardwareSource
  system: SystemInfo
  cpu: CpuInfo
  cpuLoad: CpuLoad
  memory: MemoryInfo
  /** Best adapter first; empty when nothing was detected. */
  gpus: GpuInfo[]
  drives: StorageDrive[]
  physicalDisks: PhysicalDisk[]
}

export interface HardwareSnapshot extends HardwareReading {
  /** Oldest sample first; capped at `HISTORY_LENGTH`. */
  history: LoadSample[]
}

/** Severity band of the HardwareFlow score — maps onto the status palette. */
export type ScoreGrade = 'excellent' | 'good' | 'warning' | 'serious' | 'critical'

/** One weighted input to the overall score. */
export interface ScoreComponent {
  key: 'cpu' | 'memory' | 'gpu' | 'storage' | 'headroom'
  label: string
  /** Sub-score, 0–100. */
  score: number
  /** Contribution to the total; all weights sum to 1. */
  weight: number
  /** Short human-readable reason for the sub-score. */
  detail: string
}

export interface PerformanceScore {
  /** 0–100, rounded. */
  total: number
  grade: ScoreGrade
  components: ScoreComponent[]
}
