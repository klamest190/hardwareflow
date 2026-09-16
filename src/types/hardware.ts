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
  /**
   * Package temperature. Windows itself reports none; on a real machine this comes only
   * from a running LibreHardwareMonitor, so `null` is the normal case.
   */
  temperatureC: number | null
  /** Package power draw, from the same sensor provider; `null` without one. */
  powerWatts: number | null
  /** Per-logical-core load, 0–100, `threads` entries long. */
  perCore: number[]
  /** `null` when the process table is not sampled this tick. */
  processCount: number | null
}

export interface FanReading {
  name: string
  rpm: number
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
  /** `true` when every module reports ECC; `null` when the layout is unreadable. */
  ecc: boolean | null
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

export type NetworkKind = 'wired' | 'wireless' | 'virtual'

/** A network adapter that is up. Adapters that are down are not worth a row. */
export interface NetworkAdapter {
  id: string
  /** Connection name as Windows shows it, e.g. `WLAN`. */
  name: string
  /** Hardware name, e.g. `Intel Wi-Fi 7 BE202 160MHz`. */
  adapter: string
  kind: NetworkKind
  /** `true` for the adapter carrying the default route. */
  isDefault: boolean
  /** Negotiated link speed; `null` when the driver reports none. */
  linkMbps: number | null
  ipv4: string | null
  /** `null` until two counter samples exist, or when the adapter reports none. */
  rxBytesPerSec: number | null
  txBytesPerSec: number | null
}

export interface WifiLink {
  ssid: string
  /** Signal strength in dBm, e.g. `-57`. */
  signalDbm: number | null
  /** 0–100 as Windows rates it. */
  quality: number | null
  frequencyMhz: number | null
  /** e.g. `802.11ax`. */
  standard: string | null
}

export interface NetworkInfo {
  /** Adapters that are up, default adapter first. */
  adapters: NetworkAdapter[]
  wifi: WifiLink | null
  /**
   * The fastest wired port the hardware has, including unplugged ones — a 2.5 GbE port
   * is a property of the machine even without a cable. Read from the adapter name when
   * the driver reports no speed for a port that is down.
   */
  bestWiredMbps: number | null
  /** e.g. `Wi-Fi 7`, from the adapter name; `null` when not recognisable. */
  wifiGeneration: string | null
}

export interface BatteryInfo {
  percent: number
  charging: boolean
  acConnected: boolean
  designCapacityMwh: number | null
  fullChargeCapacityMwh: number | null
  /** Full-charge against design capacity, 0–100. */
  healthPercent: number | null
  /** Windows usually reports 0 here, which becomes `null`. */
  cycleCount: number | null
  /** Minutes left on battery; `null` on AC or when unknown. */
  minutesRemaining: number | null
}

/** One program with all its processes folded together — Chrome is one line, not forty. */
export interface ProcessGroup {
  name: string
  instances: number
  /** Every process folded into the group — what "Beenden" acts on. */
  pids: number[]
  /** Executable path of the first instance; `null` when Windows withholds it. */
  path: string | null
  /** Share of the whole machine, 0–100. */
  cpuPercent: number
  memoryBytes: number
}

export interface ProcessSummary {
  count: number
  byCpu: ProcessGroup[]
  byMemory: ProcessGroup[]
}

/** One point in the rolling live-graph window. */
export interface LoadSample {
  /** Epoch milliseconds. */
  timestamp: number
  cpuPercent: number
  memoryPercent: number
  gpuPercent: number | null
  /** Summed over all adapters that are up; `null` before the first counter delta. */
  netRxBytesPerSec: number | null
  netTxBytesPerSec: number | null
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
  network: NetworkInfo
  /** `null` on machines without a battery. */
  battery: BatteryInfo | null
  /** `null` until the process table has been read once. */
  processes: ProcessSummary | null
  /** Fans the sensor provider reports; empty without one. */
  fans: FanReading[]
  /**
   * Which hardware-sensor tool supplied temperature, fan and power readings, e.g.
   * `LibreHardwareMonitor`; `null` when none is running.
   */
  sensorProvider: string | null
}

export interface HardwareSnapshot extends HardwareReading {
  /** Oldest sample first; capped at `HISTORY_LENGTH`. */
  history: LoadSample[]
}

/** Class of the machine by its HardwareFlow score. */
export type ScoreGrade = 'high-end' | 'strong' | 'solid' | 'entry' | 'dated'

export type ScoreComponentKey = 'cpu' | 'memory' | 'gpu' | 'storage' | 'extras'

/** One weighted input to the HardwareFlow score. */
export interface ScoreComponent {
  key: ScoreComponentKey
  label: string
  /** Sub-score, 0–100. */
  score: number
  /** Contribution to the total; all weights sum to 1. */
  weight: number
  /** Why this sub-score — shown under the bar, so the number is auditable. */
  detail: string
  /** `true` when the value comes from a formula rather than the benchmark table. */
  estimated: boolean
}

/** Something about the machine beyond its chips, counted in the extras component. */
export interface ScoreBadge {
  key: string
  label: string
  /** Contribution to the extras sub-score, which is capped at 100. */
  points: number
}

/**
 * The HardwareFlow score, 0–100: what the machine *is*. Deliberately independent of
 * load, so it is the same number on every tick and can be compared between machines —
 * what the machine has left right now is `Headroom`.
 */
export interface HardwareScore {
  total: number
  grade: ScoreGrade
  components: ScoreComponent[]
  badges: ScoreBadge[]
}

/** Live headroom: how much of the machine is still free right now. */
export interface Headroom {
  /** 0–100, averaged over the last few seconds. */
  percent: number
  cpuPercent: number
  memoryPercent: number
  gpuPercent: number | null
  /** Seconds the average spans. */
  windowSeconds: number
}

/** One minute of history, as the main process stores it. */
export interface HistoryBucket {
  /** Start of the minute, epoch milliseconds. */
  t: number
  cpuAvg: number
  cpuMax: number
  memAvg: number
  gpuAvg: number | null
  cpuTempMax: number | null
  gpuTempMax: number | null
  netRxAvg: number | null
  netTxAvg: number | null
  /** Free bytes on the system volume at the end of the minute. */
  systemFreeBytes: number | null
  systemTotalBytes: number | null
}

export type AlertKey = 'cpu-temp' | 'gpu-temp' | 'memory' | 'system-drive' | 'battery'

export interface HardwareAlert {
  key: AlertKey
  title: string
  message: string
  severity: 'warning' | 'critical'
}

/** An alert as it was raised, kept for the history page. */
export interface LoggedAlert extends HardwareAlert {
  /** Epoch milliseconds. */
  t: number
}

/** The limits the alert rules compare against; editable in the settings. */
export interface AlertThresholds {
  cpuTempC: number
  gpuTempC: number
  memoryPercent: number
  /** The system drive warns below this share free … */
  systemDriveFreePercent: number
  /** … or below this many gigabytes, whichever comes first. */
  systemDriveFreeGb: number
  batteryPercent: number
}
