import { renderToString } from 'react-dom/server'

import { CpuCard } from '../src/components/CpuCard'
import { DashboardHeader } from '../src/components/DashboardHeader'
import { GpuCard } from '../src/components/GpuCard'
import { MemoryCard } from '../src/components/MemoryCard'
import { PerformanceMeter } from '../src/components/PerformanceMeter'
import { StorageCard } from '../src/components/StorageCard'
import { describeDevice, formatBytes, formatThroughput, formatUptime } from '../src/lib/format'
import {
  activeSource,
  computePerformanceScore,
  getMockSnapshot,
  HISTORY_LENGTH,
  subscribeHardware,
} from '../src/services/hardwareService'
import { MockHardwareSource } from '../src/services/mockHardware'
import type { HardwareReading, HardwareSnapshot } from '../src/types/hardware'

const GIB = 1024 ** 3

const failures: string[] = []

function check(condition: boolean, message: string) {
  if (!condition) failures.push(message)
}

/** Jede Simulation muss über die gesamte Laufzeit plausible Werte liefern. */
function checkReading(reading: HardwareReading, tick: number) {
  const { cpu, cpuLoad, memory, gpus, drives, physicalDisks } = reading

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

  check(
    memory.usedBytes + memory.freeBytes === memory.totalBytes,
    `Tick ${tick}: belegt + frei ≠ gesamt`,
  )
  check(
    (memory.cachedBytes ?? 0) <= memory.usedBytes,
    `Tick ${tick}: Cache größer als der belegte Speicher`,
  )
  check(
    memory.swapUsedBytes <= memory.swapTotalBytes,
    `Tick ${tick}: Auslagerungsdatei über ihrer Größe`,
  )

  check(gpus.length > 0, `Tick ${tick}: keine GPU im Mock-Reading`)
  for (const gpu of gpus) {
    if (gpu.vramTotalBytes !== null && gpu.vramUsedBytes !== null) {
      check(
        gpu.vramUsedBytes <= gpu.vramTotalBytes,
        `Tick ${tick}: ${gpu.model} meldet mehr VRAM belegt als vorhanden`,
      )
    }
  }

  for (const drive of drives) {
    check(
      drive.freeBytes >= 0 && drive.freeBytes <= drive.totalBytes,
      `Tick ${tick}: ${drive.mountPoint} hat unplausible freie Kapazität`,
    )
    check(
      (drive.readMbPerSec ?? 0) >= 0 && (drive.writeMbPerSec ?? 0) >= 0,
      `Tick ${tick}: ${drive.mountPoint} meldet negativen Durchsatz`,
    )
  }

  check(physicalDisks.length > 0, `Tick ${tick}: keine Datenträger im Mock-Reading`)
}

function checkScore(snapshot: HardwareSnapshot, tick: number) {
  const score = computePerformanceScore(snapshot)
  check(
    score.total >= 0 && score.total <= 100,
    `Tick ${tick}: Score außerhalb 0–100 (${score.total})`,
  )
  check(score.components.length === 5, `Tick ${tick}: ${score.components.length} Score-Bausteine`)
  check(
    Math.abs(score.components.reduce((sum, part) => sum + part.weight, 0) - 1) < 1e-9,
    `Tick ${tick}: Score-Gewichte summieren nicht auf 1`,
  )
  check(
    score.components.every((part) => part.score >= 0 && part.score <= 100),
    `Tick ${tick}: Teil-Score außerhalb 0–100`,
  )
}

// 1. Simulation: 300 Ticks entsprechen 5 Minuten Laufzeit.
const source = new MockHardwareSource()
for (let tick = 0; tick < 300; tick += 1) {
  checkReading(source.next(), tick)
}

// 2. Die Facade liefert ein gefülltes Fenster und einen plausiblen Score.
const snapshot = getMockSnapshot()
check(
  snapshot.history.length === HISTORY_LENGTH,
  `Verlauf hat ${snapshot.history.length} statt ${HISTORY_LENGTH} Punkte`,
)
check(
  snapshot.history.every(
    (sample, index) => index === 0 || sample.timestamp >= snapshot.history[index - 1].timestamp,
  ),
  'Verlauf ist nicht chronologisch',
)
checkScore(snapshot, -1)

// Ohne Electron-Bridge muss die Facade den Simulator wählen.
check(activeSource() === 'mock', `activeSource() → "${activeSource()}" statt "mock"`)

const reference = computePerformanceScore(snapshot)
check(
  reference.total >= 60,
  `Referenz-Score unerwartet niedrig: ${reference.total} (${reference.grade})`,
)

// 2a. Ein Netzlaufwerk darf den Score nicht bewegen. Windows blendet gemappte Freigaben
// neben echten Volumes ein; zählte eine mit, würde der Füllstand eines Fileservers die
// Speicher-Reserve dieser Maschine bestimmen.
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
const shareScore = computePerformanceScore(withHugeShare)
check(
  shareScore.total === reference.total,
  `Ein volles Netzlaufwerk verändert den Score: ${reference.total} → ${shareScore.total}`,
)
check(
  shareScore.components.find((part) => part.key === 'storage')?.detail ===
    reference.components.find((part) => part.key === 'storage')?.detail,
  'Ein Netzlaufwerk verändert die Detailzeile der Speicher-Reserve',
)

