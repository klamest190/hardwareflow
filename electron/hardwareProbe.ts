import si from 'systeminformation'

import type { HardwareReading } from '../src/types/hardware'
import { buildReading, emptyRawState, summarizeProcesses, type RawProbeState } from './probeMapping'

/**
 * Real hardware probe, running in the Electron main process.
 *
 * Two things drive the design:
 *
 * 1. **Tiered polling.** A full `systeminformation` sweep costs ~7 s on Windows,
 *    because most calls shell out to WMI/PowerShell. Only load, memory and clock are
 *    cheap enough for a 1 s tick; graphics, temperature and network counters go on 2 s
 *    tiers, the filesystem, process table, adapters and battery on a 15 s tier, and the
 *    static inventory is read every few minutes. Each tier skips its turn if the
 *    previous run is still in flight, so a slow WMI call can never queue up behind
 *    itself.
 * 2. **No invented values.** Where a platform reports nothing the field stays `null`
 *    all the way to the UI.
 *
 * This class only fetches and caches. Turning the cache into a reading is
 * `probeMapping.ts`, which is tested against recorded output from real machines.
 */

/** Intervals per tier, in milliseconds. */
const MEDIUM_TIER_MS = 2000
/** `networkStats('*')` alone takes 1.2–2.2 s on Windows, so it gets its own tier. */
const NETWORK_TIER_MS = 2000
const SLOW_TIER_MS = 15_000
const STATIC_TIER_MS = 300_000

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

  private readonly raw: RawProbeState = emptyRawState()

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
    this.onStatus([...this.failing].map(([tier, message]) => `${tier}: ${message}`).join(' · '))
  }

  private async refreshStatic() {
    const [osInfo, cpu, memLayout, diskLayout] = await Promise.all([
      si.osInfo(),
      si.cpu(),
      si.memLayout(),
      si.diskLayout(),
    ])
    Object.assign(this.raw, { osInfo, cpu, memLayout, diskLayout })
  }

  private async refreshFast() {
    const [load, mem, speed, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuCurrentSpeed(),
      Promise.resolve(si.time()),
    ])
    Object.assign(this.raw, { load, mem, speed, uptimeSeconds: time.uptime ?? 0 })

    // Several CPUs (Intel Core Ultra among them) report their base clock as the
    // maximum; the observed peak corrects the displayed figure upwards over time.
    const peak = Math.max(speed.max ?? 0, speed.avg ?? 0, ...(speed.cores ?? []))
    if (Number.isFinite(peak)) this.raw.observedMaxGhz = Math.max(this.raw.observedMaxGhz, peak)
  }

  private async refreshMedium() {
    const [graphics, temperature] = await Promise.all([si.graphics(), si.cpuTemperature()])
    Object.assign(this.raw, { graphics, temperature })
  }

  private async refreshNetwork() {
    this.raw.networkStats = await si.networkStats('*')
  }

  private async refreshSlow() {
    const [fsSizes, blockDevices, processes, networkInterfaces, wifi, battery] = await Promise.all([
      si.fsSize(),
      si.blockDevices(),
      si.processes(),
      si.networkInterfaces(),
      // Machines without Wi-Fi throw here on some drivers; an empty list is the truth.
      si.wifiConnections().catch(() => []),
      si.battery(),
    ])
    Object.assign(this.raw, {
      fsSizes,
      blockDevices,
      processes: summarizeProcesses(processes),
      networkInterfaces: Array.isArray(networkInterfaces) ? networkInterfaces : [networkInterfaces],
      wifi,
      battery,
    })
  }

  /** Assembles a reading from whatever each tier has most recently cached. */
  reading(): HardwareReading {
    return buildReading(this.raw, Date.now())
  }

  /**
   * A deep copy of the raw cache — what `npm run probe -- --raw` writes out as a test
   * fixture.
   */
  rawState(): RawProbeState {
    return structuredClone(this.raw)
  }

  /** Reads every tier once, so the first emitted reading is already complete. */
  async warmUp(): Promise<void> {
    await Promise.all([
      this.guarded('static', () => this.refreshStatic()),
      this.guarded('fast', () => this.refreshFast()),
      this.guarded('medium', () => this.refreshMedium()),
      this.guarded('network', () => this.refreshNetwork()),
      this.guarded('slow', () => this.refreshSlow()),
    ])
    // `currentLoad` and `networkStats` need two samples to report a meaningful delta.
    await Promise.all([
      this.guarded('fast', () => this.refreshFast()),
      this.guarded('network', () => this.refreshNetwork()),
    ])
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
    void this.guarded('fast', () => this.tick())
  }

  /**
   * One fast refresh and emit. Under load a WMI round-trip outlasts a second, so a pause
   * can land while the refresh is in flight — the reading it produces is then dropped,
   * or a paused dashboard would still receive one more tick.
   */
  private async tick() {
    await this.refreshFast()
    if (!this.paused) this.listener?.(this.reading())
  }

  get paused(): boolean {
    return this.timers.length === 0
  }

  private startTimers(): void {
    this.timers.push(
      setInterval(() => {
        void this.guarded('fast', () => this.tick())
      }, this.intervalMs),
      setInterval(() => void this.guarded('medium', () => this.refreshMedium()), MEDIUM_TIER_MS),
      setInterval(() => void this.guarded('network', () => this.refreshNetwork()), NETWORK_TIER_MS),
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
