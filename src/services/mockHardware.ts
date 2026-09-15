import type {
  CpuInfo,
  CpuLoad,
  GpuInfo,
  HardwareReading,
  MemoryInfo,
  PhysicalDisk,
  StorageDrive,
  SystemInfo,
} from '../types/hardware'

/**
 * Simulated hardware source.
 *
 * Used when the app runs in a plain browser (`npm run dev:web`), where no native probe
 * exists. It deliberately fills in the fields Windows leaves `null` — a simulated
 * CPU temperature is useful for exercising the UI, and the `source: 'mock'` flag
 * keeps it from being mistaken for a measurement.
 */

const GIB = 1024 ** 3
const MIB = 1024 ** 2

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Mean-reverting random walk: pulls `current` towards `target` while adding noise,
 * which looks far more like real telemetry than `Math.random()` per tick.
 */
function walk(current: number, target: number, volatility: number, min: number, max: number) {
  const pull = (target - current) * 0.18
  const noise = (Math.random() - 0.5) * 2 * volatility
  return clamp(current + pull + noise, min, max)
}

const BASE_SYSTEM: SystemInfo = {
  hostname: 'ATLAS-WS01',
  platform: 'windows',
  osName: 'Windows 11 Pro',
  osVersion: '24H2 (Build 26200.1742)',
  kernel: '10.0.26200',
  architecture: 'x64',
  uptimeSeconds: 4 * 86400 + 7 * 3600 + 22 * 60,
}

const BASE_CPU: CpuInfo = {
  vendor: 'AMD',
  model: 'Ryzen 9 7950X3D',
  cores: 16,
  threads: 32,
  baseClockGhz: 4.2,
  maxClockGhz: 5.7,
  cacheL3Mb: 128,
}

const BASE_MEMORY: MemoryInfo = {
  totalBytes: 64 * GIB,
  usedBytes: 23.4 * GIB,
  freeBytes: 40.6 * GIB,
  cachedBytes: 7.9 * GIB,
  swapTotalBytes: 16 * GIB,
  swapUsedBytes: 1.2 * GIB,
  type: 'DDR5',
  speedMhz: 6000,
  slotsUsed: 4,
  slotsTotal: 4,
}

const BASE_GPUS: GpuInfo[] = [
  {
    id: 'gpu-0',
    vendor: 'NVIDIA',
    model: 'GeForce RTX 4080 SUPER',
    driverVersion: '566.36',
    integrated: false,
    vramTotalBytes: 16 * GIB,
    vramUsedBytes: 4.1 * GIB,
    usagePercent: 12,
    temperatureC: 46,
    coreClockMhz: 2295,
    powerDrawWatts: 84,
  },
  {
    id: 'gpu-1',
    vendor: 'AMD',
    model: 'Raphael iGPU',
    driverVersion: '31.0.24027',
    integrated: true,
    vramTotalBytes: null,
    vramUsedBytes: null,
    usagePercent: null,
    temperatureC: null,
    coreClockMhz: null,
    powerDrawWatts: null,
  },
]

const BASE_DRIVES: StorageDrive[] = [
  {
    id: 'c',
    label: 'System',
    mountPoint: 'C:',
    kind: 'nvme',
    remote: false,
    removable: false,
    filesystem: 'NTFS',
    totalBytes: 1862 * GIB,
    freeBytes: 611 * GIB,
    readMbPerSec: 142,
    writeMbPerSec: 68,
    system: true,
  },
  {
    id: 'd',
    label: 'Projects',
    mountPoint: 'D:',
    kind: 'nvme',
    remote: false,
    removable: false,
    filesystem: 'NTFS',
    totalBytes: 3725 * GIB,
    freeBytes: 1490 * GIB,
    readMbPerSec: 36,
    writeMbPerSec: 24,
    system: false,
  },
  {
    id: 'e',
    label: 'Archive',
    mountPoint: 'E:',
    kind: 'hdd',
    remote: false,
    removable: false,
    filesystem: 'NTFS',
    totalBytes: 7452 * GIB,
    freeBytes: 402 * GIB,
    readMbPerSec: 8,
    writeMbPerSec: 3,
    system: false,
  },
  {
    // A mapped share, so the simulator exercises the path that keeps a file server out
    // of the capacity totals and out of the score.
    id: 'n',
    label: 'Team',
    mountPoint: 'N:',
    kind: null,
    remote: true,
    removable: false,
    filesystem: 'SMB',
    totalBytes: 12_000 * GIB,
    freeBytes: 1_100 * GIB,
    readMbPerSec: null,
    writeMbPerSec: null,
    system: false,
  },
]

