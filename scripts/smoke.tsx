import { renderToString } from 'react-dom/server'

import {
  buildReading,
  diskThroughputByLetter,
  gpuUtilisationByAdapter,
  isCounterSample,
  sensorCpuTemperature,
  summarizeProcesses,
  type RawProbeState,
} from '../electron/probeMapping'
import { refusalReason } from '../electron/processPolicy'
import { renderTrayIcon, TRAY_ICON_SIZE } from '../electron/trayIcon'
import { AlertBanner } from '../src/components/AlertBanner'
import { BatteryCard } from '../src/components/BatteryCard'
import { CpuCard } from '../src/components/CpuCard'
import { DashboardHeader } from '../src/components/DashboardHeader'
import { GpuCard } from '../src/components/GpuCard'
import { HistoryCard } from '../src/components/HistoryCard'
import { MemoryCard } from '../src/components/MemoryCard'
import { Navigation } from '../src/components/Navigation'
import { NetworkCard } from '../src/components/NetworkCard'
import { PerformanceMeter } from '../src/components/PerformanceMeter'
import { ProcessesCard } from '../src/components/ProcessesCard'
import { SettingsCard } from '../src/components/SettingsCard'
import { StorageCard } from '../src/components/StorageCard'
import { AlertEngine, DEFAULT_ALERT_THRESHOLDS, sanitizeThresholds } from '../src/lib/alerts'
import { lookupCpu, lookupGpu } from '../src/lib/benchmarks'
import {
  describeDevice,
  formatBitrate,
  formatBytes,
  formatLinkSpeed,
  formatMinutes,
  formatThroughput,
  formatUptime,
} from '../src/lib/format'
import {
  DAY_MS,
  downsample,
  forecastSystemDrive,
  HistoryAccumulator,
  historyToCsv,
  isHistoryBucket,
  isLoggedAlert,
  trimAlertLog,
  MINUTE_MS,
  trimHistory,
} from '../src/lib/history'
import { PAGE_ICONS } from '../src/lib/pages'
import { computeHardwareScore, computeHeadroom, gradeForScore } from '../src/lib/hardwareScore'
import {
  activeSource,
  getMockSnapshot,
  HISTORY_LENGTH,
  subscribeHardware,
  toSample,
} from '../src/services/hardwareService'
import { MockHardwareSource, mockAlertLog, mockHistory } from '../src/services/mockHardware'
import type { HardwareReading, HardwareSnapshot, HistoryBucket } from '../src/types/hardware'
import notebookFixture from './fixtures/notebook-rtx4070.json'
import notebookCounters from './fixtures/notebook-rtx4070-counters.json'

const GIB = 1024 ** 3

const failures: string[] = []
let checks = 0

function check(condition: boolean, message: string) {
  checks += 1
  if (!condition) failures.push(message)
}

/** Jede Simulation muss über die gesamte Laufzeit plausible Werte liefern. */
function checkReading(reading: HardwareReading, tick: number) {
  const { cpu, cpuLoad, memory, gpus, drives, physicalDisks, network, processes } = reading

  check(reading.source === 'mock', `Tick ${tick}: Quelle ist "${reading.source}", nicht "mock"`)
  check(
    cpuLoad.usagePercent >= 0 && cpuLoad.usagePercent <= 100,
    `Tick ${tick}: CPU-Last außerhalb 0–100 (${cpuLoad.usagePercent})`,
  )
  check(
    cpuLoad.perCore.length === cpu.threads,
    `Tick ${tick}: ${cpuLoad.perCore.length} Thread-Werte statt ${cpu.threads}`,
  )
  check(
    cpuLoad.perCore.every((value) => value >= 0 && value <= 100),
    `Tick ${tick}: Thread-Last außerhalb 0–100`,
  )
  check(
    cpuLoad.currentClockGhz !== null &&
      cpuLoad.currentClockGhz >= cpu.baseClockGhz &&
      cpuLoad.currentClockGhz <= cpu.maxClockGhz,
    `Tick ${tick}: Takt außerhalb ${cpu.baseClockGhz}–${cpu.maxClockGhz} GHz (${cpuLoad.currentClockGhz})`,
  )
  check(memory.usedBytes + memory.freeBytes === memory.totalBytes, `Tick ${tick}: belegt + frei ≠ gesamt`)
  check((memory.cachedBytes ?? 0) <= memory.usedBytes, `Tick ${tick}: Cache größer als der belegte Speicher`)
  check(memory.swapUsedBytes <= memory.swapTotalBytes, `Tick ${tick}: Auslagerungsdatei über ihrer Größe`)

  check(gpus.length > 0, `Tick ${tick}: keine GPU im Mock-Reading`)
  for (const gpu of gpus) {
    if (gpu.vramTotalBytes !== null && gpu.vramUsedBytes !== null) {
      check(gpu.vramUsedBytes <= gpu.vramTotalBytes, `Tick ${tick}: ${gpu.model} meldet mehr VRAM belegt als vorhanden`)
    }
  }
  for (const drive of drives) {
    check(
      drive.freeBytes >= 0 && drive.freeBytes <= drive.totalBytes,
      `Tick ${tick}: ${drive.mountPoint} hat unplausible freie Kapazität`,
    )
  }
  check(physicalDisks.length > 0, `Tick ${tick}: keine Datenträger im Mock-Reading`)

  for (const adapter of network.adapters) {
    check(
      (adapter.rxBytesPerSec ?? 0) >= 0 && (adapter.txBytesPerSec ?? 0) >= 0,
      `Tick ${tick}: ${adapter.name} meldet negativen Durchsatz`,
    )
  }
  check(
    processes !== null && processes.byCpu.length > 0 && processes.byCpu.every((g) => g.cpuPercent >= 0),
    `Tick ${tick}: Prozessliste fehlt oder ist negativ`,
  )
}

