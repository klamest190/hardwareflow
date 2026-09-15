import si from 'systeminformation'

import type {
  CpuInfo,
  CpuLoad,
  DriveKind,
  GpuInfo,
  HardwareReading,
  MemoryInfo,
  OsPlatform,
  PhysicalDisk,
  StorageDrive,
  SystemInfo,
} from '../src/types/hardware'

/**
 * Real hardware probe, running in the Electron main process.
 *
 * Two things drive the design:
 *
 * 1. **Tiered polling.** A full `systeminformation` sweep costs ~7 s on Windows,
 *    because most calls shell out to WMI/PowerShell. Only load, memory and clock are
 *    cheap enough for a 1 s tick; graphics and temperature go on a 2 s tier, the
 *    filesystem and process table on a 15 s tier, and the static inventory is read
 *    once. Each tier skips its turn if the previous run is still in flight, so a slow
 *    WMI call can never queue up behind itself.
 * 2. **No invented values.** Where a platform reports nothing the field stays `null`
 *    all the way to the UI. On Windows that is CPU temperature, the page-cache size
 *    and per-volume disk throughput.
 */

const MIB = 1024 ** 2
const BYTES_PER_MB = 1024 ** 2

/** Intervals per tier, in milliseconds. */
const MEDIUM_TIER_MS = 2000
const SLOW_TIER_MS = 15_000
const STATIC_TIER_MS = 300_000

function mapPlatform(platform: string): OsPlatform {
  const value = platform.toLowerCase()
  if (value.includes('win')) return 'windows'
  if (value.includes('darwin') || value.includes('mac')) return 'macos'
  if (value.includes('linux')) return 'linux'
  return 'unknown'
}

/** Positive finite numbers only — `systeminformation` uses `-1`, `0` and `null` for "unknown". */
function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function mapDiskKind(disk: si.Systeminformation.DiskLayoutData): DriveKind | null {
  const haystack = `${disk.interfaceType ?? ''} ${disk.name ?? ''} ${disk.type ?? ''}`.toLowerCase()
  if (haystack.includes('nvme')) return 'nvme'
  if (disk.type === 'SSD' || haystack.includes('ssd')) return 'ssd'
  if (disk.type === 'HD' || haystack.includes('hdd')) return 'hdd'
  return null
}

/**
 * A network share, as `blockDevices()` labels it. Windows lists mapped drives next to
 * local volumes in `fsSize()`, so without this check a file server would count as this
 * machine's storage — including in the score's capacity term.
 */
function isRemoteVolume(device: si.Systeminformation.BlockDevicesData | undefined): boolean {
  return device?.physical?.toLowerCase() === 'network'
}

/** `true` for the volume the OS booted from. */
function isSystemVolume(mount: string): boolean {
  if (process.platform === 'win32') {
    const systemDrive = (process.env.SystemDrive ?? 'C:').toLowerCase()
    return mount.toLowerCase().startsWith(systemDrive)
  }
  return mount === '/'
}

/**
 * Ranks adapters so the one worth showing comes first: reporting live utilisation
 * beats not reporting it, dedicated beats integrated, more VRAM beats less.
 */
function rankGpu(gpu: GpuInfo): number {
  const telemetry = gpu.usagePercent !== null ? 4 : 0
  const dedicated = gpu.integrated ? 0 : 2
  const vram = (gpu.vramTotalBytes ?? 0) / 1e12
  return telemetry + dedicated + vram
}

/** Static inventory, re-read only every few minutes. */
interface StaticInventory {
  osInfo: si.Systeminformation.OsData
  cpu: si.Systeminformation.CpuData
  memLayout: si.Systeminformation.MemLayoutData[]
  diskLayout: si.Systeminformation.DiskLayoutData[]
}

export interface ProbeOptions {
  /** Fast-tier interval. Defaults to 1000 ms. */
  intervalMs?: number
  /**
   * Called with a message when a tier starts failing and with `null` once every tier
   * reads cleanly again. A WMI call that hiccups once should not leave a warning on
   * screen for the rest of the session.
   */
  onStatus?: (message: string | null) => void
}

export class HardwareProbe {
  private readonly intervalMs: number
  private readonly onStatus: (message: string | null) => void

