import {
  describeDevice,
  formatBitrate,
  formatBytes,
  formatClockTime,
  formatLinkSpeed,
  formatMinutes,
  formatPercent,
  formatPoints,
  formatThroughput,
  formatUptime,
} from './format'
import { HUES } from './palette'
import { capacityStatus, GRADE_META, loadColor, STATUS_COLORS } from './status'
import type {
  HardwareAlert,
  HardwareScore,
  HardwareSnapshot,
  Headroom,
  HistoryBucket,
  LoggedAlert,
} from '../types/hardware'

/**
 * Builds the printable hardware report as one self-contained HTML document.
 *
 * Three decisions shape this file:
 *
 * 1. **Paper, not screen.** The dashboard is a dark UI; a report is read on white and
 *    often printed, so this document carries its own light palette. The subsystem hues
 *    from `palette.ts` stay — they are what makes a section recognisable — but the
 *    surfaces, ink and hairlines are re-tuned for paper.
 * 2. **No dependencies.** Everything ships inline: CSS, the score ring, the history
 *    chart, every bar. The renderer hands the string to the main process, which prints
 *    it in a throwaway window — nothing there can resolve a bundle or a font server.
 * 3. **Nulls stay nulls.** The same rule as the domain model: a sensor the OS refuses
 *    to report prints an em dash, never a zero.
 */

/** Report palette — light surfaces, dark ink. The series hues come from `HUES`. */
const PAPER = {
  ink: '#101419',
  ink2: '#39414f',
  muted: '#6f7889',
  hairline: '#e3e7ed',
  tint: '#f6f8fa',
  band: '#0f1218',
} as const

/** Sections, in print order, each with its identity hue. */
const SECTION_HUES = {
  system: HUES.neutral,
  score: HUES.cpu,
  cpu: HUES.cpu,
  memory: HUES.memory,
  gpu: HUES.gpu,
  storage: HUES.storage,
  network: HUES.network,
  battery: HUES.battery,
  processes: HUES.neutral,
  history: HUES.cpu,
} as const

export interface ReportInput {
  snapshot: HardwareSnapshot
  score: HardwareScore
  headroom: Headroom
  /** Alerts currently standing — printed as a box right under the title. */
  alerts: HardwareAlert[]
  /** Stored per-minute history; `null` in the browser build. */
  buckets: HistoryBucket[] | null
  alertLog: LoggedAlert[]
}

// ── primitives ────────────────────────────────────────────────────────────────

const EM_DASH = '—'

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A value that may be absent — `null` prints as an em dash, in muted ink. */
function opt(value: string | number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined || value === '') return `<span class="na">${EM_DASH}</span>`
  return `${esc(String(value))}${suffix}`
}

const yesNo = (value: boolean | null) => (value === null ? null : value ? 'ja' : 'nein')

/** `20.09.2026, 14:32` — the stamp under the title and in the alert log. */
function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** One definition-list entry. Long values may wrap; the label never does. */
function field(label: string, value: string): string {
  return `<div class="field"><dt>${esc(label)}</dt><dd>${value}</dd></div>`
}

function fields(entries: Array<[string, string]>): string {
  return `<dl class="fields">${entries.map(([label, value]) => field(label, value)).join('')}</dl>`
}

/**
 * A filled bar. Used for load, capacity and score alike, so one visual language carries
 * every proportion in the report; the number is always printed beside it.
 */
function bar(percent: number, color: string, width = 100): string {
  const filled = Math.max(0, Math.min(100, percent))
  return `<span class="bar" style="width:${width}px"><span class="bar-fill" style="width:${filled.toFixed(1)}%;background:${color}"></span></span>`
}

/** Bar plus its reading, as one table cell or inline run. */
function barWithValue(percent: number, color: string, label = formatPercent(percent)): string {
  return `<span class="bar-row">${bar(percent, color)}<span class="bar-value">${esc(label)}</span></span>`
}

interface TableSpec {
  head: string[]
  rows: string[][]
  /** Columns that hold numbers — right-aligned and tabular. */
  numeric?: number[]
  empty?: string
}