// ─── 1. Simulation: 300 Ticks entsprechen 5 Minuten Laufzeit ─────────────────────────
const source = new MockHardwareSource()
for (let tick = 0; tick < 300; tick += 1) checkReading(source.next(), tick)

// ─── 2. Facade: gefülltes Fenster, Quelle, Pause/Fortsetzen ─────────────────────────
const snapshot = getMockSnapshot()
check(snapshot.history.length === HISTORY_LENGTH, `Verlauf hat ${snapshot.history.length} statt ${HISTORY_LENGTH} Punkte`)
check(
  snapshot.history.every((sample, i) => i === 0 || sample.timestamp >= snapshot.history[i - 1].timestamp),
  'Verlauf ist nicht chronologisch',
)
check(activeSource() === 'mock', `activeSource() → "${activeSource()}" statt "mock"`)

const carried = snapshot.history.slice(-12)
let resumed: HardwareSnapshot | null = null
const unsubscribe = subscribeHardware(
  (next) => {
    resumed ??= next
  },
  { initialHistory: carried },
)
unsubscribe()
check(resumed !== null, 'subscribeHardware hat nach dem Fortsetzen nichts geliefert')
check(
  resumed !== null && resumed.history.length === carried.length + 1,
  `Fortgesetzter Verlauf hat ${resumed?.history.length} Punkte statt ${carried.length + 1}`,
)
check(
  resumed !== null && resumed.history[0]?.timestamp === carried[0]?.timestamp,
  'Fortgesetzter Verlauf beginnt nicht beim übergebenen Fenster',
)

// ─── 3. Leistungstabelle: echte Treiber-Strings, auch die fiesen ────────────────────
const cpuCases: Array<[string, string, number | null]> = [
  ['Intel', 'Core™ Ultra 7 155H', 25_000],
  ['AMD', 'AMD Ryzen 9 7950X3D 16-Core Processor', 62_000],
  ['AMD', 'AMD Ryzen 9 7950X 16-Core Processor', 63_000],
  ['AMD', 'AMD Ryzen 7 9800X3D 8-Core Processor', 35_000],
  ['Intel', 'Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz', 13_800],
  ['Intel', 'Intel(R) Core(TM) i9-14900HX', 46_000],
  ['Intel', 'Intel(R) Core(TM) i7-13700H', 27_500],
  ['Apple', 'Apple M3 Pro', 26_500],
  ['Intel', 'Intel(R) Xeon(R) W-2295 CPU @ 3.00GHz', null],
]
for (const [vendor, model, expected] of cpuCases) {
  const actual = lookupCpu(vendor, model)?.index ?? null
  check(actual === expected, `lookupCpu(${model}) → ${actual} statt ${expected}`)
}

const gpuCases: Array<[string, string, number | null]> = [
  ['NVIDIA', 'NVIDIA GeForce RTX 4070 Laptop GPU', 20_000],
  ['NVIDIA', 'NVIDIA GeForce RTX 4070', 27_000],
  ['NVIDIA', 'NVIDIA GeForce RTX 4070 Ti SUPER', 31_500],
  ['NVIDIA', 'NVIDIA GeForce RTX 4080 SUPER', 34_700],
  ['Intel Corporation', 'Intel(R) Arc(TM) Graphics', 5_700],
  ['Intel Corporation', 'Intel(R) Arc(TM) A770 Graphics', 17_000],
  ['Advanced Micro Devices, Inc.', 'AMD Radeon RX 7900 XT', 27_500],
  ['Advanced Micro Devices, Inc.', 'AMD Radeon RX 7900 XTX', 29_500],
  ['Advanced Micro Devices, Inc.', 'AMD Radeon(TM) 780M', 7_000],
  ['Matrox', 'Matrox G200eW3', null],
]
for (const [vendor, model, expected] of gpuCases) {
  const actual = lookupGpu(vendor, model)?.index ?? null
  check(actual === expected, `lookupGpu(${model}) → ${actual} statt ${expected}`)
}

// ─── 4. HardwareFlow Score (0–100, unabhängig von der Last) ─────────────────────────
const score = computeHardwareScore(snapshot)
check(score.components.length === 5, `Score hat ${score.components.length} Bausteine statt 5`)
check(
  Math.abs(score.components.reduce((sum, part) => sum + part.weight, 0) - 1) < 1e-9,
  'Score-Gewichte summieren nicht auf 1',
)
check(
  score.components.every((part) => part.score >= 0 && part.score <= 100),
  'Teil-Score außerhalb 0–100',
)
check(score.total >= 0 && score.total <= 100, `Score außerhalb 0–100: ${score.total}`)
check(
  score.total >= 90 && score.grade === 'high-end',
  `Mock-Workstation (7950X3D + 4080 SUPER) nur ${score.total} (${score.grade})`,
)

// Der Score hängt nicht an der Last: dieselbe Maschine unter Volllast hat denselben Wert.
const busy: HardwareSnapshot = {
  ...snapshot,
  cpuLoad: { ...snapshot.cpuLoad, usagePercent: 100 },
  memory: { ...snapshot.memory, usedBytes: snapshot.memory.totalBytes * 0.97 },
  history: snapshot.history.map((sample) => ({ ...sample, cpuPercent: 100, memoryPercent: 97, gpuPercent: 100 })),
}
check(computeHardwareScore(busy).total === score.total, 'Score ändert sich mit der Last')
check(computeHeadroom(busy.history).percent < 10, 'Reserve unter Volllast nicht nahe 0')

