import { PanelTopOpen, Settings } from 'lucide-react'

import { HUES } from '../lib/palette'
import type { DesktopSettings } from '../types/bridge'
import { Card } from './ui/Card'

interface SettingsCardProps {
  /** `null` in the browser, where the desktop settings do not exist. */
  settings: DesktopSettings | null
  onUpdate: (patch: Partial<DesktopSettings>) => void
  onOpenMini: (() => void) | null
  className?: string
}

/** The desktop behaviour: autostart, notifications, tray. Mirrors the tray menu. */
export function SettingsCard({ settings, onUpdate, onOpenMini, className }: SettingsCardProps) {
  if (!settings) {
    return (
      <Card title="Einstellungen" subtitle="Nur in der Desktop-App" icon={Settings} accent={HUES.neutral} className={className}>
        <p className="text-xs leading-5 text-muted">
          Autostart, Benachrichtigungen und das Tray-Symbol gibt es nur in der Desktop-App. Im Browser läuft der
          Simulator.
        </p>
      </Card>
    )
  }

  const rows: Array<{ key: keyof DesktopSettings; label: string; hint: string; disabled?: boolean }> = [
    {
      key: 'autostart',
      label: 'Mit Windows starten',
      hint: settings.autostartAvailable
        ? 'Startet unsichtbar im Infobereich und zeichnet ab dem Anmelden den Verlauf auf.'
        : 'Nur in der installierten App — im Entwicklungsmodus würde Windows sonst die nackte Electron-Binary starten.',
      disabled: !settings.autostartAvailable,
    },
    {
      key: 'notifications',
      label: 'Warnungen als Benachrichtigung',
      hint: 'Hitze, voller Arbeitsspeicher, volles Systemlaufwerk, leerer Akku — höchstens alle 30 Minuten je Warnung.',
    },
    {
      key: 'closeToTray',
      label: 'Beim Schließen im Tray weiterlaufen',
      hint: 'Messung, Verlauf und Warnungen laufen weiter. Beenden über das Tray-Menü.',
    },
  ]

  return (
    <Card title="Einstellungen" subtitle="Verhalten der Desktop-App" icon={Settings} accent={HUES.neutral} className={className}>
      <ul className="divide-y divide-hairline">
        {rows.map((row) => (
          <li key={row.key} className="py-3 first:pt-0">
            <label
              className={`flex items-start gap-3 ${row.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-cpu"
                checked={Boolean(settings[row.key])}
                disabled={row.disabled}
                onChange={(event) => onUpdate({ [row.key]: event.target.checked })}
              />
              <span>
                <span className="block text-[13px] font-medium text-ink">{row.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">{row.hint}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {onOpenMini && (
        <div className="mt-2 flex items-center justify-between gap-4 border-t border-hairline pt-4">
          <p className="text-xs leading-5 text-muted">
            Die Mini-Ansicht zeigt Reserve, CPU, RAM und GPU in einem kleinen Fenster über allen anderen.
          </p>
          <button
            type="button"
            onClick={onOpenMini}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-hairline px-3 py-2 text-xs font-medium text-ink-2 hover:border-baseline hover:text-ink focus-visible:outline-2 focus-visible:outline-cpu"
          >
            <PanelTopOpen aria-hidden size={13} />
            Öffnen
          </button>
        </div>
      )}
    </Card>
  )
}
