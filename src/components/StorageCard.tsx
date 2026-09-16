import { ArrowDown, ArrowUp, HardDrive } from 'lucide-react'

import { formatBytes, formatPercent, formatThroughput } from '../lib/format'
import { capacityStatus, STATUS_COLORS } from '../lib/status'
import type { DriveKind, PhysicalDisk, StorageDrive } from '../types/hardware'
import { Card } from './ui/Card'
import { Meter } from './ui/Meter'

const DISK_HUE = '#c98500'

const KIND_LABEL: Record<DriveKind, string> = {
  nvme: 'NVMe',
  ssd: 'SSD',
  hdd: 'HDD',
}

interface StorageCardProps {
  /** Mounted volumes, system volume first. */
  drives: StorageDrive[]
  /**
   * Physical disks, listed separately because Windows exposes no mapping from a
   * volume to the disk it lives on — so the hardware is named instead of guessed.
   */
  physicalDisks: PhysicalDisk[]
  className?: string
}

/**
 * Storage module: one meter per local volume plus the total free space in the header, and
 * the physical disks underneath. The meter fill carries capacity severity, and every
 * volume is labelled with its own numbers so hue is never the only cue.
 *
 * Network shares are listed apart from the local volumes and excluded from the totals.
 * Windows maps them to drive letters alongside real disks, so counting one would put a
 * file server's fill level into this machine's capacity.
 */
export function StorageCard({ drives, physicalDisks, className }: StorageCardProps) {
  const local = drives.filter((drive) => !drive.remote)
  const remote = drives.filter((drive) => drive.remote)
  const ordered = [...local].sort((a, b) => Number(b.system) - Number(a.system))
  const totalBytes = local.reduce((sum, drive) => sum + drive.totalBytes, 0)
  const freeBytes = local.reduce((sum, drive) => sum + drive.freeBytes, 0)

  return (
    <Card
      title="Massenspeicher"
      subtitle={`${local.length} ${local.length === 1 ? 'Volume' : 'Volumes'} · ${formatBytes(totalBytes, 0)} gesamt`}
      icon={HardDrive}
      accent={DISK_HUE}
      className={className}
      action={
        <div>
          <p className="text-xl leading-6 font-semibold text-ink tabular-nums">
            {formatBytes(freeBytes)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">frei</p>
        </div>
      }
    >
      <ul className="space-y-4">
        {ordered.map((drive) => {
          const usedBytes = drive.totalBytes - drive.freeBytes
          const usedPercent = drive.totalBytes > 0 ? (usedBytes / drive.totalBytes) * 100 : 0
          const hasThroughput = drive.readMbPerSec !== null || drive.writeMbPerSec !== null

          return (
            <li key={drive.id}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="text-sm font-semibold text-ink tabular-nums">{drive.mountPoint}</span>
                  <span className="truncate text-xs text-ink-2">{drive.label ?? drive.filesystem}</span>
                  {drive.kind && (
                    <span className="shrink-0 rounded border border-hairline px-1.5 py-px text-[10px] font-medium text-muted">
                      {KIND_LABEL[drive.kind]}
                    </span>
                  )}
                  {drive.system && (
                    <span className="shrink-0 rounded border border-hairline px-1.5 py-px text-[10px] font-medium text-muted">
                      System
                    </span>
                  )}
                  {drive.removable && (
                    <span className="shrink-0 rounded border border-hairline px-1.5 py-px text-[10px] font-medium text-muted">
                      Wechsel
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {formatPercent(usedPercent)}
                </span>
              </div>

              <Meter
                className="mt-2"
                height={8}
                value={usedPercent}
                color={STATUS_COLORS[capacityStatus(usedPercent)]}
                ariaLabel={`${drive.mountPoint}: ${formatPercent(usedPercent)} belegt`}
              />

              <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-muted tabular-nums">
                <span>
                  {formatBytes(usedBytes)} belegt · {formatBytes(drive.freeBytes)} frei
                </span>
                {/* Windows reports no per-volume throughput, so the cluster is omitted
                    entirely rather than showing two dashes on every row. */}
                {hasThroughput && (
                  <span className="flex shrink-0 items-center gap-2.5">
                    <span className="flex items-center gap-1">
                      <ArrowDown aria-hidden size={11} strokeWidth={2.5} />
                      <span className="sr-only">Lesen</span>
                      {formatThroughput(drive.readMbPerSec)}
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowUp aria-hidden size={11} strokeWidth={2.5} />
                      <span className="sr-only">Schreiben</span>
                      {formatThroughput(drive.writeMbPerSec)}
                    </span>
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {remote.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[11px] leading-4 font-medium tracking-wide text-muted uppercase">
              Netzlaufwerke
            </h3>
            <span className="text-[10px] text-muted">nicht in der Summe</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {remote.map((drive) => {
              const usedPercent =
                drive.totalBytes > 0
                  ? ((drive.totalBytes - drive.freeBytes) / drive.totalBytes) * 100
                  : 0

              return (
                <li key={drive.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 font-semibold text-ink-2 tabular-nums">
                      {drive.mountPoint}
                    </span>
                    <span className="truncate text-muted">{drive.label ?? drive.filesystem}</span>
                  </span>
                  <span className="shrink-0 text-muted tabular-nums">
                    {formatBytes(drive.freeBytes)} frei · {formatPercent(usedPercent)} belegt
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {physicalDisks.length > 0 && (
        <div className="mt-auto border-t border-hairline pt-4">
          <h3 className="text-[11px] leading-4 font-medium tracking-wide text-muted uppercase">
            Datenträger
          </h3>
          <ul className="mt-2 space-y-1.5">
            {physicalDisks.map((disk) => (
              <li key={disk.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-ink-2">{disk.name}</span>
                  {disk.kind && (
                    <span className="shrink-0 rounded border border-hairline px-1.5 py-px text-[10px] font-medium text-muted">
                      {KIND_LABEL[disk.kind]}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-muted tabular-nums">
                  {formatBytes(disk.sizeBytes, 0)}
                  {disk.temperatureC !== null && ` · ${Math.round(disk.temperatureC)} °C`}
                  {disk.smartStatus && ` · SMART ${disk.smartStatus}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