const BASE_DISKS: PhysicalDisk[] = [
  {
    id: 'disk-0',
    name: 'Samsung SSD 990 PRO 2TB',
    kind: 'nvme',
    interfaceType: 'NVMe',
    sizeBytes: 2000 * GIB,
    temperatureC: 41,
    smartStatus: 'Ok',
  },
  {
    id: 'disk-1',
    name: 'Samsung SSD 990 PRO 4TB',
    kind: 'nvme',
    interfaceType: 'NVMe',
    sizeBytes: 4000 * GIB,
    temperatureC: 38,
    smartStatus: 'Ok',
  },
  {
    id: 'disk-2',
    name: 'Seagate IronWolf 8TB',
    kind: 'hdd',
    interfaceType: 'SATA',
    sizeBytes: 8000 * GIB,
    temperatureC: 34,
    smartStatus: 'Ok',
  },
]

/**
 * Holds the mutable simulation state between ticks. One instance per subscription,
 * so React Strict Mode's double mount cannot desync the walk.
 */
export class MockHardwareSource {
  private system: SystemInfo = { ...BASE_SYSTEM }
  private cpuUsage = 14
  private cpuTarget = 14
  private cpuTemp = 42
  private memory: MemoryInfo = { ...BASE_MEMORY }
  private gpu: GpuInfo = { ...BASE_GPUS[0] }
  private drives: StorageDrive[] = BASE_DRIVES.map((drive) => ({ ...drive }))

  /** Stable per-thread bias, so core 0 is consistently busier than core 27. */
  private readonly coreBias = Array.from({ length: BASE_CPU.threads }, (_, index) =>
    index % 2 === 0 ? 1.15 - index * 0.012 : 0.72 - index * 0.008,
  )

  /** Remaining ticks of the current synthetic load burst. */
  private burstTicks = 0