function table({ head, rows, numeric = [], empty = 'Keine Daten.' }: TableSpec): string {
  if (rows.length === 0) return `<p class="empty">${esc(empty)}</p>`

  const cls = (index: number) => (numeric.includes(index) ? ' class="num"' : '')
  const header = head.map((cell, index) => `<th${cls(index)}>${esc(cell)}</th>`).join('')
  const body = rows
    .map((row) => `<tr>${row.map((cell, index) => `<td${cls(index)}>${cell}</td>`).join('')}</tr>`)
    .join('')

  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`
}

function section(key: keyof typeof SECTION_HUES, title: string, body: string, note?: string): string {
  const hue = SECTION_HUES[key]
  return `<section class="section" style="--hue:${hue}">
    <h2><span class="dot"></span>${esc(title)}${note ? `<span class="note">${esc(note)}</span>` : ''}</h2>
    ${body}
  </section>`
}

// ── header ────────────────────────────────────────────────────────────────────

/** The score as a ring — the one figure the report leads with. */
function scoreRing(score: HardwareScore): string {
  const meta = GRADE_META[score.grade]
  const size = 96
  const stroke = 9
  const radius = size / 2 - stroke / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - score.total / 100)

  return `<div class="ring">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <g transform="rotate(-90 ${size / 2} ${size / 2})">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="#ffffff2e" stroke-width="${stroke}" />
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${meta.color}"
          stroke-width="${stroke}" stroke-linecap="round"
          stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" />
      </g>
      <text x="${size / 2}" y="${size / 2 + 2}" text-anchor="middle" dominant-baseline="middle"
        fill="#ffffff" font-size="26" font-weight="700">${score.total}</text>
      <text x="${size / 2}" y="${size / 2 + 20}" text-anchor="middle" dominant-baseline="middle"
        fill="#ffffffb3" font-size="9" font-weight="600" letter-spacing="0.5">VON 100</text>
    </svg>
    <p class="ring-grade" style="color:${meta.color}">${esc(meta.label)}</p>
  </div>`
}

function titleBlock({ snapshot, score, headroom }: ReportInput): string {
  const { system } = snapshot
  const live = snapshot.source === 'native'

  return `<header class="title">
    <div class="title-main">
      <p class="brand">HardwareFlow</p>
      <h1>Hardware-Report</h1>
      <p class="subject">${esc(system.hostname)} · ${esc(system.osName)} ${esc(system.osVersion)} · ${esc(system.architecture)}</p>
      <p class="stamp">
        Erstellt am ${esc(formatDateTime(snapshot.capturedAt))} Uhr
        <span class="pill" style="--pill:${live ? STATUS_COLORS.good : STATUS_COLORS.warning}">
          ${live ? 'Live-Messung' : 'Simulierte Werte'}
        </span>
      </p>
      <div class="title-stats">
        <div><span>Reserve</span><strong>${Math.round(headroom.percent)} % frei</strong></div>
        <div><span>Laufzeit</span><strong>${esc(formatUptime(system.uptimeSeconds))}</strong></div>
        <div><span>Einstufung</span><strong>${esc(GRADE_META[score.grade].label)}</strong></div>
      </div>
    </div>
    ${scoreRing(score)}
  </header>`
}

function alertBox(alerts: HardwareAlert[]): string {
  if (alerts.length === 0) {
    return `<p class="banner ok">Keine aktiven Warnungen — alle überwachten Werte liegen im grünen Bereich.</p>`
  }

  const items = alerts
    .map((alert) => {
      const color = alert.severity === 'critical' ? STATUS_COLORS.critical : STATUS_COLORS.warning
      return `<li style="--sev:${color}"><strong>${esc(alert.title)}</strong> ${esc(alert.message)}</li>`
    })
    .join('')

  return `<div class="banner warn">
    <p class="banner-head">${alerts.length === 1 ? 'Eine aktive Warnung' : `${alerts.length} aktive Warnungen`}</p>
    <ul>${items}</ul>
  </div>`
}

// ── sections ──────────────────────────────────────────────────────────────────

function systemSection({ snapshot }: ReportInput): string {
  const { system } = snapshot
  return section(
    'system',
    'System',
    fields([
      ['Hostname', opt(system.hostname)],
      ['Betriebssystem', `${opt(system.osName)} ${opt(system.osVersion)}`],
      ['Kernel', opt(system.kernel)],
      ['Architektur', opt(system.architecture)],
      ['Laufzeit seit Start', opt(formatUptime(system.uptimeSeconds))],
      ['Messquelle', snapshot.source === 'native' ? 'Systemmessung (live)' : 'Simulator (Browser-Modus)'],
      ['Sensor-Anbieter', opt(snapshot.sensorProvider)],
      ['Prozesse gesamt', opt(snapshot.processes?.count ?? null)],
    ]),
  )
}

function scoreSection({ score }: ReportInput): string {
  const meta = GRADE_META[score.grade]

  const rows = score.components.map((component) => [
    esc(component.label),
    barWithValue(component.score, HUES[component.key === 'extras' ? 'neutral' : component.key], `${Math.round(component.score)}`),
    `${Math.round(component.weight * 100)} %`,
    `${esc(component.detail)}${component.estimated ? ' <span class="na">(geschätzt)</span>' : ''}`,
  ])

  const badges = score.badges.length
    ? `<div class="chips">${score.badges
        .map((badge) => `<span class="chip">${esc(badge.label)}<em>+${badge.points}</em></span>`)
        .join('')}</div>`
    : `<p class="empty">Keine zusätzlichen Merkmale erkannt.</p>`

  return section(
    'score',
    'HardwareFlow-Score',
    `<p class="lede" style="color:${meta.color}"><strong>${score.total} / 100 · ${esc(meta.label)}</strong> ${esc(meta.summary)}</p>
     ${table({
       head: ['Komponente', 'Teilwertung', 'Gewicht', 'Grundlage'],
       rows,
       numeric: [2],
     })}
     <p class="sub-head">Zusatzmerkmale</p>
     ${badges}`,
    'bewertet die Ausstattung, nicht die aktuelle Last',
  )
}

function cpuSection({ snapshot }: ReportInput): string {
  const { cpu, cpuLoad, fans } = snapshot

  const cores = cpuLoad.perCore.length
    ? `<p class="sub-head">Auslastung je Kern</p>
       <div class="cores">${cpuLoad.perCore
         .map(
           (value, index) =>
             `<div class="core"><span class="core-id">${index}</span>${bar(value, loadColor(value), 46)}<span class="core-value">${Math.round(value)}</span></div>`,
         )
         .join('')}</div>`
    : ''

  const entries: Array<[string, string]> = [
    ['Modell', opt(describeDevice(cpu.vendor, cpu.model))],
    ['Kerne / Threads', `${cpu.cores} / ${cpu.threads}`],
    ['Basistakt', `${cpu.baseClockGhz.toFixed(2)} GHz`],
    ['Maximaltakt', `${cpu.maxClockGhz.toFixed(2)} GHz`],
    ['Aktueller Takt', cpuLoad.currentClockGhz === null ? opt(null) : `${cpuLoad.currentClockGhz.toFixed(2)} GHz`],
    ['L3-Cache', cpu.cacheL3Mb === null ? opt(null) : `${cpu.cacheL3Mb} MB`],
    ['Auslastung', barWithValue(cpuLoad.usagePercent, loadColor(cpuLoad.usagePercent))],
    ['Temperatur', cpuLoad.temperatureC === null ? opt(null) : `${Math.round(cpuLoad.temperatureC)} °C`],
    ['Leistungsaufnahme', cpuLoad.powerWatts === null ? opt(null) : `${Math.round(cpuLoad.powerWatts)} W`],
  ]

  if (fans.length) {
    entries.push(['Lüfter', esc(fans.map((fan) => `${fan.name}: ${Math.round(fan.rpm)} rpm`).join(' · '))])
  }

  return section(
    'cpu',
    'Prozessor',
    `${fields(entries)}
     ${cores}`,
    snapshot.sensorProvider ? undefined : 'Temperatur, Leistung und Lüfter benötigen einen Sensor-Dienst',
  )
}

function memorySection({ snapshot }: ReportInput): string {
  const { memory } = snapshot
  const usedPercent = memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0
  const swapPercent = memory.swapTotalBytes > 0 ? (memory.swapUsedBytes / memory.swapTotalBytes) * 100 : 0

  return section(
    'memory',
    'Arbeitsspeicher',
    fields([
      ['Gesamt', formatBytes(memory.totalBytes)],
      ['Belegt', `${formatBytes(memory.usedBytes)} ${barWithValue(usedPercent, loadColor(usedPercent))}`],
      ['Frei', formatBytes(memory.freeBytes)],
      ['Zwischenspeicher', memory.cachedBytes === null ? opt(null) : formatBytes(memory.cachedBytes)],
      ['Typ', opt(memory.type)],
      ['Takt', memory.speedMhz === null ? opt(null) : `${memory.speedMhz} MHz`],
      [
        'Bestückung',
        memory.slotsTotal === null ? opt(null) : `${opt(memory.slotsUsed)} von ${memory.slotsTotal} Steckplätzen belegt`,
      ],
      ['ECC', opt(yesNo(memory.ecc))],
      [
        'Auslagerung',
        memory.swapTotalBytes > 0
          ? `${formatBytes(memory.swapUsedBytes)} von ${formatBytes(memory.swapTotalBytes)} ${barWithValue(swapPercent, loadColor(swapPercent))}`
          : opt(null),
      ],
    ]),
  )
}

function gpuSection({ snapshot }: ReportInput): string {
  const rows = snapshot.gpus.map((gpu) => {
    const vram =
      gpu.vramTotalBytes === null
        ? opt(null)
        : gpu.vramUsedBytes === null
          ? formatBytes(gpu.vramTotalBytes)
          : `${formatBytes(gpu.vramUsedBytes)} / ${formatBytes(gpu.vramTotalBytes)}`

    return [
      `<strong>${esc(describeDevice(gpu.vendor, gpu.model))}</strong><br><span class="na">${gpu.integrated ? 'integriert' : 'dediziert'} · Treiber ${gpu.driverVersion ?? EM_DASH}</span>`,
      vram,
      gpu.usagePercent === null ? opt(null) : barWithValue(gpu.usagePercent, loadColor(gpu.usagePercent)),
      gpu.coreClockMhz === null ? opt(null) : `${Math.round(gpu.coreClockMhz)} MHz`,
      gpu.temperatureC === null ? opt(null) : `${Math.round(gpu.temperatureC)} °C`,
      gpu.powerDrawWatts === null ? opt(null) : `${Math.round(gpu.powerDrawWatts)} W`,
    ]
  })

  return section(
    'gpu',
    'Grafik',
    table({
      head: ['Adapter', 'Grafikspeicher', 'Auslastung', 'Takt', 'Temperatur', 'Leistung'],
      rows,
      numeric: [3, 4, 5],
      empty: 'Keine Grafikeinheit erkannt.',
    }),
  )
}

function storageSection({ snapshot }: ReportInput): string {
  const disks = snapshot.physicalDisks.map((disk) => [
    `<strong>${esc(disk.name)}</strong>`,
    opt(disk.kind ? disk.kind.toUpperCase() : null),
    opt(disk.interfaceType),
    formatBytes(disk.sizeBytes),
    disk.temperatureC === null ? opt(null) : `${Math.round(disk.temperatureC)} °C`,
    opt(disk.smartStatus),
  ])

  const volumes = snapshot.drives.map((drive) => {
    const used = drive.totalBytes - drive.freeBytes
    const usedPercent = drive.totalBytes > 0 ? (used / drive.totalBytes) * 100 : 0
    const tags = [
      drive.system ? 'System' : null,
      drive.remote ? 'Netzwerk' : null,
      drive.removable ? 'Wechsel' : null,
    ].filter(Boolean) as string[]

    return [
      `<strong>${esc(drive.mountPoint)}</strong>${drive.label ? ` ${esc(drive.label)}` : ''}${
        tags.length ? `<br><span class="na">${esc(tags.join(' · '))}</span>` : ''
      }`,
      opt(drive.filesystem),
      formatBytes(drive.totalBytes),
      formatBytes(drive.freeBytes),
      barWithValue(usedPercent, STATUS_COLORS[capacityStatus(usedPercent)], `${Math.round(usedPercent)} % belegt`),
      `${formatThroughput(drive.readMbPerSec)} / ${formatThroughput(drive.writeMbPerSec)}`,
    ]
  })

  return section(
    'storage',
    'Massenspeicher',
    `<p class="sub-head">Physische Datenträger</p>
     ${table({
       head: ['Datenträger', 'Typ', 'Anbindung', 'Größe', 'Temperatur', 'SMART'],
       rows: disks,
       numeric: [3, 4],
       empty: 'Keine physischen Datenträger auslesbar.',
     })}
     <p class="sub-head">Laufwerke</p>
     ${table({
       head: ['Laufwerk', 'Dateisystem', 'Größe', 'Frei', 'Belegung', 'Lesen / Schreiben'],
       rows: volumes,
       numeric: [2, 3],
       empty: 'Keine Laufwerke gefunden.',
     })}`,
  )
}

function networkSection({ snapshot }: ReportInput): string {
  const { network } = snapshot
  const KIND_LABEL = { wired: 'LAN', wireless: 'WLAN', virtual: 'virtuell' } as const

  const rows = network.adapters.map((adapter) => [
    `<strong>${esc(adapter.name)}</strong>${adapter.isDefault ? ' <span class="tag">Standard</span>' : ''}<br><span class="na">${esc(adapter.adapter)}</span>`,
    KIND_LABEL[adapter.kind],
    opt(adapter.ipv4),
    formatLinkSpeed(adapter.linkMbps),
    formatBitrate(adapter.rxBytesPerSec),
    formatBitrate(adapter.txBytesPerSec),
  ])

  const wifi = network.wifi
    ? fields([
        ['Netz (SSID)', opt(network.wifi.ssid)],
        ['Signal', network.wifi.signalDbm === null ? opt(null) : `${network.wifi.signalDbm} dBm`],
        [
          'Qualität',
          network.wifi.quality === null ? opt(null) : barWithValue(network.wifi.quality, HUES.network),
        ],
        ['Frequenz', network.wifi.frequencyMhz === null ? opt(null) : `${network.wifi.frequencyMhz} MHz`],
        ['Standard', opt(network.wifi.standard)],
      ])
    : ''

  return section(
    'network',
    'Netzwerk',
    `${table({
      head: ['Verbindung', 'Art', 'IPv4', 'Verbindungstempo', 'Empfangen', 'Gesendet'],
      rows,
      numeric: [3, 4, 5],
      empty: 'Keine aktive Verbindung.',
    })}
     ${fields([
       ['Schnellster LAN-Anschluss', formatLinkSpeed(network.bestWiredMbps)],
       ['WLAN-Generation', opt(network.wifiGeneration)],
     ])}
     ${wifi ? `<p class="sub-head">Aktuelle WLAN-Verbindung</p>${wifi}` : ''}`,
  )
}

function batterySection(input: ReportInput): string {
  const battery = input.snapshot.battery
  if (!battery) return ''

  const health = battery.healthPercent
  const healthColor = health === null ? HUES.battery : health >= 80 ? STATUS_COLORS.good : health >= 60 ? STATUS_COLORS.warning : STATUS_COLORS.serious

  return section(
    'battery',
    'Akku',
    fields([
      ['Ladestand', barWithValue(battery.percent, HUES.battery, formatPercent(battery.percent))],
      [
        'Zustand',
        battery.charging ? 'wird geladen' : battery.acConnected ? 'am Netz' : 'Akkubetrieb',
      ],
      ['Restlaufzeit', battery.minutesRemaining === null ? opt(null) : formatMinutes(battery.minutesRemaining)],
      [
        'Gesundheit',
        health === null ? opt(null) : barWithValue(health, healthColor, formatPercent(health)),
      ],
      [
        'Kapazität',
        battery.fullChargeCapacityMwh === null || battery.designCapacityMwh === null
          ? opt(null)
          : `${formatPoints(battery.fullChargeCapacityMwh)} von ${formatPoints(battery.designCapacityMwh)} mWh ab Werk`,
      ],
      ['Ladezyklen', opt(battery.cycleCount)],
    ]),
  )
}

function processesSection({ snapshot }: ReportInput): string {
  const processes = snapshot.processes
  if (!processes) return ''

  const row = (group: { name: string; instances: number; cpuPercent: number; memoryBytes: number }) => [
    `<strong>${esc(group.name)}</strong>${group.instances > 1 ? `<span class="na"> ×${group.instances}</span>` : ''}`,
    barWithValue(group.cpuPercent, loadColor(group.cpuPercent), formatPercent(group.cpuPercent, 1)),
    formatBytes(group.memoryBytes),
  ]

  return section(
    'processes',
    'Programme mit der höchsten Last',
    `<div class="split">
      <div>
        <p class="sub-head">Nach Prozessorlast</p>
        ${table({ head: ['Programm', 'CPU', 'Speicher'], rows: processes.byCpu.slice(0, 8).map(row), numeric: [2] })}
      </div>
      <div>
        <p class="sub-head">Nach Arbeitsspeicher</p>
        ${table({ head: ['Programm', 'CPU', 'Speicher'], rows: processes.byMemory.slice(0, 8).map(row), numeric: [2] })}
      </div>
    </div>`,
    `${processes.count} Prozesse insgesamt`,
  )
}

// ── history ───────────────────────────────────────────────────────────────────

interface Series {
  label: string
  color: string
  points: Array<number | null>
}

/**
 * A line chart of the stored history, drawn as plain SVG.
 *
 * Recharts is not available here — the report is printed in a bare window — and a
 * printed chart needs none of it: no tooltips, no animation, one fixed size.
 */
function historyChart(buckets: HistoryBucket[], series: Series[]): string {
  const width = 660
  const height = 150
  const padLeft = 30
  const padRight = 8
  const padTop = 8
  const padBottom = 18
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom

  const x = (index: number) =>
    padLeft + (buckets.length <= 1 ? plotWidth / 2 : (index / (buckets.length - 1)) * plotWidth)
  const y = (value: number) => padTop + plotHeight * (1 - Math.max(0, Math.min(100, value)) / 100)

  const grid = [0, 25, 50, 75, 100]
    .map(
      (value) =>
        `<line x1="${padLeft}" y1="${y(value).toFixed(1)}" x2="${width - padRight}" y2="${y(value).toFixed(1)}" stroke="${PAPER.hairline}" stroke-width="1" />
         <text x="${padLeft - 6}" y="${(y(value) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="${PAPER.muted}">${value}</text>`,
    )
    .join('')

  // A gap in a series (a GPU that reported nothing for a while) breaks the line rather
  // than being bridged — a drawn line there would invent readings.
  const paths = series
    .map((line) => {
      let path = ''
      let open = false
      line.points.forEach((value, index) => {
        if (value === null || !Number.isFinite(value)) {
          open = false
          return
        }
        path += `${open ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)} `
        open = true
      })
      return path.trim()
        ? `<path d="${path.trim()}" fill="none" stroke="${line.color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />`
        : ''
    })
    .join('')

  const first = buckets[0]
  const last = buckets[buckets.length - 1]
  const axis = first && last
    ? `<text x="${padLeft}" y="${height - 4}" font-size="8" fill="${PAPER.muted}">${esc(formatDateTime(first.t))}</text>
       <text x="${width - padRight}" y="${height - 4}" text-anchor="end" font-size="8" fill="${PAPER.muted}">${esc(formatDateTime(last.t))}</text>`
    : ''

  const legend = series
    .map(
      (line) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${line.color}"></span>${esc(line.label)}</span>`,
    )
    .join('')

  return `<div class="chart">
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">${grid}${paths}${axis}</svg>
    <div class="legend">${legend}</div>
  </div>`
}