// Ein Netzlaufwerk ist nicht die Hardware dieser Maschine.
const withHugeShare: HardwareSnapshot = {
  ...snapshot,
  drives: [
    ...snapshot.drives,
    {
      id: 'z',
      label: 'Fileserver',
      mountPoint: 'Z:',
      kind: null,
      remote: true,
      removable: false,
      filesystem: 'SMB',
      totalBytes: 400_000 * GIB,
      freeBytes: 1 * GIB,
      readMbPerSec: null,
      writeMbPerSec: null,
      system: false,
    },
  ],
}
check(computeHardwareScore(withHugeShare).total === score.total, 'Ein Netzlaufwerk verändert den Score')

// Bänder: Grenzen gehören zum höheren Band.
check(gradeForScore(85) === 'high-end' && gradeForScore(84) === 'strong', 'Bandgrenze bei 85 falsch')
check(gradeForScore(0) === 'dated' && gradeForScore(100) === 'high-end', 'Bandränder falsch')

// Unbekannte Hardware und lauter fehlende Werte: geschätzt, nicht kaputt.
const blind: HardwareSnapshot = {
  ...snapshot,
  cpu: { ...snapshot.cpu, vendor: 'Intel', model: 'Xeon W-2295' },
  cpuLoad: { ...snapshot.cpuLoad, currentClockGhz: null, temperatureC: null, processCount: null },
  memory: {
    ...snapshot.memory,
    cachedBytes: null,
    type: null,
    speedMhz: null,
    slotsUsed: null,
    slotsTotal: null,
    ecc: null,
  },
  gpus: [
    {
      ...snapshot.gpus[0],
      model: 'Matrox G200',
      vramTotalBytes: null,
      vramUsedBytes: null,
      usagePercent: null,
      temperatureC: null,
      coreClockMhz: null,
      powerDrawWatts: null,
      driverVersion: null,
    },
  ],
  drives: snapshot.drives.map((drive) => ({ ...drive, kind: null, label: null, readMbPerSec: null, writeMbPerSec: null })),
  physicalDisks: [],
  network: { adapters: [], wifi: null, bestWiredMbps: null, wifiGeneration: null },
  battery: null,
  processes: null,
  history: snapshot.history.map((sample) => ({
    ...sample,
    gpuPercent: null,
    netRxBytesPerSec: null,
    netTxBytesPerSec: null,
  })),
}
const blindScore = computeHardwareScore(blind)
check(
  Number.isFinite(blindScore.total) && blindScore.total > 0 && blindScore.total <= 100,
  `Blind-Score unplausibel: ${blindScore.total}`,
)
check(
  blindScore.components.find((part) => part.key === 'cpu')?.estimated === true &&
    blindScore.components.find((part) => part.key === 'gpu')?.estimated === true,
  'Unbekannte CPU/GPU nicht als geschätzt markiert',
)
const blindHeadroom = computeHeadroom(blind.history)
check(blindHeadroom.gpuPercent === null, 'Fehlende GPU-Last zählt als Messwert')
check(blindHeadroom.percent >= 0 && blindHeadroom.percent <= 100, 'Reserve außerhalb 0–100')

// ─── 5. Echte Maschine: aufgezeichnete systeminformation-Rohdaten ──────────────────
// Core Ultra 7 155H, RTX 4070 Laptop (schlafend, Optimus), Intel Arc iGPU, 32 GB DDR5,
// eine NVMe, gemappte Netzlaufwerke, WLAN (Wi-Fi 7), VPN-TAP-Adapter, gealterter Akku.
const raw = notebookFixture as unknown as RawProbeState
const real = buildReading(raw, Date.now())

check(real.source === 'native', 'Fixture-Reading ist nicht als native markiert')
check(describeDevice(real.cpu.vendor, real.cpu.model) === 'Intel Core Ultra 7 155H', `CPU-Name: ${real.cpu.model}`)
check(real.memory.type === 'DDR5' && real.memory.ecc === false, 'RAM-Typ/ECC aus der Fixture falsch')
check(real.gpus.length === 2, `Fixture: ${real.gpus.length} GPUs statt 2`)
check(real.gpus[0]?.model.includes('4070') === true, `Fixture: erste GPU ist ${real.gpus[0]?.model}`)
check(
  real.gpus.every((gpu) => gpu.usagePercent === null),
  'Schlafende Optimus-GPU meldet eine Auslastung statt n/v',
)

const localDrives = real.drives.filter((drive) => !drive.remote)
check(localDrives.length === 1 && localDrives[0].system && localDrives[0].kind === 'nvme', 'C: nicht als lokale System-NVMe erkannt')
// fsSize meldet von den drei gemappten Laufwerken nur H: mit Größe; I: und V: haben keine.
check(
  real.drives.some((drive) => drive.mountPoint === 'H:' && drive.remote && !drive.system),
  'Netzlaufwerk H: nicht als Freigabe erkannt',
)

check(real.battery !== null, 'Akku der Fixture nicht erkannt')
check(
  real.battery !== null && real.battery.healthPercent !== null && Math.abs(real.battery.healthPercent - 68.7) < 0.2,
  `Akkuzustand ${real.battery?.healthPercent} statt ≈ 68,7 %`,
)
check(real.battery?.cycleCount === null, 'Windows-Zyklenzahl 0 wurde als Messwert übernommen')

