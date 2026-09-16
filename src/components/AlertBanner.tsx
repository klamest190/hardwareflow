import { AlertOctagon, AlertTriangle } from 'lucide-react'

import { STATUS_COLORS } from '../lib/status'
import type { HardwareAlert } from '../types/hardware'

/**
 * Conditions that currently hold, straight under the header. The same engine drives the
 * desktop notifications, so what is listed here is exactly what the tray warned about.
 * Severity is carried by icon and wording as well as colour.
 */
export function AlertBanner({ alerts }: { alerts: HardwareAlert[] }) {
  if (alerts.length === 0) return null

  return (
    <ul className="mt-5 space-y-2" aria-live="polite">
      {alerts.map((alert) => {
        const color = alert.severity === 'critical' ? STATUS_COLORS.critical : STATUS_COLORS.warning
        const Icon = alert.severity === 'critical' ? AlertOctagon : AlertTriangle
        return (
          <li
            key={alert.key}
            className="flex items-start gap-2.5 rounded-xl border bg-surface px-4 py-3 text-xs leading-5"
            style={{ borderColor: `${color}66` }}
          >
            <Icon aria-hidden size={15} className="mt-0.5 shrink-0" style={{ color }} />
            <span>
              <span className="font-semibold text-ink">
                {alert.severity === 'critical' ? 'Kritisch: ' : 'Warnung: '}
                {alert.title}
              </span>
              <span className="ml-1.5 text-ink-2">{alert.message}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
