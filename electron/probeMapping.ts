import type si from 'systeminformation'

import type {
  BatteryInfo,
  CpuInfo,
  CpuLoad,
  DriveKind,
  GpuInfo,
  HardwareReading,
  MemoryInfo,
  NetworkAdapter,
  NetworkInfo,
  NetworkKind,
  OsPlatform,
  PhysicalDisk,
  ProcessGroup,
  ProcessSummary,
  StorageDrive,
  SystemInfo,
} from '../src/types/hardware'

/**
 * Turns raw `systeminformation` output into the app's domain model.
 *
 * Kept free of any I/O and of the polling state machine, so the mapping can be tested
 * against recorded output from real machines (`scripts/fixtures/`). Nearly every bug
 * this app has had lived here — a network share counted as local storage, the vendor
 * name doubled, a sleeping GPU reading as idle — and each one only showed up on real
 * data.
 */

const MIB = 1024 ** 2
const BYTES_PER_MB = 1024 ** 2

/** Everything the probe has cached, as plain data. Serialisable, so it can be recorded. */
export interface RawProbeState {
  platform: string
  systemDrive: string
  osInfo: si.Systeminformation.OsData | null
  cpu: si.Systeminformation.CpuData | null
  memLayout: si.Systeminformation.MemLayoutData[]
  diskLayout: si.Systeminformation.DiskLayoutData[]
  load: si.Systeminformation.CurrentLoadData | null
  mem: si.Systeminformation.MemData | null
  speed: si.Systeminformation.CpuCurrentSpeedData | null
  uptimeSeconds: number
  graphics: si.Systeminformation.GraphicsData | null
  temperature: si.Systeminformation.CpuTemperatureData | null
  fsSizes: si.Systeminformation.FsSizeData[]
  blockDevices: si.Systeminformation.BlockDevicesData[]
  networkInterfaces: si.Systeminformation.NetworkInterfacesData[]
  networkStats: si.Systeminformation.NetworkStatsData[]
  wifi: si.Systeminformation.WifiConnectionData[]
  battery: si.Systeminformation.BatteryData | null
  /** Already folded by `summarizeProcesses` — the raw table is several hundred rows. */
  processes: ProcessSummary | null
  /** Highest CPU clock seen so far, see `CpuInfo.maxClockGhz`. */
  observedMaxGhz: number
}

export function emptyRawState(): RawProbeState {
  return {
    platform: process.platform,
    systemDrive: process.env.SystemDrive ?? 'C:',
    osInfo: null,
    cpu: null,
    memLayout: [],
    diskLayout: [],
    load: null,
    mem: null,
    speed: null,
    uptimeSeconds: 0,
    graphics: null,
    temperature: null,
    fsSizes: [],
    blockDevices: [],
    networkInterfaces: [],
    networkStats: [],
    wifi: [],
    battery: null,
    processes: null,
    observedMaxGhz: 0,
  }
}

function mapPlatform(platform: string): OsPlatform {
  const value = platform.toLowerCase()
  if (value.includes('win')) return 'windows'
  if (value.includes('darwin') || value.includes('mac')) return 'macos'
  if (value.includes('linux')) return 'linux'
  return 'unknown'
}

