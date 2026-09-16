import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, PlugZap } from 'lucide-react'

import { formatMinutes } from '../lib/format'
import { HUES } from '../lib/palette'
import { STATUS_COLORS } from '../lib/status'
import type { BatteryInfo } from '../types/hardware'
import { AnimatedNumber } from './ui/AnimatedNumber'
import { Card } from './ui/Card'
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

function chargeColor(percent: number) {
  if (percent <= 10) return STATUS_COLORS.critical
  if (percent <= 20) return STATUS_COLORS.serious
  return STATUS_COLORS.good
}

const mwhToWh = (mwh: number) => (mwh / 1000).toFixed(1)

/**
 * Battery module: charge, power state and — the figure a notebook owner rarely sees —
 * how much of its design capacity the battery still holds.
 */
export function BatteryCard({ battery, className }: BatteryCardProps) {
  const Icon = battery.charging
    ? BatteryCharging
    : battery.percent > 60
      ? BatteryFull
      : battery.percent > 20
        ? BatteryMedium
        : BatteryLow
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
      icon={Icon}
      accent={HUES.battery}
      className={className}
      action={
        <div>
          <p className="text-xl leading-6 font-semibold text-ink tabular-nums">
            <AnimatedNumber value={battery.percent} />
            <span className="ml-0.5 text-sm font-normal text-muted">%</span>
          </p>
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted">
            {battery.acConnected && <PlugZap aria-hidden size={11} />}
            geladen
          </p>
        </div>
      }
    >
      <Meter
        height={10}
        value={battery.percent}
        color={chargeColor(battery.percent)}
        ariaLabel={`Ladestand ${Math.round(battery.percent)} %`}
      />

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-xs font-medium text-ink-2">Zustand</h3>
          <span className="text-[11px] text-muted tabular-nums">
            {battery.healthPercent === null || !health ? (
              <NotAvailable reason="Nenn- oder Vollladekapazität nicht gemeldet" />
            ) : (
              <>
                {Math.round(battery.healthPercent)} % der Nennkapazität ·{' '}
                <span className="font-medium text-ink-2">{health.label}</span>
              </>
            )}
          </span>
        </div>
        {battery.healthPercent !== null && health && (
          <Meter
            className="mt-2"
            height={6}
            value={battery.healthPercent}
            color={health.color}
            ariaLabel={`Akkuzustand ${Math.round(battery.healthPercent)} % — ${health.label}`}
          />
        )}
      </div>

      <StatGrid columns={3} className="mt-5">
        <Stat
          label="Nenn"
          value={battery.designCapacityMwh === null ? <NotAvailable /> : mwhToWh(battery.designCapacityMwh)}
          hint={battery.designCapacityMwh === null ? undefined : 'Wh'}
        />
        <Stat
          label="Voll"
          value={
            battery.fullChargeCapacityMwh === null ? <NotAvailable /> : mwhToWh(battery.fullChargeCapacityMwh)
          }
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