/** Min / average / max of a bucket field, ignoring the minutes that reported nothing. */
function summarize(values: Array<number | null>): { min: number; avg: number; max: number } | null {
  const numbers = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (numbers.length === 0) return null
  const sum = numbers.reduce((total, value) => total + value, 0)
  return { min: Math.min(...numbers), avg: sum / numbers.length, max: Math.max(...numbers) }
}

/** Evenly thins a series to at most `limit` points, keeping the last one. */
function thin<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items
  const step = items.length / limit
  const out: T[] = []
  for (let index = 0; index < limit; index += 1) out.push(items[Math.floor(index * step)])
  out[out.length - 1] = items[items.length - 1]
  return out
}

const REPORT_HISTORY_HOURS = 24

function historySection({ buckets, alertLog, snapshot }: ReportInput): string {
  const since = snapshot.capturedAt - REPORT_HISTORY_HOURS * 3600_000
  const window = (buckets ?? []).filter((bucket) => bucket.t >= since)

  if (window.length < 2) {
    return section(
      'history',
      'Verlauf',
      `<p class="empty">Noch zu wenig Verlauf aufgezeichnet — der Report zeigt hier die letzten ${REPORT_HISTORY_HOURS} Stunden, sobald sie vorliegen.</p>`,
    )
  }

  const plotted = thin(window, 240)
  const chart = historyChart(plotted, [
    { label: 'Prozessor', color: HUES.cpu, points: plotted.map((bucket) => bucket.cpuAvg) },
    { label: 'Arbeitsspeicher', color: HUES.memory, points: plotted.map((bucket) => bucket.memAvg) },
    { label: 'Grafik', color: HUES.gpu, points: plotted.map((bucket) => bucket.gpuAvg) },
  ])

  const stat = (label: string, values: Array<number | null>, unit: string, digits = 0) => {
    const summary = summarize(values)
    if (!summary) return [esc(label), opt(null), opt(null), opt(null)]
    return [
      esc(label),
      `${summary.min.toFixed(digits)} ${unit}`,
      `${summary.avg.toFixed(digits)} ${unit}`,
      `${summary.max.toFixed(digits)} ${unit}`,
    ]
  }

  const stats = [
    stat('Prozessorlast', window.map((bucket) => bucket.cpuAvg), '%'),
    stat('Arbeitsspeicher', window.map((bucket) => bucket.memAvg), '%'),
    stat('Grafiklast', window.map((bucket) => bucket.gpuAvg), '%'),
    stat('Prozessor-Temperatur', window.map((bucket) => bucket.cpuTempMax), '°C'),
    stat('Grafik-Temperatur', window.map((bucket) => bucket.gpuTempMax), '°C'),
  ]

  const recent = alertLog.filter((entry) => entry.t >= since).slice(-10).reverse()
  const alertRows = recent.map((entry) => [
    esc(formatDateTime(entry.t)),
    `<span class="tag" style="--tag:${entry.severity === 'critical' ? STATUS_COLORS.critical : STATUS_COLORS.warning}">${entry.severity === 'critical' ? 'kritisch' : 'Warnung'}</span>`,
    `<strong>${esc(entry.title)}</strong> ${esc(entry.message)}`,
  ])

  return section(
    'history',
    `Verlauf der letzten ${REPORT_HISTORY_HOURS} Stunden`,
    `${chart}
     ${table({ head: ['Messwert', 'Minimum', 'Mittel', 'Maximum'], rows: stats, numeric: [1, 2, 3] })}
     <p class="sub-head">Aufgezeichnete Warnungen</p>
     ${table({
       head: ['Zeitpunkt', 'Stufe', 'Meldung'],
       rows: alertRows,
       empty: 'In diesem Zeitraum wurde keine Warnung ausgelöst.',
     })}`,
    `${window.length} Minutenwerte`,
  )
}