/** Positive finite numbers only — `systeminformation` uses `-1`, `0` and `null` for "unknown". */
export function positive(value: number | null | undefined): number | null {
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
 * machine's storage.
 */
function isRemoteVolume(device: si.Systeminformation.BlockDevicesData | undefined): boolean {
  return device?.physical?.toLowerCase() === 'network'
}

function isSystemVolume(mount: string, raw: RawProbeState): boolean {
  if (raw.platform === 'win32') return mount.toLowerCase().startsWith(raw.systemDrive.toLowerCase())
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

function buildSystem(raw: RawProbeState): SystemInfo {
  const os = raw.osInfo
  return {
    hostname: nonEmpty(os?.hostname) ?? 'unbekannt',
    platform: mapPlatform(os?.platform ?? raw.platform),
    // "Microsoft Windows 11 Pro" → "Windows 11 Pro".
    osName: (nonEmpty(os?.distro) ?? 'Unbekanntes System').replace(/^Microsoft\s+/i, ''),
    osVersion:
      [nonEmpty(os?.codename), os?.build ? `(Build ${os.build})` : null].filter(Boolean).join(' ') ||
      (nonEmpty(os?.release) ?? '—'),
    kernel: nonEmpty(os?.kernel) ?? '—',
    architecture: nonEmpty(os?.arch) ?? 'unbekannt',
    uptimeSeconds: raw.uptimeSeconds,
  }
}

function buildCpu(raw: RawProbeState): CpuInfo {
  const cpu = raw.cpu
  const base = positive(cpu?.speed) ?? 0
  const l3Bytes = positive(cpu?.cache?.l3)

  return {
    vendor: nonEmpty(cpu?.manufacturer) ?? '',
    model: nonEmpty(cpu?.brand) ?? 'Unbekannter Prozessor',
    cores: positive(cpu?.physicalCores) ?? positive(cpu?.cores) ?? 1,
    threads: positive(cpu?.cores) ?? 1,
    baseClockGhz: base,
    maxClockGhz: Math.max(positive(cpu?.speedMax) ?? 0, base, raw.observedMaxGhz),
    cacheL3Mb: l3Bytes === null ? null : Math.round(l3Bytes / MIB),
  }
}

function buildCpuLoad(raw: RawProbeState, threads: number): CpuLoad {
  const perCore = (raw.load?.cpus ?? []).map((core) => core.load).slice(0, threads)

  return {
    usagePercent: Math.min(100, Math.max(0, raw.load?.currentLoad ?? 0)),
    currentClockGhz: positive(raw.speed?.avg),
    // `null` on Windows without a helper driver — the normal case.
    temperatureC: positive(raw.temperature?.main),
    perCore,
    processCount: raw.processes?.count ?? null,
  }
}

function buildMemory(raw: RawProbeState): MemoryInfo {
  const mem = raw.mem
  const totalBytes = positive(mem?.total) ?? 0
  // `active` excludes reclaimable cache where the platform separates the two.
  const usedBytes = Math.min(positive(mem?.active) ?? positive(mem?.used) ?? 0, totalBytes)
  const modules = raw.memLayout.filter((module) => positive(module.size) !== null)

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
    slotsTotal: raw.memLayout.length || null,
    ecc: modules.length === 0 ? null : modules.every((module) => module.ecc === true),
  }
}

function buildGpus(raw: RawProbeState): GpuInfo[] {
  return (raw.graphics?.controllers ?? [])
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
 * Volumes, enriched from `blockDevices()`: the label, whether the volume is a share,
 * and the `\\.\PHYSICALDRIVEn` path that joins it to `diskLayout` for its NVMe/SSD/HDD
 * type.
 */
function buildDrives(raw: RawProbeState): StorageDrive[] {
  const byMount = new Map(
    raw.blockDevices
      .filter((device) => nonEmpty(device.mount))
      .map((device) => [device.mount.toLowerCase(), device] as const),
  )
  const diskByDevice = new Map(
    raw.diskLayout.filter((disk) => nonEmpty(disk.device)).map((disk) => [disk.device, disk] as const),
  )

  return raw.fsSizes
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
        system: !remote && isSystemVolume(mountPoint, raw),
      }
    })
    .sort((a, b) => Number(b.system) - Number(a.system))
}

function buildPhysicalDisks(raw: RawProbeState): PhysicalDisk[] {
  return raw.diskLayout.map((disk, index): PhysicalDisk => ({
    id: nonEmpty(disk.device) ?? `disk-${index}`,
    name: [nonEmpty(disk.vendor), nonEmpty(disk.name)].filter(Boolean).join(' ') || 'Datenträger',
    kind: mapDiskKind(disk),
    interfaceType: nonEmpty(disk.interfaceType),
    sizeBytes: positive(disk.size) ?? 0,
    temperatureC: positive(disk.temperature),
    smartStatus: nonEmpty(disk.smartStatus),
  }))
}

/** VPN taps and hypervisor switches report as "wired" but are not a cable. */
const VIRTUAL_ADAPTER = /tap-windows|wintun|wireguard|openvpn|vpn|hyper-v|vmware|virtualbox|vethernet|loopback|tailscale|zerotier/i

function adapterKind(iface: si.Systeminformation.NetworkInterfacesData): NetworkKind {
  if (iface.virtual || VIRTUAL_ADAPTER.test(`${iface.ifaceName} ${iface.iface}`)) return 'virtual'
  return iface.type === 'wireless' ? 'wireless' : 'wired'
}

/** `networkStats` strips the spaces Windows has in connection names; `networkInterfaces` keeps them. */
const statsKey = (name: string) => name.replace(/\s+/g, '').toLowerCase()

/** Link speed a port *can* do, from the driver or — when unplugged — from its name. */
function ratedWiredMbps(iface: si.Systeminformation.NetworkInterfacesData): number | null {
  const name = iface.ifaceName.toLowerCase()
  if (/\b10\s?(?:gbe|gigabit|g\b)|10gbase|x550|aqc107|aqc113/.test(name)) return 10_000
  // 2.5 before 5: "2.5 Gigabit" also contains "5 Gigabit".
  if (/2[.,]5\s?(?:gbe|gigabit|g\b)|e3100|i225|i226|rtl8125/.test(name)) return 2_500
  if (/(?<![.,\d])5\s?(?:gbe|gigabit)/.test(name)) return 5_000
  return positive(iface.speed)
}

/** `Wi-Fi 7` from `Intel(R) Wi-Fi 7 BE202 160MHz`, and the same for 6E and 6. */
export function wifiGeneration(adapterName: string): string | null {
  const name = adapterName.toLowerCase()
  if (/wi-?fi 7|\bbe\d{3}\b/.test(name)) return 'Wi-Fi 7'
  if (/wi-?fi 6e|\bax21[01]\b|\bax411\b/.test(name)) return 'Wi-Fi 6E'
  if (/wi-?fi 6|\bax\d{3}\b/.test(name)) return 'Wi-Fi 6'
  return null
}

