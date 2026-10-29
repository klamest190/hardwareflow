import { STATUS_COLORS } from '../lib/status'
import type { HardwareAlert } from '../types/hardware'

/**
 * Conditions that currently hold, under the header of every page but the overview, which
 * names them in its status line. The same engine drives the desktop notifications, so
 * what is listed here is exactly what the tray warned about. Severity is written out as
 * well as coloured.
 */
export function AlertBanner({ alerts }: { alerts: HardwareAlert[] }) {
  if (alerts.length === 0) return null

  return (
    <ul className="mt-5 space-y-2" aria-live="polite">
      {alerts.map((alert) => {
        const color = STATUS_COLORS[alert.severity]
        return (
          <li
            key={alert.key}
            className="rounded-md border-l-4 bg-surface px-4 py-2.5 text-sm"
            style={{ borderLeftColor: color }}
          >
            <span className="font-semibold" style={{ color }}>
              {alert.severity === 'critical' ? 'Kritisch' : 'Warnung'}: {alert.title}
            </span>
            <span className="ml-2 text-ink-2">{alert.message}</span>
          </li>
        )
      })}
    </ul>
  )
}