const wlan = real.network.adapters.find((adapter) => adapter.name === 'WLAN')
check(wlan?.kind === 'wireless' && wlan.isDefault, 'WLAN nicht als Standard-Funkadapter erkannt')
check(real.network.adapters[0]?.name === 'WLAN', 'Standardadapter steht nicht oben')
check(
  real.network.adapters.find((adapter) => adapter.adapter.includes('TAP'))?.kind === 'virtual',
  'VPN-TAP-Adapter nicht als virtuell erkannt',
)
check(!real.network.adapters.some((adapter) => /loopback/i.test(adapter.name)), 'Loopback in der Adapterliste')
check(real.network.bestWiredMbps === 2_500, `Bester LAN-Port ${real.network.bestWiredMbps} statt 2500 (Killer E3100G)`)
check(real.network.wifiGeneration === 'Wi-Fi 7', `WLAN-Generation ${real.network.wifiGeneration}`)
check(real.network.wifi !== null && real.network.wifi.signalDbm !== null, 'WLAN-Verbindung ohne Signalstärke')
check(
  real.processes !== null && !real.processes.byCpu.some((group) => /idle/i.test(group.name)),
  'Leerlaufprozess in den Top-Prozessen',
)

const realScore = computeHardwareScore(real)
const component = (key: string) => realScore.components.find((entry) => entry.key === key)
check(
  Math.round(component('cpu')?.score ?? -1) === 65 && !component('cpu')?.estimated,
  `CPU-Teil ${component('cpu')?.score} statt 65 (Core Ultra 7 155H)`,
)
// Die stärkste GPU zählt, nicht die zuerst gelistete — auch wenn sie gerade schläft.
check(
  Math.round(component('gpu')?.score ?? -1) === 75,
  `GPU-Teil ${component('gpu')?.score} statt 75 (RTX 4070 Laptop)`,
)
check(component('gpu')?.detail.includes('4070') === true, `GPU-Detail: ${component('gpu')?.detail}`)
check(
  realScore.badges.some((badge) => badge.key === 'wifi-7') &&
    realScore.badges.some((badge) => badge.key === 'multi-gig'),
  `Ausstattung der Fixture: ${realScore.badges.map((badge) => badge.key).join(', ')}`,
)
check(
  realScore.total >= 70 && realScore.total <= 75 && realScore.grade === 'strong',
  `Fixture-Notebook: ${realScore.total} (${realScore.grade}) statt 70–75 (strong)`,
)

// Varianten derselben Maschine.
const awake = buildReading(
  {
    ...raw,
    graphics: raw.graphics && {
      ...raw.graphics,
      controllers: raw.graphics.controllers.map((controller, index) =>
        index === 0 ? { ...controller, utilizationGpu: 35, temperatureGpu: 61 } : controller,
      ),
    },
  },
  Date.now(),
)
check(awake.gpus[0]?.usagePercent === 35 && awake.gpus[0]?.temperatureC === 61, 'Aufgewachte dGPU liefert keine Werte')

const withCounters = buildReading(
  {
    ...raw,
    networkStats: raw.networkStats.map((entry) =>
      entry.iface === 'WLAN' ? { ...entry, rx_sec: 1_250_000, tx_sec: 125_000 } : entry,
    ),
  },
  Date.now(),
)
const counterSample = toSample(withCounters)
check(counterSample.netRxBytesPerSec === 1_250_000, `Empfangsrate ${counterSample.netRxBytesPerSec} statt 1 250 000`)
check(toSample(real).netRxBytesPerSec === null, 'Fehlende Zähler werden als 0 statt n/v gemeldet')

const desktop = buildReading(
  { ...raw, battery: raw.battery && { ...raw.battery, hasBattery: false } },
  Date.now(),
)
check(desktop.battery === null, 'Rechner ohne Akku bekommt eine Akkukarte')

// ─── 5a. Leistungsindikatoren: dieselbe Maschine, mit dem PowerShell-Reader aufgenommen ─
// Ohne Reader (alte Fixture) bleibt alles n/v — das ist oben schon geprüft.
check(real.drives.every((drive) => drive.readMbPerSec === null), 'Ohne Zähler erscheint trotzdem Disk-I/O')

const counted = notebookCounters as unknown as RawProbeState
const withCountersReading = buildReading(counted, Date.now())
const systemDrive = withCountersReading.drives.find((drive) => drive.mountPoint === 'C:')
check(
  systemDrive?.readMbPerSec !== null && systemDrive?.readMbPerSec !== undefined && systemDrive.readMbPerSec > 5,
  `C: liest ${systemDrive?.readMbPerSec} MB/s statt ≈ 5,1 (Zähler 5 330 770 B/s)`,
)
check(
  withCountersReading.drives.find((drive) => drive.mountPoint === 'H:')?.readMbPerSec === null,
  'Netzlaufwerk H: bekommt den Durchsatz der lokalen Platte',
)
const arc = withCountersReading.gpus.find((gpu) => gpu.model.includes('Arc'))
check(arc?.usagePercent !== null && arc?.usagePercent !== undefined, 'Intel-iGPU ohne Auslastung trotz Zählern')
check(
  withCountersReading.gpus.every((gpu) => !/basic render/i.test(gpu.model)),
  'Microsoft Basic Render Driver als Grafikadapter gelistet',
)

