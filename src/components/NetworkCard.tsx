import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'

import { formatBitrate, formatLinkSpeed } from '../lib/format'
import type { LoadSample, NetworkAdapter, NetworkInfo } from '../types/hardware'
import { Card, PanelHeading } from './ui/Card'
import { DeviceName } from './ui/DeviceName'
import { NotAvailable } from './ui/NotAvailable'
import { Stat, StatGrid } from './ui/Stat'
import { Tag } from './ui/Tag'

const INK = '#e6e3dc'
const MUTED = '#9a978f'
const GRID = '#3a4047'
const AXIS = '#4a515a'
const SPAN_MS = 60_000

const KIND_LABEL: Record<NetworkAdapter['kind'], string> = {
  wired: 'LAN',
  wireless: 'WLAN',
  virtual: 'VPN/virtuell',
}

/** Seconds before the newest sample — the window is a minute, so wall-clock time is noise. */
function relativeTick(end: number) {
  return (t: number) => {
    const seconds = Math.round((end - t) / 1000)
    return seconds <= 0 ? 'jetzt' : `−${seconds} s`
  }
}

function NetworkTooltip({ active, payload, end }: TooltipContentProps & { end: number }) {
  const point = payload?.[0]?.payload as LoadSample | undefined
  if (!active || !point) return null

  return (
    <div className="rounded-md border border-hairline bg-surface-2 px-3 py-2 text-xs tabular-nums shadow-lg">
      <p className="text-muted">{relativeTick(end)(point.timestamp)}</p>
      <p className="mt-0.5 font-semibold text-ink">Empfang {formatBitrate(point.netRxBytesPerSec)}</p>
      <p className="text-ink-2">Senden {formatBitrate(point.netTxBytesPerSec)}</p>
    </div>
  )
}

interface NetworkCardProps {
  network: NetworkInfo
  history: LoadSample[]
  className?: string
}

/**
 * Throughput of the last minute. Download is the filled trace in scale ink; upload is a
 * thin dashed line, so the two stay apart by weight and shape, not by colour. Network
 * traffic has no "too much", so nothing here ever takes a status colour.
 */
export function NetworkCard({ network, history, className }: NetworkCardProps) {
  const latest = history[history.length - 1]
  const primary = network.adapters[0]
  const hasRates = history.some((sample) => sample.netRxBytesPerSec !== null)
  const end = latest?.timestamp ?? 0

  return (
    <Card title="Durchsatz" subtitle={primary ? <DeviceName name={`${primary.name} · ${primary.adapter}`} wrap /> : 'Keine Verbindung'} className={className}>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-2">
        <div>
          <p className="text-xs text-muted">Empfang</p>
          <p className="hf-figure text-xl font-semibold text-ink">
            {latest?.netRxBytesPerSec == null ? (
              <NotAvailable reason="Noch kein Zählerstand — der erste Wert kommt nach zwei Sekunden" />
            ) : (
              formatBitrate(latest.netRxBytesPerSec)
            )}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Senden, gestrichelt</p>
          <p className="hf-figure text-xl font-semibold text-ink-2">{formatBitrate(latest?.netTxBytesPerSec ?? null)}</p>
        </div>
      </div>

      <div className="mt-4 h-80 min-h-0 flex-1">
        {hasRates ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="hf-net-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={INK} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={INK} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={[end - SPAN_MS, end]}
                ticks={[60, 45, 30, 15, 0].map((seconds) => end - seconds * 1000)}
                tickFormatter={relativeTick(end)}
                tick={{ fill: MUTED, fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: AXIS }}
              />
              <YAxis
                domain={[0, 'auto']}
                tick={{ fill: MUTED, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={84}
                tickFormatter={(value: number) => formatBitrate(value)}
              />
              <Tooltip content={(props) => <NetworkTooltip {...props} end={end} />} cursor={{ stroke: MUTED, strokeWidth: 1 }} />
              <Area
                type="linear"
                dataKey="netRxBytesPerSec"
                stroke={INK}
                strokeWidth={1.75}
                fill="url(#hf-net-fill)"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="netTxBytesPerSec"
                stroke={MUTED}
                strokeWidth={1.25}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center rounded-md bg-surface-2 text-sm text-muted">
            Durchsatz erscheint nach der ersten Zählerdifferenz
          </div>
        )}
      </div>
    </Card>
  )
}

/** The adapters that are up and the Wi-Fi link — the facts behind the throughput. */
export function ConnectionsCard({ network, className }: { network: NetworkInfo; className?: string }) {
  const { wifi } = network

  return (
    <Card title="Verbindungen" subtitle={`${network.adapters.length} aktiv`} className={className}>
      <ul className="space-y-3">
        {network.adapters.length === 0 && <li className="text-sm text-muted">Kein Adapter mit aktiver Verbindung</li>}
        {network.adapters.map((adapter) => (
          <li key={adapter.id}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink">{adapter.name}</span>
              <Tag>{KIND_LABEL[adapter.kind]}</Tag>
              {adapter.isDefault && <Tag>Standard</Tag>}
            </div>
            <p className="mt-0.5 flex text-xs text-muted">
              <DeviceName name={adapter.adapter} />
            </p>
            <p className="text-xs text-ink-2 tabular-nums">
              {[adapter.ipv4, adapter.linkMbps !== null ? formatLinkSpeed(adapter.linkMbps) : null].filter(Boolean).join(' · ')}
            </p>
          </li>
        ))}
      </ul>

      {wifi && (
        <div className="mt-auto border-t border-hairline pt-4">
          <PanelHeading aside={network.wifiGeneration ?? undefined}>WLAN {wifi.ssid}</PanelHeading>
          <StatGrid columns={3} className="mt-3">
            <Stat label="Signal" value={wifi.signalDbm !== null ? Math.round(wifi.signalDbm) : <NotAvailable />} hint={wifi.signalDbm !== null ? 'dBm' : undefined} />
            <Stat label="Qualität" value={wifi.quality !== null ? Math.round(wifi.quality) : <NotAvailable />} hint={wifi.quality !== null ? '%' : undefined} />
            <Stat
              label="Band"
              value={wifi.frequencyMhz !== null ? (wifi.frequencyMhz / 1000).toFixed(1) : <NotAvailable />}
              hint={wifi.frequencyMhz !== null ? 'GHz' : undefined}
            />
          </StatGrid>
        </div>
      )}
    </Card>
  )
}
