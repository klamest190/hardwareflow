import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'

import { isCounterSample, type CounterSample } from './probeMapping'

/**
 * Windows performance counters and hardware sensors, read by one long-running
 * PowerShell process.
 *
 * `systeminformation` has no per-volume disk throughput and no utilisation for Intel or
 * AMD graphics on Windows. Both exist as performance counters, but reading them is
 * expensive the first time — measured on a Core Ultra 7 notebook: ~98 s for three cold
 * WMI queries, then ~0.3 s for disks and ~0.7 s for busy GPU engines once the CIM
 * session is warm. So the session is opened once and kept, and the process streams one
 * JSON line every two seconds.
 *
 * The script stays thin on purpose: it hands over raw instance names and values, and
 * `probeMapping.ts` does the interpretation, where it is tested against recorded data.
 *
 * - **Disks:** `Win32_PerfFormattedData_PerfDisk_PhysicalDisk`. The class name is not
 *   localised (the counter set is — `Get-Counter '\PhysicalDisk(*)'` fails on German
 *   Windows), and the instance name `0 C:` carries the drive letters.
 * - **GPU engines:** `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine`, filtered
 *   to engines with load, which cuts ~1 000 instances to a handful.
 * - **Adapters:** DXGI, for the LUID each engine instance names. Matching adapters by
 *   engine type would be guesswork; DXGI states it.
 * - **Sensors:** LibreHardwareMonitor or OpenHardwareMonitor via WMI, if one is running.
 *   Neither is shipped — both need a kernel driver and admin rights.
 */

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$parentPid = [int]$env:HF_PARENT_PID

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class HfDxgi {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Desc {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
    public uint VendorId, DeviceId, SubSysId, Revision;
    public UIntPtr DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
    public uint LuidLow; public int LuidHigh;
    public uint Flags;
  }

  [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFactory1 {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation();
    void CreateSwapChain(); void CreateSoftwareAdapter();
    [PreserveSig] int EnumAdapters1(uint index, [MarshalAs(UnmanagedType.Interface)] out IAdapter1 adapter);
  }

  [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAdapter1 {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    void EnumOutputs(); void GetDesc(); void CheckInterfaceSupport();
    [PreserveSig] int GetDesc1(out Desc desc);
  }

  [DllImport("dxgi.dll")]
  static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IFactory1 factory);

  public static object[] Adapters() {
    var riid = typeof(IFactory1).GUID;
    IFactory1 factory;
    var list = new List<object>();
    if (CreateDXGIFactory1(ref riid, out factory) != 0) return list.ToArray();
    for (uint i = 0; ; i++) {
      IAdapter1 adapter;
      if (factory.EnumAdapters1(i, out adapter) != 0) break;
      Desc d;
      if (adapter.GetDesc1(out d) != 0) continue;
      var entry = new Dictionary<string, object>();
      entry["luid"] = string.Format("0x{0:x8}_0x{1:x8}", d.LuidHigh, d.LuidLow);
      entry["name"] = d.Description;
      entry["vendorId"] = d.VendorId;
      list.Add(entry);
    }
    return list.ToArray();
  }
}
'@

$adapters = @([HfDxgi]::Adapters())
$session = New-CimSession
$engineQuery = 'SELECT Name, UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine WHERE UtilizationPercentage > 0'

while ($true) {
  if ($parentPid -gt 0 -and -not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { exit 0 }
  $started = [Environment]::TickCount

  $disks = @(Get-CimInstance -CimSession $session -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Property Name, DiskReadBytesPersec, DiskWriteBytesPersec |
    ForEach-Object { @{ n = [string]$_.Name; r = [double]$_.DiskReadBytesPersec; w = [double]$_.DiskWriteBytesPersec } })

  $engines = @()
  try {
    $engines = @(Get-CimInstance -CimSession $session -Query $engineQuery |
      ForEach-Object { @{ n = [string]$_.Name; u = [double]$_.UtilizationPercentage } })
  } catch { }

  $provider = $null
  $sensors = @()
  foreach ($candidate in @('LibreHardwareMonitor', 'OpenHardwareMonitor')) {
    try {
      $found = @(Get-CimInstance -CimSession $session -Namespace "root/$candidate" -ClassName Sensor -ErrorAction Stop)
      if ($found.Count -gt 0) {
        $provider = $candidate
        $sensors = @($found | ForEach-Object { @{ i = [string]$_.Identifier; n = [string]$_.Name; t = [string]$_.SensorType; v = [double]$_.Value } })
        break
      }
    } catch { }
  }

  $line = @{ adapters = $adapters; disks = $disks; engines = $engines; provider = $provider; sensors = $sensors } |
    ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()

  $elapsed = [Environment]::TickCount - $started
  Start-Sleep -Milliseconds ([Math]::Max(500, 2000 - $elapsed))
}
`

/** Waits between restarts after a crash: 5 s, doubling, capped at a minute. */
const RESTART_MIN_MS = 5_000
const RESTART_MAX_MS = 60_000

export interface CounterReaderOptions {
  onSample: (sample: CounterSample) => void
  /** A message when the reader fails, `null` once it delivers again. */
  onStatus: (message: string | null) => void
}

export class CounterReader {
  private child: ChildProcessWithoutNullStreams | null = null
  private running = false
  private restartDelay = RESTART_MIN_MS
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private failed = false

  private readonly options: CounterReaderOptions

  constructor(options: CounterReaderOptions) {
    this.options = options
  }

  /** `true` while a PowerShell process exists — what the self-test checks around a pause. */
  get processAlive(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  /** No-op outside Windows — the counters and DXGI are Windows-only. */
  start(): void {
    if (process.platform !== 'win32' || this.running) return
    this.running = true
    this.spawn()
  }

  stop(): void {
    this.running = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.child?.kill()
    this.child = null
  }

  private spawn() {
    // -EncodedCommand takes UTF-16LE; it keeps the script out of quoting trouble and off disk.
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      // The script exits by itself if this process disappears without killing it.
      { windowsHide: true, env: { ...process.env, HF_PARENT_PID: String(process.pid) } },
    )
    this.child = child

    let lastError = ''
    child.stderr.on('data', (chunk: Buffer) => {
      lastError = chunk.toString('utf8').trim().split(/\r?\n/).slice(-3).join(' ')
    })

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return
      }
      if (!isCounterSample(parsed)) return
      this.restartDelay = RESTART_MIN_MS
      if (this.failed) {
        this.failed = false
        this.options.onStatus(null)
      }
      this.options.onSample(parsed)
    })

    child.on('exit', (code) => {
      if (this.child === child) this.child = null
      if (!this.running) return
      this.failed = true
      this.options.onStatus(
        `Leistungsindikatoren: PowerShell beendet (Code ${code ?? '?'})${lastError ? ` — ${lastError}` : ''}`,
      )
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        if (this.running) this.spawn()
      }, this.restartDelay)
      this.restartDelay = Math.min(this.restartDelay * 2, RESTART_MAX_MS)
    })
  }
}