// GPU-Engines: pro Prozess summiert, pro Adapter die geschäftigste Engine-Art.
const engineCounters = {
  ...counted.counters!,
  engines: [
    { n: 'pid_10_luid_0x00000000_0x00016ACF_phys_0_eng_0_engtype_3D', u: 20 },
    { n: 'pid_11_luid_0x00000000_0x00016ACF_phys_0_eng_0_engtype_3D', u: 15 },
    { n: 'pid_12_luid_0x00000000_0x00016ACF_phys_0_eng_3_engtype_VideoDecode', u: 30 },
    { n: 'pid_13_luid_0x00000000_0x00016F2E_phys_0_eng_0_engtype_Compute', u: 64 },
  ],
}
const engineLoad = gpuUtilisationByAdapter(engineCounters)
check(engineLoad.get('intel arc graphics') === 35, `Arc-Last ${engineLoad.get('intel arc graphics')} statt 35 (20 + 15 in 3D)`)
check(
  engineLoad.get('nvidia geforce rtx 4070 laptop gpu') === 64,
  `RTX-Last ${engineLoad.get('nvidia geforce rtx 4070 laptop gpu')} statt 64`,
)
check(![...engineLoad.keys()].some((key) => key.includes('basic render')), 'Software-Rasterizer in der GPU-Last')
// nvidia-smi hat Vorrang: Die Zähler füllen nur, was der Treiber nicht meldet.
const nvidiaFirst = buildReading({ ...counted, counters: engineCounters }, Date.now())
const rtx = nvidiaFirst.gpus.find((gpu) => gpu.model.includes('4070'))
const smiValue = counted.graphics?.controllers.find((controller) => controller.model.includes('4070'))?.utilizationGpu
check(rtx?.usagePercent === smiValue, `RTX-Last ${rtx?.usagePercent} statt nvidia-smi ${smiValue}`)

check(diskThroughputByLetter({ ...engineCounters, disks: [{ n: '1 D: E:', r: 1024, w: 2048 }] }).get('E:')?.write === 2048, 'Mehrere Buchstaben pro Platte nicht zugeordnet')

// Sensoren aus LibreHardwareMonitor: Package vor Kernen, Lüfter mit Drehzahl, Leistung.
const lhm: RawProbeState = {
  ...counted,
  counters: {
    ...counted.counters!,
    provider: 'LibreHardwareMonitor',
    sensors: [
      { i: '/intelcpu/0/temperature/0', n: 'CPU Core #1', t: 'Temperature', v: 88 },
      { i: '/intelcpu/0/temperature/9', n: 'CPU Package', t: 'Temperature', v: 81.5 },
      { i: '/intelcpu/0/power/0', n: 'CPU Package', t: 'Power', v: 42.3 },
      { i: '/gpu-nvidia/0/temperature/0', n: 'GPU Core', t: 'Temperature', v: 70 },
      { i: '/lpc/nct6798d/fan/0', n: 'Fan #1', t: 'Fan', v: 2451.6 },
      { i: '/lpc/nct6798d/fan/1', n: 'Fan #2', t: 'Fan', v: 0 },
    ],
  },
}
const lhmReading = buildReading(lhm, Date.now())
check(lhmReading.cpuLoad.temperatureC === 81.5, `CPU-Temperatur ${lhmReading.cpuLoad.temperatureC} statt Package 81.5`)
check(lhmReading.cpuLoad.powerWatts === 42.3, `CPU-Leistung ${lhmReading.cpuLoad.powerWatts} statt 42.3 W`)
check(
  lhmReading.fans.length === 1 && lhmReading.fans[0].rpm === 2452,
  `Lüfter: ${JSON.stringify(lhmReading.fans)} (stehender Lüfter muss fehlen)`,
)
check(lhmReading.sensorProvider === 'LibreHardwareMonitor', 'Sensorquelle nicht angegeben')
check(
  sensorCpuTemperature({ ...lhm, counters: { ...lhm.counters!, sensors: lhm.counters!.sensors.filter((s) => s.n !== 'CPU Package') } }) === 88,
  'Ohne Package-Sensor nicht der heißeste Kern',
)
check(isCounterSample(counted.counters) && !isCounterSample({ disks: 'kaputt' }), 'Formprüfung der Zählerzeile falsch')

// ─── 6. Prozesse zusammenfassen ─────────────────────────────────────────────────────
type ProcessRow = Parameters<typeof summarizeProcesses>[0]['list'][number]
// Nur die Felder, die das Zusammenfassen liest.
const processRow = (pid: number, name: string, cpu: number, memRss: number) =>
  ({ pid, name, cpu, memRss, path: `/apps/${name}` }) as ProcessRow
const folded = summarizeProcesses({
  all: 5,
  running: 5,
  blocked: 0,
  sleeping: 0,
  unknown: 0,
  list: [
    processRow(0, 'System Idle Process', 91, 8),
    processRow(10, 'chrome.exe', 1.5, 400_000),
    processRow(11, 'chrome.exe', 0.5, 600_000),
    processRow(12, 'chrome.exe', 0, 100_000),
    processRow(20, 'Code.exe', 3, 300_000),
  ],
})
check(folded.byCpu[0]?.name === 'Code.exe', `Top-CPU-Prozess ${folded.byCpu[0]?.name} statt Code.exe`)
const chrome = folded.byMemory[0]
check(
  chrome?.name === 'chrome.exe' &&
    chrome.instances === 3 &&
    chrome.memoryBytes === 1_100_000 * 1024 &&
    chrome.pids.join() === '10,11,12' &&
    chrome.path === '/apps/chrome.exe',
  `Chrome nicht korrekt gebündelt: ${JSON.stringify(chrome)}`,
)
check(!folded.byCpu.some((group) => group.name.includes('Idle')), 'Leerlaufprozess nicht herausgefiltert')