  /** Moves the simulation forward by one tick. */
  private advance() {
    if (this.burstTicks > 0) {
      this.burstTicks -= 1
    } else if (Math.random() < 0.05) {
      // A build, a game or an export kicks off: sustained high load for a while.
      this.burstTicks = 6 + Math.floor(Math.random() * 12)
      this.cpuTarget = 62 + Math.random() * 33
    } else if (Math.random() < 0.12) {
      this.cpuTarget = 8 + Math.random() * 22
    }

    this.cpuUsage = walk(this.cpuUsage, this.cpuTarget, 4.5, 1, 100)
    this.cpuTemp = walk(this.cpuTemp, 38 + this.cpuUsage * 0.46, 1.2, 32, 95)

    // Memory tracks load, but lags it: allocations are sticky.
    const memoryTargetRatio = 0.3 + (this.cpuUsage / 100) * 0.34
    const usedBytes = walk(
      this.memory.usedBytes,
      this.memory.totalBytes * memoryTargetRatio,
      0.35 * GIB,
      4 * GIB,
      this.memory.totalBytes * 0.97,
    )
    const cachedBytes = walk(
      this.memory.cachedBytes ?? usedBytes * 0.3,
      usedBytes * 0.33,
      0.12 * GIB,
      0.5 * GIB,
      usedBytes * 0.6,
    )
    this.memory = {
      ...this.memory,
      usedBytes,
      cachedBytes,
      freeBytes: this.memory.totalBytes - usedBytes,
      swapUsedBytes: walk(this.memory.swapUsedBytes, 0.8 * GIB, 0.05 * GIB, 0, this.memory.swapTotalBytes),
    }

    // GPU load is loosely coupled to the CPU burst, plus its own idle noise.
    const gpuTarget = this.burstTicks > 0 ? 55 + Math.random() * 40 : 6 + Math.random() * 16
    const usagePercent = walk(this.gpu.usagePercent ?? 10, gpuTarget, 6, 0, 100)
    const vramTotal = this.gpu.vramTotalBytes ?? 0
    this.gpu = {
      ...this.gpu,
      usagePercent,
      vramUsedBytes: walk(
        this.gpu.vramUsedBytes ?? 0,
        vramTotal * (0.2 + (usagePercent / 100) * 0.55),
        0.2 * GIB,
        0.4 * GIB,
        vramTotal * 0.96,
      ),
      temperatureC: walk(this.gpu.temperatureC ?? 40, 40 + usagePercent * 0.4, 1.5, 32, 88),
      coreClockMhz: Math.round(walk(this.gpu.coreClockMhz ?? 2000, 1600 + usagePercent * 9, 40, 210, 2850)),
      powerDrawWatts: Math.round(walk(this.gpu.powerDrawWatts ?? 60, 40 + usagePercent * 2.6, 12, 22, 320)),
    }

    this.drives = this.drives.map((drive) => {
      // A share keeps its nulls: the point of having one in the simulation is to render
      // the same gaps a real mapped drive leaves.
      if (drive.remote) return drive

      const speedCeiling = drive.kind === 'hdd' ? 180 : drive.kind === 'ssd' ? 560 : 7200
      const activity = drive.system ? this.cpuUsage / 100 : Math.random() * 0.4
      return {
        ...drive,
        readMbPerSec: Math.round(
          walk(drive.readMbPerSec ?? 0, speedCeiling * activity * 0.35, speedCeiling * 0.05, 0, speedCeiling),
        ),
        writeMbPerSec: Math.round(
          walk(drive.writeMbPerSec ?? 0, speedCeiling * activity * 0.18, speedCeiling * 0.03, 0, speedCeiling),
        ),
        // Disks fill and empty far slower than anything else on screen.
        freeBytes: clamp(
          drive.freeBytes + (Math.random() - 0.55) * 40 * MIB,
          drive.totalBytes * 0.01,
          drive.totalBytes * 0.99,
        ),
      }
    })

    this.system = { ...this.system, uptimeSeconds: this.system.uptimeSeconds + 1 }
  }

  /** Spreads the aggregate load across threads while preserving its mean. */
  private perCoreLoad(): number[] {
    const spread = 18 + (100 - this.cpuUsage) * 0.22
    const raw = this.coreBias.map(
      (bias) => this.cpuUsage + (bias - 1) * spread + (Math.random() - 0.5) * 9,
    )
    const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length
    const correction = this.cpuUsage - mean
    return raw.map((value) => clamp(value + correction, 0, 100))
  }

  /** Advances the simulation and returns the resulting reading. */
  next(capturedAt: number = Date.now()): HardwareReading {
    this.advance()

    const cpuLoad: CpuLoad = {
      usagePercent: this.cpuUsage,
      currentClockGhz:
        BASE_CPU.baseClockGhz +
        (BASE_CPU.maxClockGhz - BASE_CPU.baseClockGhz) * (this.cpuUsage / 100) * 0.9,
      temperatureC: this.cpuTemp,
      perCore: this.perCoreLoad(),
      processCount: 248 + Math.round(this.cpuUsage * 0.8),
    }

    return {
      capturedAt,
      source: 'mock',
      system: { ...this.system },
      cpu: { ...BASE_CPU },
      cpuLoad,
      memory: { ...this.memory },
      gpus: [this.gpu, BASE_GPUS[1]],
      drives: this.drives.map((drive) => ({ ...drive })),
      physicalDisks: BASE_DISKS.map((disk) => ({ ...disk })),
    }
  }
}
