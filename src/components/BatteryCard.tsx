import { PlugZap } from 'lucide-react'

import { formatMinutes } from '../lib/format'
import { STATUS_COLORS } from '../lib/status'
import type { BatteryInfo } from '../types/hardware'
import { Card, PanelHeading } from './ui/Card'
import { Meter } from './ui/Meter'
import { NotAvailable } from './ui/NotAvailable'
import { Stat, StatGrid } from './ui/Stat'

interface BatteryCardProps {
  battery: BatteryInfo
  className?: string
}

/** Wear bands: under 80 % of design capacity is worn, under 60 % is due for replacement. */
function healthStatus(percent: number) {
  if (percent < 60) return { label: 'Austausch sinnvoll', color: STATUS_COLORS.critical }
  if (percent < 80) return { label: 'Deutlich gealtert', color: STATUS_COLORS.warning }
  return { label: 'Gut', color: STATUS_COLORS.good }
}

/** Low charge only matters off the charger. */
function chargeColor(battery: BatteryInfo) {
  if (battery.acConnected) return STATUS_COLORS.good
  if (battery.percent <= 10) return STATUS_COLORS.critical
  if (battery.percent <= 20) return STATUS_COLORS.serious
  return STATUS_COLORS.good
}

const mwhToWh = (mwh: number) => (mwh / 1000).toFixed(1)

/**
 * Battery detail: charge, power state and — the figure a notebook owner rarely sees —
 * how much of its design capacity the battery still holds.
 */
export function BatteryCard({ battery, className }: BatteryCardProps) {
  const state = battery.charging
    ? 'Lädt'
    : battery.acConnected
      ? 'Netzbetrieb'
      : battery.minutesRemaining !== null
        ? `Akkubetrieb · noch ${formatMinutes(battery.minutesRemaining)}`
        : 'Akkubetrieb'
  const health = battery.healthPercent === null ? null : healthStatus(battery.healthPercent)

  return (
    <Card
      title="Akku"
      subtitle={state}
      className={className}
      action={
        <p className="flex items-center gap-1.5 text-sm text-ink-2">
          {battery.acConnected && <PlugZap aria-hidden size={14} className="text-muted" />}
          <span className="hf-figure font-semibold text-ink">{Math.round(battery.percent)} %</span>
        </p>
      }
    >
      <PanelHeading>Ladestand</PanelHeading>
      <Meter
        className="mt-2"
        height={8}
        value={battery.percent}
        color={chargeColor(battery)}
        ariaLabel={`Ladestand ${Math.round(battery.percent)} %`}
      />

      <div className="mt-4">
        <PanelHeading
          aside={
            battery.healthPercent === null || !health ? (
              <NotAvailable reason="Nenn- oder Vollladekapazität nicht gemeldet" />
            ) : (
              <>
                {Math.round(battery.healthPercent)} % der Nennkapazität ·{' '}
                <span className="font-medium" style={{ color: health.color === STATUS_COLORS.good ? undefined : health.color }}>
                  {health.label}
                </span>
              </>
            )
          }
        >
          Zustand
        </PanelHeading>
        {battery.healthPercent !== null && health && (
          <Meter
            className="mt-2"
            value={battery.healthPercent}
            color={health.color}
            ariaLabel={`Akkuzustand ${Math.round(battery.healthPercent)} % — ${health.label}`}
          />
        )}
      </div>

      <StatGrid columns={3} className="mt-5">
        <Stat
          label="Nennkapazität"
          value={battery.designCapacityMwh === null ? <NotAvailable /> : mwhToWh(battery.designCapacityMwh)}
          hint={battery.designCapacityMwh === null ? undefined : 'Wh'}
        />
        <Stat
          label="Voll geladen"
          value={battery.fullChargeCapacityMwh === null ? <NotAvailable /> : mwhToWh(battery.fullChargeCapacityMwh)}
          hint={battery.fullChargeCapacityMwh === null ? undefined : 'Wh'}
        />
        <Stat
          label="Zyklen"
          value={
            battery.cycleCount === null ? (
              <NotAvailable reason="Windows meldet für diesen Akku keine Ladezyklen" />
            ) : (
              battery.cycleCount
            )
          }
        />
      </StatGrid>
    </Card>
  )
}