// ─── 7. Verlauf: Minuten-Buckets, Verdichtung, Prognose ────────────────────────────
const accumulator = new HistoryAccumulator()
const base = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - 10 * MINUTE_MS
const closed: HistoryBucket[] = []
for (let second = 0; second < 180; second += 1) {
  const reading = source.next(base + second * 1000)
  const load = second < 60 ? 20 : second < 120 ? 60 : 90
  const bucket = accumulator.add({ ...reading, cpuLoad: { ...reading.cpuLoad, usagePercent: load } })
  if (bucket) closed.push(bucket)
}
check(closed.length === 2, `${closed.length} abgeschlossene Minuten statt 2`)
check(closed[0]?.cpuAvg === 20 && closed[1]?.cpuAvg === 60, `Minutenmittel ${closed.map((b) => b.cpuAvg).join('/')}`)
const flushed = accumulator.flush()
check(flushed?.cpuAvg === 90 && flushed.t === base + 2 * MINUTE_MS, 'Laufende Minute geht beim Beenden verloren')
check(closed[0]?.systemFreeBytes !== null, 'Minute ohne Füllstand des Systemlaufwerks')

const week = mockHistory(Date.now())
check(week.length === 7 * 24 * 60, `Simulierte Woche hat ${week.length} Minuten`)
const hourly = downsample(week, 60 * MINUTE_MS)
check(hourly.length >= 167 && hourly.length <= 169, `Stündliche Verdichtung ergibt ${hourly.length} Punkte`)
check(
  hourly.every((bucket) => bucket.cpuMax >= bucket.cpuAvg - 1e-9),
  'Verdichtete Spitze unter dem Mittel',
)
check(trimHistory(week, Date.now() + 2 * DAY_MS).length < week.length, 'Alte Minuten werden nicht verworfen')
check(!isHistoryBucket({ t: 'kaputt' }) && isHistoryBucket(week[0]), 'Validierung gespeicherter Minuten falsch')

const filling = forecastSystemDrive(week)
check(
  filling !== null && filling.daysUntilFull !== null && Math.abs(filling.bytesPerDay / GIB + 3.2) < 0.2,
  `Prognose der simulierten Woche: ${filling && (filling.bytesPerDay / GIB).toFixed(2)} GB/Tag`,
)
const flat = forecastSystemDrive(week.map((bucket) => ({ ...bucket, systemFreeBytes: 500 * GIB })))
check(flat !== null && flat.daysUntilFull === null, 'Stabiles Laufwerk bekommt ein Voll-Datum')
check(forecastSystemDrive(week.slice(-60)) === null, 'Prognose schon nach einer Stunde')

// ─── 8. Warnungen ────────────────────────────────────────────────────────────────────
const engine = new AlertEngine()
const fullRam = (at: number): HardwareReading => ({
  ...snapshot,
  capturedAt: at,
  memory: { ...snapshot.memory, usedBytes: snapshot.memory.totalBytes * 0.97 },
})
const t0 = 1_000_000
check(engine.update(fullRam(t0)).active.length === 0, 'RAM-Warnung ohne Haltezeit')
check(engine.update(fullRam(t0 + 30_000)).active.length === 0, 'RAM-Warnung nach 30 s statt 60 s')
const raised = engine.update(fullRam(t0 + 61_000))
check(raised.fired.length === 1 && raised.fired[0].key === 'memory', 'RAM-Warnung nach 61 s nicht ausgelöst')
check(engine.update(fullRam(t0 + 62_000)).fired.length === 0, 'RAM-Warnung feuert bei jedem Tick erneut')
check(engine.update({ ...snapshot, capturedAt: t0 + 63_000 }).active.length === 0, 'RAM-Warnung bleibt nach Entspannung')

const fullDrive: HardwareReading = {
  ...snapshot,
  drives: snapshot.drives.map((drive) => (drive.system ? { ...drive, freeBytes: 4 * GIB } : drive)),
}
check(new AlertEngine().update(fullDrive).fired.some((alert) => alert.key === 'system-drive'), 'Volles C: löst keine Warnung aus')
check(
  new AlertEngine().update({ ...real, battery: real.battery && { ...real.battery, percent: 5 } }).active.length === 0,
  'Leerer Akku am Netzteil löst eine Warnung aus',
)
check(
  new AlertEngine()
    .update({ ...real, battery: real.battery && { ...real.battery, percent: 5, acConnected: false } })
    .active.some((alert) => alert.key === 'battery' && alert.severity === 'critical'),
  'Leerer Akku ohne Netzteil ohne kritische Warnung',
)

// ─── 8a. Einstellbare Schwellen und Warnprotokoll ──────────────────────────────────
const strict = new AlertEngine(sanitizeThresholds({ ...DEFAULT_ALERT_THRESHOLDS, memoryPercent: 10 }))
const busyRam = (at: number): HardwareReading => ({
  ...snapshot,
  capturedAt: at,
  memory: { ...snapshot.memory, usedBytes: snapshot.memory.totalBytes * 0.3 },
})
strict.update(busyRam(t0))
check(strict.update(busyRam(t0 + 61_000)).fired.some((alert) => alert.key === 'memory'), 'Schwelle 10 % RAM löst nicht aus')
strict.setThresholds(DEFAULT_ALERT_THRESHOLDS)
check(strict.update(busyRam(t0 + 62_000)).active.length === 0, 'Zurückgesetzte Schwelle hält die Warnung fest')

const sanitized = sanitizeThresholds({ cpuTempC: 500, memoryPercent: 'viel', batteryPercent: 12.6 })
check(sanitized.cpuTempC === 110, `CPU-Schwelle nicht begrenzt: ${sanitized.cpuTempC}`)
check(sanitized.memoryPercent === DEFAULT_ALERT_THRESHOLDS.memoryPercent, 'Ungültige Schwelle nicht auf Standard')
check(sanitized.batteryPercent === 13, `Schwelle nicht gerundet: ${sanitized.batteryPercent}`)
check(sanitizeThresholds(null).gpuTempC === DEFAULT_ALERT_THRESHOLDS.gpuTempC, 'Fehlende Schwellen nicht auf Standard')