  private inventory: StaticInventory | null = null
  private load: si.Systeminformation.CurrentLoadData | null = null
  private mem: si.Systeminformation.MemData | null = null
  private speed: si.Systeminformation.CpuCurrentSpeedData | null = null
  private uptimeSeconds = 0
  private graphics: si.Systeminformation.GraphicsData | null = null
  private temperature: si.Systeminformation.CpuTemperatureData | null = null
  private fsSizes: si.Systeminformation.FsSizeData[] = []
  private blockDevices: si.Systeminformation.BlockDevicesData[] = []
  private processCount: number | null = null

  /**
   * Highest clock ever observed. Several CPUs (Intel Core Ultra among them) report
   * their base clock as `speedMax`, which would understate the machine badly in the
   * score; the observed peak corrects that upwards over time.
   */
  private observedMaxGhz = 0

  private timers: ReturnType<typeof setInterval>[] = []
  private readonly busy = new Set<string>()
  /** Tiers whose last run threw, with the reason — drives the UI's warning banner. */
  private readonly failing = new Map<string, string>()
  private listener: ((reading: HardwareReading) => void) | null = null

  constructor(options: ProbeOptions = {}) {
    this.intervalMs = options.intervalMs ?? 1000
    this.onStatus = options.onStatus ?? (() => {})
  }

  /** Runs `task` unless its tier is still busy; reports failures without throwing. */
  private async guarded(tier: string, task: () => Promise<void>) {
    if (this.busy.has(tier)) return
    this.busy.add(tier)
    try {
      await task()
      // Recovery is as newsworthy as the failure: clear the tier and, once nothing is
      // failing any more, retract the warning instead of leaving it up forever.
      if (this.failing.delete(tier)) this.report()
    } catch (error) {
      this.failing.set(tier, error instanceof Error ? error.message : String(error))
      this.report()
    } finally {
      this.busy.delete(tier)
    }
  }

  private report() {
    if (this.failing.size === 0) {
      this.onStatus(null)
      return
    }
    this.onStatus(
      [...this.failing].map(([tier, message]) => `${tier}: ${message}`).join(' · '),
    )
  }

  private async refreshStatic() {
    const [osInfo, cpu, memLayout, diskLayout] = await Promise.all([
      si.osInfo(),
      si.cpu(),
      si.memLayout(),
      si.diskLayout(),
    ])
    this.inventory = { osInfo, cpu, memLayout, diskLayout }
  }

  private async refreshFast() {
    const [load, mem, speed, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuCurrentSpeed(),
      Promise.resolve(si.time()),
    ])
    this.load = load
    this.mem = mem
    this.speed = speed
    this.uptimeSeconds = time.uptime ?? 0