function buildNetwork(raw: RawProbeState): NetworkInfo {
  const stats = new Map(raw.networkStats.map((entry) => [statsKey(entry.iface), entry] as const))

  const adapters = raw.networkInterfaces
    .filter((iface) => !iface.internal && iface.operstate === 'up')
    .filter((iface) => !/loopback/i.test(iface.iface))
    .map((iface): NetworkAdapter => {
      const counters = stats.get(statsKey(iface.iface))
      const rate = (value: number | null | undefined) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

      return {
        id: iface.iface,
        name: iface.iface,
        adapter: (nonEmpty(iface.ifaceName) ?? iface.iface).replace(/\((?:R|TM)\)/gi, '').replace(/\s+/g, ' '),
        kind: adapterKind(iface),
        isDefault: iface.default === true,
        linkMbps: positive(iface.speed),
        ipv4: nonEmpty(iface.ip4),
        rxBytesPerSec: rate(counters?.rx_sec),
        txBytesPerSec: rate(counters?.tx_sec),
      }
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.kind.localeCompare(b.kind))

  const physical = raw.networkInterfaces.filter(
    (iface) => !iface.internal && adapterKind(iface) !== 'virtual',
  )
  const wiredSpeeds = physical
    .filter((iface) => iface.type !== 'wireless')
    .map(ratedWiredMbps)
    .filter((value): value is number => value !== null)
  const wirelessName = physical.find((iface) => iface.type === 'wireless')?.ifaceName ?? ''

  const link = raw.wifi[0]
  return {
    adapters,
    wifi: link
      ? {
          ssid: nonEmpty(link.ssid) ?? 'verborgen',
          signalDbm: typeof link.signalLevel === 'number' && link.signalLevel < 0 ? link.signalLevel : null,
          quality: positive(link.quality),
          frequencyMhz: positive(link.frequency),
          standard: nonEmpty(link.type),
        }
      : null,
    bestWiredMbps: wiredSpeeds.length > 0 ? Math.max(...wiredSpeeds) : null,
    wifiGeneration: wifiGeneration(wirelessName),
  }
}

function buildBattery(raw: RawProbeState): BatteryInfo | null {
  const battery = raw.battery
  if (!battery?.hasBattery) return null

  const design = positive(battery.designedCapacity)
  const full = positive(battery.maxCapacity)

  return {
    percent: Math.min(100, Math.max(0, battery.percent ?? 0)),
    charging: battery.isCharging === true,
    acConnected: battery.acConnected === true,
    designCapacityMwh: design,
    fullChargeCapacityMwh: full,
    healthPercent: design !== null && full !== null ? Math.min(100, (full / design) * 100) : null,
    cycleCount: positive(battery.cycleCount),
    minutesRemaining: battery.acConnected ? null : positive(battery.timeRemaining),
  }
}

/** Pseudo-processes that account for idle time rather than for a program. */
const IDLE_PROCESS = /^(?:system idle process|idle)$/i

/** How many programs each list keeps. */
const TOP_PROCESSES = 10

/**
 * Folds the process table into programs. On Windows `cpu` is a share of the whole
 * machine and `memRss` the working set in KB; "System Idle Process" carries the idle
 * time and would otherwise top the CPU list at 90 %.
 */
export function summarizeProcesses(data: si.Systeminformation.ProcessesData): ProcessSummary {
  const groups = new Map<string, ProcessGroup>()

  for (const entry of data.list ?? []) {
    const name = nonEmpty(entry.name)
    if (!name || entry.pid === 0 || IDLE_PROCESS.test(name)) continue

    const key = name.toLowerCase()
    const group = groups.get(key) ?? { name, instances: 0, cpuPercent: 0, memoryBytes: 0 }
    group.instances += 1
    group.cpuPercent += Number.isFinite(entry.cpu) ? Math.max(entry.cpu, 0) : 0
    group.memoryBytes += Number.isFinite(entry.memRss) ? Math.max(entry.memRss, 0) * 1024 : 0
    groups.set(key, group)
  }

  const all = [...groups.values()].map((group) => ({
    ...group,
    cpuPercent: Math.min(group.cpuPercent, 100),
  }))

  return {
    count: positive(data.all) ?? (data.list ?? []).length,
    byCpu: [...all].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, TOP_PROCESSES),
    byMemory: [...all].sort((a, b) => b.memoryBytes - a.memoryBytes).slice(0, TOP_PROCESSES),
  }
}

/** Assembles a reading from whatever each tier has most recently cached. */
export function buildReading(raw: RawProbeState, capturedAt: number): HardwareReading {
  const cpu = buildCpu(raw)
  return {
    capturedAt,
    source: 'native',
    system: buildSystem(raw),
    cpu,
    cpuLoad: buildCpuLoad(raw, cpu.threads),
    memory: buildMemory(raw),
    gpus: buildGpus(raw),
    drives: buildDrives(raw),
    physicalDisks: buildPhysicalDisks(raw),
    network: buildNetwork(raw),
    battery: buildBattery(raw),
    processes: raw.processes,
  }
}