const now = Date.now()
const log = trimAlertLog(
  [
    { t: now - 8 * DAY_MS, key: 'memory', title: 'alt', message: '', severity: 'warning' },
    { t: now - 60_000, key: 'battery', title: 'neu', message: '', severity: 'critical' },
    { t: now - 120_000, key: 'gpu-temp', title: 'mitte', message: '', severity: 'warning' },
  ],
  now,
)
check(log.map((entry) => entry.title).join() === 'mitte,neu', `Warnprotokoll: ${log.map((entry) => entry.title).join()}`)
check(isLoggedAlert(log[0]) && !isLoggedAlert({ t: 1, key: 'memory', severity: 'egal' }), 'Formprüfung Warnprotokoll falsch')

const csv = historyToCsv(week.slice(-3))
const csvLines = csv.replace(/^\uFEFF/, '').trim().split('\r\n')
check(csv.startsWith('\uFEFF'), 'CSV ohne BOM — Excel zeigt die Umlaute falsch')
check(csvLines.length === 4 && csvLines[0].startsWith('Zeit;CPU Ø %'), `CSV-Kopf/Zeilen: ${csvLines.length}`)
check(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2};\d+,\d;/.test(csvLines[1]), `CSV-Zeile im falschen Format: ${csvLines[1]}`)

// ─── 8b. Prozesse beenden: Sperrliste ───────────────────────────────────────────────
check(refusalReason('csrss.exe', [712], [1]) !== null, 'csrss.exe darf beendet werden')
check(refusalReason('SVCHOST.EXE', [900], [1]) !== null, 'svchost unabhängig von Groß-/Kleinschreibung nicht gesperrt')
check(refusalReason('chrome.exe', [4, 12], [1]) !== null, 'PID 4 (System) nicht abgelehnt')
check(refusalReason('electron.exe', [321], [321]) !== null, 'HardwareFlow würde sich selbst beenden')
check(refusalReason('chrome.exe', [10_001, 10_002], [1]) === null, 'Gewöhnlicher Prozess abgelehnt')