    const peak = Math.max(speed.max ?? 0, speed.avg ?? 0, ...(speed.cores ?? []))
    if (Number.isFinite(peak)) this.observedMaxGhz = Math.max(this.observedMaxGhz, peak)
  }

  private async refreshMedium() {
    const [graphics, temperature] = await Promise.all([si.graphics(), si.cpuTemperature()])
    this.graphics = graphics
    this.temperature = temperature
  }

  private async refreshSlow() {
    const [fsSizes, blockDevices, processes] = await Promise.all([
      si.fsSize(),
      si.blockDevices(),
      si.processes(),
    ])
    this.fsSizes = fsSizes
    this.blockDevices = blockDevices
    this.processCount = positive(processes.all)
  }

  private buildSystem(): SystemInfo {
    const os = this.inventory?.osInfo
    return {
      hostname: nonEmpty(os?.hostname) ?? 'unbekannt',
      platform: mapPlatform(os?.platform ?? process.platform),
      // "Microsoft Windows 11 Pro" → "Windows 11 Pro".
      osName: (nonEmpty(os?.distro) ?? 'Unbekanntes System').replace(/^Microsoft\s+/i, ''),
      osVersion: [nonEmpty(os?.codename), os?.build ? `(Build ${os.build})` : null]
        .filter(Boolean)
        .join(' ') || (nonEmpty(os?.release) ?? '—'),
      kernel: nonEmpty(os?.kernel) ?? '—',
      architecture: nonEmpty(os?.arch) ?? process.arch,
      uptimeSeconds: this.uptimeSeconds,
    }
  }

  private buildCpu(): CpuInfo {
    const cpu = this.inventory?.cpu
    const base = positive(cpu?.speed) ?? 0
    const l3Bytes = positive(cpu?.cache?.l3)

    return {
      vendor: nonEmpty(cpu?.manufacturer) ?? '',
      model: nonEmpty(cpu?.brand) ?? 'Unbekannter Prozessor',
      cores: positive(cpu?.physicalCores) ?? positive(cpu?.cores) ?? 1,
      threads: positive(cpu?.cores) ?? 1,
      baseClockGhz: base,
      maxClockGhz: Math.max(positive(cpu?.speedMax) ?? 0, base, this.observedMaxGhz),
      cacheL3Mb: l3Bytes === null ? null : Math.round(l3Bytes / MIB),
    }
  }

  private buildCpuLoad(threads: number): CpuLoad {
    const load = this.load
    const perCore = (load?.cpus ?? []).map((core) => core.load).slice(0, threads)

    return {
      usagePercent: Math.min(100, Math.max(0, load?.currentLoad ?? 0)),
      currentClockGhz: positive(this.speed?.avg),
      // `null` on Windows without a helper driver — the normal case.
      temperatureC: positive(this.temperature?.main),
      perCore,
      processCount: this.processCount,
    }
  }

  private buildMemory(): MemoryInfo {
    const mem = this.mem
    const totalBytes = positive(mem?.total) ?? 0
    // `active` excludes reclaimable cache where the platform separates the two.
    const usedBytes = Math.min(positive(mem?.active) ?? positive(mem?.used) ?? 0, totalBytes)
    const modules = (this.inventory?.memLayout ?? []).filter((module) => positive(module.size) !== null)

    return {
      totalBytes,
      usedBytes,
      // Derived rather than read, so the three always add up in the UI.
      freeBytes: Math.max(totalBytes - usedBytes, 0),
      cachedBytes: positive(mem?.buffcache),
      swapTotalBytes: positive(mem?.swaptotal) ?? 0,
      swapUsedBytes: positive(mem?.swapused) ?? 0,
      type: nonEmpty(modules[0]?.type),
      speedMhz: positive(modules[0]?.clockSpeed),
      slotsUsed: modules.length || null,
      slotsTotal: (this.inventory?.memLayout ?? []).length || null,
    }
  }

  private buildGpus(): GpuInfo[] {
    const controllers = this.graphics?.controllers ?? []

    return controllers
      .map((controller, index): GpuInfo => {
        const totalMb = positive(controller.memoryTotal) ?? positive(controller.vram)
        const usedMb = positive(controller.memoryUsed)

        return {
          id: nonEmpty(controller.pciBus) ?? nonEmpty(controller.subDeviceId) ?? `gpu-${index}`,
          vendor: nonEmpty(controller.vendor)?.replace(/\s+(corporation|inc\.?)$/i, '') ?? '',
          model: nonEmpty(controller.model) ?? 'Unbekannter Grafikadapter',
          driverVersion: nonEmpty(controller.driverVersion),
          // Adapters that carve VRAM out of system memory are the integrated ones.
          integrated: controller.vramDynamic === true,
          vramTotalBytes: totalMb === null ? null : Math.round(totalMb * BYTES_PER_MB),
          vramUsedBytes: usedMb === null ? null : Math.round(usedMb * BYTES_PER_MB),
          usagePercent:
            typeof controller.utilizationGpu === 'number' && controller.utilizationGpu >= 0
              ? controller.utilizationGpu
              : null,
          temperatureC: positive(controller.temperatureGpu),
          coreClockMhz: positive(controller.clockCore),
          powerDrawWatts: positive(controller.powerDraw),
        }
      })
      .sort((a, b) => rankGpu(b) - rankGpu(a))
  }

  /**
   * Volumes, enriched from `blockDevices()`.
   *
   * `fsSize()` alone cannot tell a local disk from a mapped network drive and carries no
   * volume label. `blockDevices()` supplies both, plus the `\\.\PHYSICALDRIVEn` path that
   * joins a volume to its entry in `diskLayout` — which is where the volume's NVMe/SSD/HDD
   * type actually comes from.
   */
  private buildDrives(): StorageDrive[] {
    const byMount = new Map(
      this.blockDevices
        .filter((device) => nonEmpty(device.mount))
        .map((device) => [device.mount.toLowerCase(), device] as const),
    )
    const diskByDevice = new Map(
      (this.inventory?.diskLayout ?? [])
        .filter((disk) => nonEmpty(disk.device))
        .map((disk) => [disk.device, disk] as const),
    )

    return this.fsSizes
      .filter((volume) => positive(volume.size) !== null)
      .map((volume): StorageDrive => {
        const mountPoint = nonEmpty(volume.mount) ?? nonEmpty(volume.fs) ?? '?'
        const device = byMount.get(mountPoint.toLowerCase())
        const remote = isRemoteVolume(device)
        const disk = device?.device ? diskByDevice.get(device.device) : undefined

        return {
          id: nonEmpty(volume.fs) ?? mountPoint,
          label: nonEmpty(device?.label),
          mountPoint,
          // Only ever the type of the disk the volume actually sits on; a share has none.
          kind: disk ? mapDiskKind(disk) : null,
          remote,
          removable: device?.removable === true,
          filesystem: nonEmpty(volume.type) ?? '—',
          totalBytes: volume.size,
          freeBytes: Math.max(positive(volume.available) ?? 0, 0),
          // Neither `disksIO` nor `fsStats` returns anything on Windows.
          readMbPerSec: null,
          writeMbPerSec: null,
          // A share is never the boot volume, whatever letter it was mapped to.
          system: !remote && isSystemVolume(mountPoint),
        }
      })
      .sort((a, b) => Number(b.system) - Number(a.system))
  }

  private buildPhysicalDisks(): PhysicalDisk[] {
    return (this.inventory?.diskLayout ?? []).map((disk, index): PhysicalDisk => ({
      id: nonEmpty(disk.device) ?? `disk-${index}`,
      name: [nonEmpty(disk.vendor), nonEmpty(disk.name)].filter(Boolean).join(' ') || 'Datenträger',
      kind: mapDiskKind(disk),
      interfaceType: nonEmpty(disk.interfaceType),
      sizeBytes: positive(disk.size) ?? 0,
      temperatureC: positive(disk.temperature),
      smartStatus: nonEmpty(disk.smartStatus),
    }))
  }

  /** Assembles a reading from whatever each tier has most recently cached. */
  reading(): HardwareReading {
    const cpu = this.buildCpu()
    return {
      capturedAt: Date.now(),
      source: 'native',
      system: this.buildSystem(),
      cpu,
      cpuLoad: this.buildCpuLoad(cpu.threads),
      memory: this.buildMemory(),
      gpus: this.buildGpus(),
      drives: this.buildDrives(),
      physicalDisks: this.buildPhysicalDisks(),
    }
  }

  /** Reads every tier once, so the first emitted reading is already complete. */
  async warmUp(): Promise<void> {
    await Promise.all([
      this.guarded('static', () => this.refreshStatic()),
      this.guarded('fast', () => this.refreshFast()),
      this.guarded('medium', () => this.refreshMedium()),
      this.guarded('slow', () => this.refreshSlow()),
    ])
    // `currentLoad` needs two samples to report a meaningful delta.
    await this.guarded('fast', () => this.refreshFast())
  }

  /** Starts all tiers and emits on every fast tick. */
  start(listener: (reading: HardwareReading) => void): void {
    this.listener = listener
    this.startTimers()
  }

  /**
   * Stops polling without forgetting anything already read.
   *
   * Pausing has to reach this far down: every tier shells out to WMI, so a paused
   * dashboard that only stopped listening would still keep the machine busy measuring
   * itself. Resuming refreshes immediately rather than waiting out the first interval.
   */
  pause(): void {
    this.clearTimers()
  }

  resume(): void {
    if (this.timers.length > 0 || !this.listener) return
    this.startTimers()
    void this.guarded('fast', async () => {
      await this.refreshFast()
      this.listener?.(this.reading())
    })
  }

  get paused(): boolean {
    return this.timers.length === 0
  }

  private startTimers(): void {
    this.timers.push(
      setInterval(() => {
        void this.guarded('fast', async () => {
          await this.refreshFast()
          this.listener?.(this.reading())
        })
      }, this.intervalMs),
      setInterval(() => void this.guarded('medium', () => this.refreshMedium()), MEDIUM_TIER_MS),
      setInterval(() => void this.guarded('slow', () => this.refreshSlow()), SLOW_TIER_MS),
      setInterval(() => void this.guarded('static', () => this.refreshStatic()), STATIC_TIER_MS),
    )
  }

  stop(): void {
    this.clearTimers()
    this.listener = null
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
  }
}