// ── document ──────────────────────────────────────────────────────────────────

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    font-size: 9.2pt;
    line-height: 1.45;
    color: ${PAPER.ink};
    background: #fff;
  }
  strong { font-weight: 600; }
  .na { color: ${PAPER.muted}; }

  .title {
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
    background: linear-gradient(105deg, ${PAPER.band} 0%, #1b2130 62%, #243049 100%);
    color: #fff; border-radius: 10px; padding: 18px 22px; margin-bottom: 14px;
  }
  .brand { margin: 0; font-size: 8pt; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; color: ${HUES.cpu}; }
  .title h1 { margin: 2px 0 0; font-size: 20pt; font-weight: 700; letter-spacing: -0.3px; }
  .subject { margin: 4px 0 0; font-size: 10pt; color: #dbe2ee; }
  .stamp { margin: 3px 0 0; font-size: 8.4pt; color: #9aa6b9; }
  .pill {
    display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px;
    background: color-mix(in srgb, var(--pill) 26%, transparent);
    color: var(--pill); font-size: 7.6pt; font-weight: 700;
  }
  .title-stats { display: flex; gap: 26px; margin-top: 12px; }
  .title-stats div { display: flex; flex-direction: column; }
  .title-stats span { font-size: 7.4pt; letter-spacing: 0.7px; text-transform: uppercase; color: #8e9bb0; }
  .title-stats strong { font-size: 10.5pt; font-weight: 600; font-variant-numeric: tabular-nums; }
  .ring { text-align: center; flex-shrink: 0; }
  .ring-grade { margin: 4px 0 0; font-size: 8.6pt; font-weight: 700; }

  .banner { border-radius: 8px; padding: 9px 13px; margin: 0 0 14px; font-size: 8.8pt; break-inside: avoid; }
  .banner.ok { background: ${STATUS_COLORS.good}14; border-left: 3px solid ${STATUS_COLORS.good}; color: ${PAPER.ink2}; }
  .banner.warn { background: ${STATUS_COLORS.warning}14; border-left: 3px solid ${STATUS_COLORS.warning}; }
  .banner-head { margin: 0 0 4px; font-weight: 700; }
  .banner ul { margin: 0; padding-left: 15px; }
  .banner li { margin: 2px 0; }
  .banner li::marker { color: var(--sev); }

  .section { break-inside: avoid; margin-bottom: 13px; border: 1px solid ${PAPER.hairline}; border-radius: 8px; padding: 11px 13px 12px; }
  .section h2 {
    display: flex; align-items: center; gap: 7px;
    margin: 0 0 9px; padding-bottom: 7px; border-bottom: 1px solid ${PAPER.hairline};
    font-size: 11pt; font-weight: 700; letter-spacing: -0.15px;
  }
  .dot { width: 9px; height: 9px; border-radius: 3px; background: var(--hue); flex-shrink: 0; }
  .note { margin-left: auto; font-size: 8pt; font-weight: 500; color: ${PAPER.muted}; }
  .sub-head { margin: 11px 0 5px; font-size: 8pt; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: ${PAPER.muted}; }
  .lede { margin: 0 0 9px; font-size: 9pt; }
  .empty { margin: 0; font-size: 8.6pt; color: ${PAPER.muted}; font-style: italic; }

  .fields { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 22px; margin: 0; }
  .field { display: flex; gap: 10px; align-items: baseline; padding: 3.2px 0; border-bottom: 1px solid ${PAPER.tint}; }
  .field dt { flex: 0 0 40%; color: ${PAPER.muted}; font-size: 8.6pt; }
  .field dd { margin: 0; flex: 1; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th { text-align: left; font-weight: 700; font-size: 7.6pt; letter-spacing: 0.5px; text-transform: uppercase; color: ${PAPER.muted}; padding: 0 7px 4px 0; border-bottom: 1px solid ${PAPER.hairline}; }
  td { padding: 4px 7px 4px 0; border-bottom: 1px solid ${PAPER.tint}; vertical-align: top; font-variant-numeric: tabular-nums; }
  th:last-child, td:last-child { padding-right: 0; }
  tbody tr:last-child td { border-bottom: none; }
  .num { text-align: right; }
  .num .bar-row { justify-content: flex-end; }

  .bar { display: inline-block; height: 6px; border-radius: 3px; background: ${PAPER.hairline}; overflow: hidden; vertical-align: middle; }
  .bar-fill { display: block; height: 100%; border-radius: 3px; }
  .bar-row { display: inline-flex; align-items: center; gap: 7px; }
  .bar-value { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }

  .cores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px 16px; }
  .core { display: flex; align-items: center; gap: 6px; font-size: 7.8pt; }
  .core-id { width: 15px; text-align: right; color: ${PAPER.muted}; font-variant-numeric: tabular-nums; }
  .core-value { width: 22px; text-align: right; font-variant-numeric: tabular-nums; }

  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; background: ${PAPER.tint}; border: 1px solid ${PAPER.hairline}; font-size: 8pt; }
  .chip em { font-style: normal; font-weight: 700; color: var(--hue); }
  .tag { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 7.4pt; font-weight: 700;
         background: color-mix(in srgb, var(--tag, ${HUES.cpu}) 18%, transparent); color: var(--tag, ${HUES.cpu}); white-space: nowrap; }

  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; align-items: start; }
  .split .sub-head:first-child { margin-top: 0; }

  .chart { margin-bottom: 9px; }
  .legend { display: flex; gap: 16px; margin-top: 3px; font-size: 8pt; color: ${PAPER.ink2}; }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; }
  .legend-swatch { width: 9px; height: 3px; border-radius: 2px; }

  .closing { margin-top: 2px; font-size: 7.8pt; color: ${PAPER.muted}; text-align: center; }
`

/** Filename for the saved report: `HardwareFlow-Report_HOST_2026-09-20_1432.pdf`. */
export function reportFileName(snapshot: HardwareSnapshot): string {
  const date = new Date(snapshot.capturedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
  const host = snapshot.system.hostname.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'System'

  return `HardwareFlow-Report_${host}_${stamp}.pdf`
}

/** The whole report as one standalone HTML document, ready to be printed to PDF. */
export function buildReportHtml(input: ReportInput): string {
  const body = [
    titleBlock(input),
    alertBox(input.alerts),
    systemSection(input),
    scoreSection(input),
    cpuSection(input),
    memorySection(input),
    gpuSection(input),
    storageSection(input),
    networkSection(input),
    batterySection(input),
    processesSection(input),
    historySection(input),
    `<p class="closing">Erstellt mit HardwareFlow · Alle Werte sind Momentaufnahmen zum Zeitpunkt ${esc(formatClockTime(input.snapshot.capturedAt))}; ein „${EM_DASH}“ bedeutet, dass das System diesen Wert nicht meldet.</p>`,
  ].join('\n')

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>${esc(reportFileName(input.snapshot).replace(/\.pdf$/, ''))}</title>
<style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`
}