// ─── 8c. Tray-Symbol ────────────────────────────────────────────────────────────────
const icon = renderTrayIcon(100, 0)
check(icon.length === TRAY_ICON_SIZE * TRAY_ICON_SIZE * 4, `Tray-Raster hat ${icon.length} Bytes`)
const pixel = (x: number, y: number) => {
  const offset = (y * TRAY_ICON_SIZE + x) * 4
  // BGRA → #rrggbb
  return `#${[icon[offset + 2], icon[offset + 1], icon[offset]].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
check(pixel(8, 6) === '#d03b3b', `Volle CPU oben nicht kritisch-rot: ${pixel(8, 6)}`)
check(pixel(20, 6) === '#2b303b', `Leerer RAM-Balken oben nicht leer: ${pixel(20, 6)}`)
check(pixel(20, TRAY_ICON_SIZE - 6) === '#0ca30c', `RAM-Balken unten ohne Mindestfüllung: ${pixel(20, TRAY_ICON_SIZE - 6)}`)
check(icon[3] === 0, 'Tray-Ecke nicht transparent')

// ─── 9. Formatierung ─────────────────────────────────────────────────────────────────
const deviceCases: Array<[string, string, string]> = [
  ['NVIDIA', 'NVIDIA GeForce RTX 4070 Laptop GPU', 'NVIDIA GeForce RTX 4070 Laptop GPU'],
  ['Intel', 'Intel(R) Arc(TM) Graphics', 'Intel Arc Graphics'],
  ['Intel', 'Core™ Ultra 7 155H', 'Intel Core Ultra 7 155H'],
  ['AMD', 'Ryzen 9 7950X3D', 'AMD Ryzen 9 7950X3D'],
  ['', 'Unbekannter Grafikadapter', 'Unbekannter Grafikadapter'],
]
for (const [vendor, model, expected] of deviceCases) {
  const actual = describeDevice(vendor, model)
  check(actual === expected, `describeDevice(${vendor}, ${model}) → "${actual}" statt "${expected}"`)
}
const formatCases: Array<[string, string]> = [
  [formatBytes(64 * GIB, 0), '64 GB'],
  [formatBytes(0), '0 B'],
  [formatThroughput(null), '—'],
  [formatUptime(4 * 86400 + 7 * 3600 + 22 * 60), '4 d 7 h 22 m'],
  [formatBitrate(125_000), '1.0 Mbit/s'],
  [formatBitrate(null), '—'],
  [formatBitrate(250_000_000), '2.00 Gbit/s'],
  [formatLinkSpeed(2500), '2.5 Gbit/s'],
  [formatLinkSpeed(841), '841 Mbit/s'],
  [formatMinutes(125), '2 h 05 min'],
]
for (const [actual, expected] of formatCases) {
  check(actual === expected, `Formatierung: "${actual}" statt "${expected}"`)
}

// ─── 10. Rendering: jede Karte mit Simulation und mit der echten Maschine ─────────
const headroom = computeHeadroom(snapshot.history)
const markup = renderToString(
  <>
    <Navigation
      items={[
        { key: 'overview', label: 'Übersicht', icon: PAGE_ICONS.overview, hint: '99', alertCount: 1 },
        { key: 'network', label: 'Netzwerk', icon: PAGE_ICONS.network },
        { key: 'processes', label: 'Prozesse', icon: PAGE_ICONS.processes },
        { key: 'history', label: 'Verlauf', icon: PAGE_ICONS.history },
        { key: 'settings', label: 'Einstellungen', icon: PAGE_ICONS.settings },
      ]}
      active="overview"
      onSelect={() => {}}
      onOpenMini={null}
    />
    <DashboardHeader
      title="Übersicht"
      system={snapshot.system}
      headroom={headroom}
      source={snapshot.source}
      paused={false}
      onTogglePaused={() => {}}
    />
    <AlertBanner alerts={new AlertEngine().update(fullDrive).active} />
    <PerformanceMeter score={score} />
    <CpuCard
      cpu={snapshot.cpu}
      load={snapshot.cpuLoad}
      history={snapshot.history}
      fans={snapshot.fans}
      sensorProvider={snapshot.sensorProvider}
    />
    <MemoryCard memory={snapshot.memory} history={snapshot.history} />
    <GpuCard gpus={snapshot.gpus} />
    <StorageCard drives={snapshot.drives} physicalDisks={snapshot.physicalDisks} />
    <NetworkCard network={snapshot.network} history={snapshot.history} />
    <ProcessesCard processes={snapshot.processes} />
    <HistoryCard buckets={week} alerts={mockAlertLog(Date.now())} />
    <SettingsCard settings={null} onUpdate={() => {}} onOpenMini={null} />
    <SettingsCard
      settings={{
        autostart: false,
        autostartAvailable: false,
        notifications: true,
        closeToTray: true,
        thresholds: DEFAULT_ALERT_THRESHOLDS,
        version: '0.2.0',
      }}
      onUpdate={() => {}}
      onOpenMini={() => {}}
    />
  </>,
)
for (const expected of [
  'HardwareFlow',
  'Simulation',
  'ATLAS-WS01',
  'LibreHardwareMonitor',
  'U/min',
  'Ryzen 9 7950X3D',
  'GeForce RTX 4080 SUPER',
  'Weitere Adapter',
  'Netzlaufwerke',
  'Übersicht',
  'Warnung',
  'HardwareFlow Score',
  'Oberklasse',
  'Reserve',
  'Nur in der Desktop-App',
  'Warnschwellen',
  '0.2.0',
  'Warnungen im Zeitraum',
  'Arbeitsspeicher voll',
  'CSV',
  'Nur in der installierten App',
  'Netzwerk',
  'Prozesse',
  'chrome',
  'Verlauf',
  'voll in etwa',
  'Systemlaufwerk C: fast voll',
]) {
  check(markup.includes(expected), `Markup enthält "${expected}" nicht`)
}
for (const doubled of ['NVIDIA NVIDIA', 'Intel Intel', 'AMD AMD']) {
  check(!markup.includes(doubled), `Markup enthält den Hersteller doppelt: "${doubled}"`)
}
check(!markup.includes('(TM)') && !markup.includes('(R)'), 'Markup enthält (TM)/(R)-Marken')
check(markup.includes('nicht in der Summe'), 'Netzlaufwerke nicht als außerhalb der Summe gekennzeichnet')

const realSnapshot: HardwareSnapshot = { ...real, history: [toSample(real)] }
const realMarkup = renderToString(
  <>
    <PerformanceMeter score={realScore} />
    <CpuCard cpu={real.cpu} load={real.cpuLoad} history={realSnapshot.history} fans={real.fans} sensorProvider={real.sensorProvider} />
    <GpuCard gpus={real.gpus} />
    <StorageCard drives={withCountersReading.drives} physicalDisks={withCountersReading.physicalDisks} />
    <StorageCard drives={real.drives} physicalDisks={real.physicalDisks} />
    <NetworkCard network={real.network} history={realSnapshot.history} />
    <ProcessesCard processes={real.processes} />
    {real.battery && <BatteryCard battery={real.battery} />}
    <HistoryCard buckets={[]} />
  </>,
)
for (const expected of [
  'Core Ultra 7 155H',
  'RTX 4070 Laptop',
  'Leistungsstark',
  'Wi-Fi 7',
  'VPN/virtuell',
  'Akku',
  'Deutlich gealtert',
  'Netzlaufwerke',
  'Durchsatz erscheint',
  'mit laufendem LibreHardwareMonitor verfügbar',
  'MB/s',
  'Der Verlauf füllt sich',
]) {
  check(realMarkup.includes(expected), `Markup der echten Maschine enthält "${expected}" nicht`)
}

// Die Karten müssen auch rendern, wenn das System nichts herausgibt.
const blindMarkup = renderToString(
  <>
    <GpuCard gpus={[]} />
    <MemoryCard memory={blind.memory} history={blind.history} />
    <CpuCard cpu={blind.cpu} load={{ ...blind.cpuLoad, perCore: [] }} history={blind.history} />
    <StorageCard drives={blind.drives} physicalDisks={[]} />
    <NetworkCard network={blind.network} history={blind.history} />
    <ProcessesCard processes={null} />
    <PerformanceMeter score={blindScore} />
  </>,
)
check(blindMarkup.includes('Keine GPU erkannt'), 'GPU-Fallback fehlt')
check(blindMarkup.includes('n/v'), 'n/v-Marker für fehlende Werte fehlt')
check(blindMarkup.includes('geschätzt'), 'Geschätzte Score-Teile nicht gekennzeichnet')
check(blindMarkup.includes('Keine Verbindung'), 'Netzwerk-Fallback fehlt')

if (failures.length > 0) {
  console.error(`✗ ${failures.length} von ${checks} Prüfung(en) fehlgeschlagen:`)
  for (const failure of failures.slice(0, 40)) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(
  `✓ Smoke-Test bestanden · ${checks} Prüfungen · Score Mock ${score.total}/100 (${score.grade}) · echte Maschine ${realScore.total}/100 (${realScore.grade}) · Blind ${blindScore.total}/100 · Reserve ${Math.round(headroom.percent)} %`,
)
