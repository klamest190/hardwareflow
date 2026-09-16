import { ArrowDown, ArrowUp, Network, Wifi } from 'lucide-react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'

import { formatBitrate, formatClockTime, formatLinkSpeed } from '../lib/format'
import { HUES } from '../lib/palette'
import type { LoadSample, NetworkAdapter, NetworkInfo } from '../types/hardware'
import { Card } from './ui/Card'
import { NotAvailable } from './ui/NotAvailable'

interface NetworkCardProps {
  network: NetworkInfo
  history: LoadSample[]
  /** `true` on the network page, where the chart gets the room the overview cannot give it. */
  tall?: boolean
  className?: string
}

const GRID = '#262a33'
const AXIS_TEXT = '#8b93a3'

/** Short `mm:ss` axis label — the window is 60 s, so the hour is noise. */
function axisTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('de-DE', { minute: '2-digit', second: '2-digit' })
}

const KIND_LABEL: Record<NetworkAdapter['kind'], string> = {
  wired: 'LAN',
  wireless: 'WLAN',
  virtual: 'VPN/virtuell',
}

function NetworkTooltip({ active, payload }: TooltipContentProps) {
  const point = payload?.[0]?.payload as LoadSample | undefined
  if (!active || !point) return null

  return (
    <div className="rounded-lg border border-hairline bg-surface-2 px-3 py-2 shadow-xl">
      <p className="text-[11px] text-muted tabular-nums">{formatClockTime(point.timestamp)}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-ink tabular-nums">
        <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: HUES.network }} />
        Empfang {formatBitrate(point.netRxBytesPerSec)}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-ink tabular-nums">
        <span aria-hidden className="h-0.5 w-2 rounded-full" style={{ backgroundColor: HUES.neutral }} />
        Senden {formatBitrate(point.netTxBytesPerSec)}
      </p>
    </div>
  )
}

/**
 * Network module: throughput of the last minute, the adapters that are up, and the
 * Wi-Fi link. Download is the area in the module hue; upload is a thin grey line, so
 * the two stay apart by weight and shape as well as colour.
 */
export function NetworkCard({ network, history, tall = false, className }: NetworkCardProps) {
  const latest = history[history.length - 1]
  const primary = network.adapters[0]
  const hasRates = history.some((sample) => sample.netRxBytesPerSec !== null)

  return (
    <Card
      title="Netzwerk"
      subtitle={primary ? `${primary.name} · ${primary.adapter}` : 'Keine Verbindung'}
      icon={Network}
      accent={HUES.network}
      className={className}
      action={
        <div>
          <p className="text-xl leading-6 font-semibold text-ink tabular-nums">
            {latest?.netRxBytesPerSec == null ? (
              <NotAvailable reason="Noch kein Zählerstand — der erste Wert kommt nach zwei Sekunden" />
            ) : (
              formatBitrate(latest.netRxBytesPerSec)
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-muted tabular-nums">
            ↑ {formatBitrate(latest?.netTxBytesPerSec ?? null)}
          </p>
        </div>
      }
    >
      <div className="flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: HUES.network }} />
          <ArrowDown aria-hidden size={11} /> Empfang
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: HUES.neutral }} />
          <ArrowUp aria-hidden size={11} /> Senden
        </span>
        <span className="ml-auto">letzte 60 s</span>
      </div>

      <div className={`-mx-1 mt-2 ${tall ? 'h-72' : 'h-24'}`}>
        {hasRates ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={history} margin={{ top: 6, right: 6, bottom: 0, left: tall ? 0 : 4 }}>
              <defs>
                <linearGradient id="hf-net-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={HUES.network} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={HUES.network} stopOpacity={0} />
                </linearGradient>
              </defs>
              {tall && <CartesianGrid stroke={GRID} vertical={false} />}
              {tall && (
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={axisTime}
                  tick={{ fill: AXIS_TEXT, fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#333845' }}
                  minTickGap={52}
                />
              )}
              <YAxis
                hide={!tall}
                domain={[0, 'auto']}
                tick={{ fill: AXIS_TEXT, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={76}
                tickFormatter={(value: number) => formatBitrate(value)}
              />
              <Tooltip content={NetworkTooltip} cursor={{ stroke: '#4b5263', strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="netRxBytesPerSec"
                stroke={HUES.network}
                strokeWidth={2}
                fill="url(#hf-net-fill)"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="netTxBytesPerSec"
                stroke={HUES.neutral}
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center rounded-lg bg-surface-2 text-[11px] text-muted">
            Durchsatz erscheint nach der ersten Zählerdifferenz
          </div>
        )}
      </div>

      <ul className="mt-4 space-y-2 border-t border-hairline pt-4">
        {network.adapters.length === 0 && (
          <li className="text-[11px] text-muted">Kein Adapter mit aktiver Verbindung</li>
        )}
        {network.adapters.map((adapter) => (
          <li key={adapter.id} className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-semibold text-ink-2">{adapter.name}</span>
              <span className="shrink-0 rounded border border-hairline px-1.5 py-px text-[10px] font-medium text-muted">
                {KIND_LABEL[adapter.kind]}
              </span>
              {adapter.isDefault && (
                <span className="shrink-0 rounded border border-hairline px-1.5 py-px text-[10px] font-medium text-muted">
                  Standard
                </span>
              )}
            </span>
            <span className="shrink-0 text-muted tabular-nums">
              {[adapter.ipv4, adapter.linkMbps !== null ? formatLinkSpeed(adapter.linkMbps) : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>

      {network.wifi && (
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-hairline pt-3 text-[11px]">
          <span className="flex min-w-0 items-center gap-2 text-ink-2">
            <Wifi aria-hidden size={13} className="shrink-0 text-muted" />
            <span className="truncate">{network.wifi.ssid}</span>
          </span>
          <span className="shrink-0 text-muted tabular-nums">
            {[
              network.wifi.signalDbm !== null ? `${Math.round(network.wifi.signalDbm)} dBm` : null,
              network.wifi.quality !== null ? `${Math.round(network.wifi.quality)} %` : null,
              network.wifi.frequencyMhz !== null
                ? `${(network.wifi.frequencyMhz / 1000).toFixed(1)} GHz`
                : null,
              network.wifiGeneration,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      )}
    </Card>
  )
}