// 2b. Der Verlauf muss eine Pause überleben: subscribeHardware bekommt das bisherige
// Fenster hereingereicht und darf nicht bei einer leeren Achse neu anfangen.
const carried = snapshot.history.slice(-12)
let resumed: HardwareSnapshot | null = null
const unsubscribe = subscribeHardware((next) => {
  resumed ??= next
}, { initialHistory: carried })
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

// 3. Der Score darf auch mit lauter nicht auslesbaren Werten nicht kippen.
const blind: HardwareSnapshot = {
  ...snapshot,
  cpuLoad: { ...snapshot.cpuLoad, currentClockGhz: null, temperatureC: null, processCount: null },
  memory: { ...snapshot.memory, cachedBytes: null, type: null, speedMhz: null, slotsUsed: null, slotsTotal: null },
  gpus: [{ ...snapshot.gpus[0], vramTotalBytes: null, vramUsedBytes: null, usagePercent: null, temperatureC: null, coreClockMhz: null, powerDrawWatts: null, driverVersion: null }],
  drives: snapshot.drives.map((drive) => ({ ...drive, kind: null, label: null, readMbPerSec: null, writeMbPerSec: null })),
  physicalDisks: [],
}
checkScore(blind, -2)

// 4. Formatierung.
// Geräte-Namen: gemessen auf echter Hardware melden NVIDIA und Intel ihren Namen
// bereits im Modell, der CPU-Hersteller dagegen nicht.
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

check(formatBytes(64 * GIB, 0) === '64 GB', `formatBytes(64 GiB) → ${formatBytes(64 * GIB, 0)}`)
check(formatBytes(0) === '0 B', `formatBytes(0) → ${formatBytes(0)}`)
check(formatThroughput(null) === '—', `formatThroughput(null) → ${formatThroughput(null)}`)
check(
  formatUptime(4 * 86400 + 7 * 3600 + 22 * 60) === '4 d 7 h 22 m',
  `formatUptime → ${formatUptime(4 * 86400 + 7 * 3600 + 22 * 60)}`,
)

// 5. Rendering: jede Karte muss mit echten Daten durchlaufen.
const score = computePerformanceScore(snapshot)
const markup = renderToString(
  <>
    <DashboardHeader
      system={snapshot.system}
      score={score}
      source={snapshot.source}
      paused={false}
      onTogglePaused={() => {}}
    />
    <PerformanceMeter score={score} />
    <CpuCard cpu={snapshot.cpu} load={snapshot.cpuLoad} history={snapshot.history} />
    <MemoryCard memory={snapshot.memory} history={snapshot.history} />
    <GpuCard gpus={snapshot.gpus} />
    <StorageCard drives={snapshot.drives} physicalDisks={snapshot.physicalDisks} />
  </>,
)

for (const expected of [
  'HardwareFlow',
  'Simulation',
  'ATLAS-WS01',
  'Windows 11 Pro',
  'Prozessor',
  'Ryzen 9 7950X3D',
  'Arbeitsspeicher',
  'Grafik',
  'GeForce RTX 4080 SUPER',
  'Weitere Adapter',
  'Massenspeicher',
  'Datenträger',
  'NVMe',
  'HardwareFlow Score',
  // Die Freigabe steht unter „Netzlaufwerke“ und nicht bei den lokalen Volumes …
  'Netzlaufwerke',
  'nicht im Score',
  'Team',
]) {
  check(markup.includes(expected), `Markup enthält "${expected}" nicht`)
}

// Der Herstellername darf nirgends doppelt stehen.
for (const doubled of ['NVIDIA NVIDIA', 'Intel Intel', 'AMD AMD']) {
  check(!markup.includes(doubled), `Markup enthält den Hersteller doppelt: "${doubled}"`)
}
check(!markup.includes('(TM)') && !markup.includes('(R)'), 'Markup enthält (TM)/(R)-Marken')

// … und die Kopfzeile zählt nur die lokalen Volumes, nicht die Freigabe.
const localVolumes = snapshot.drives.filter((drive) => !drive.remote).length
check(
  markup.includes(`${localVolumes} Volumes`),
  `Kopfzeile zählt nicht ${localVolumes} lokale Volumes (${snapshot.drives.length} insgesamt)`,
)

// 6. Die Karten müssen auch rendern, wenn das System nichts herausgibt.
const blindMarkup = renderToString(
  <>
    <GpuCard gpus={[]} />
    <MemoryCard memory={blind.memory} history={blind.history} />
    <CpuCard cpu={blind.cpu} load={{ ...blind.cpuLoad, perCore: [] }} history={blind.history} />
    <StorageCard drives={blind.drives} physicalDisks={[]} />
  </>,
)
check(blindMarkup.includes('Keine GPU erkannt'), 'GPU-Fallback fehlt')
check(blindMarkup.includes('n/v'), 'n/v-Marker für fehlende Werte fehlt')

if (failures.length > 0) {
  console.error(`✗ ${failures.length} Prüfung(en) fehlgeschlagen:`)
  for (const failure of failures.slice(0, 20)) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(
  `✓ Smoke-Test bestanden · Referenz-Score ${reference.total}/100 (${reference.grade}) · Blind-Score ${computePerformanceScore(blind).total}/100 · ${markup.length} Zeichen Markup`,
)
