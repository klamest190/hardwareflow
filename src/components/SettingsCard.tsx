import { PanelTopOpen, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { ALERT_THRESHOLD_LIMITS, DEFAULT_ALERT_THRESHOLDS } from '../lib/alerts'
import type { DesktopSettings } from '../types/bridge'
import type { AlertThresholds } from '../types/hardware'
import { Card } from './ui/Card'

interface SettingsCardProps {
  /** `null` in the browser, where the desktop settings do not exist. */
  settings: DesktopSettings | null
  onUpdate: (patch: Partial<DesktopSettings>) => void
  onOpenMini: (() => void) | null
  className?: string
}

const THRESHOLD_FIELDS: Array<{ key: keyof AlertThresholds; label: string; unit: string; hint: string }> = [
  { key: 'cpuTempC', label: 'CPU-Temperatur', unit: '°C', hint: 'für 60 s · braucht LHM' },
  { key: 'gpuTempC', label: 'GPU-Temperatur', unit: '°C', hint: 'für 30 s' },
  { key: 'memoryPercent', label: 'Arbeitsspeicher belegt', unit: '%', hint: 'für 60 s' },
  { key: 'systemDriveFreePercent', label: 'Systemlaufwerk frei unter', unit: '%', hint: 'sofort' },
  { key: 'systemDriveFreeGb', label: 'oder frei unter', unit: 'GB', hint: 'sofort' },
  { key: 'batteryPercent', label: 'Akku ohne Netzteil unter', unit: '%', hint: 'sofort' },
]

/**
 * A number field that commits on blur or Enter, not on every keystroke — typing "90"
 * would otherwise briefly set the limit to 9 and could fire a warning in between.
 */
function ThresholdInput({
  value,
  min,
  max,
  label,
  onCommit,
}: {
  value: number
  min: number
  max: number
  label: string
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [shown, setShown] = useState(value)
  // A saved value that changed from outside (the clamp, a reset) replaces the draft.
  if (shown !== value) {
    setShown(value)
    setDraft(String(value))
  }

  const commit = () => {
    const parsed = Number(draft.replace(',', '.'))
    if (Number.isFinite(parsed) && draft.trim() !== '') onCommit(parsed)
    else setDraft(String(value))
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className="hf-figure w-20 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-right text-sm text-ink focus-visible:border-signal"
    />
  )
}

/** An on/off setting as a switch: the state is the position, and the label says what it does. */
function Switch({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className={`flex items-start justify-between gap-6 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="mt-0.5 block max-w-[68ch] text-sm text-muted">{hint}</span>
      </span>
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span
          aria-hidden
          className="block h-5 w-9 rounded-full border border-baseline bg-surface-2 transition-colors peer-checked:border-signal peer-checked:bg-signal peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal"
        />
        <span
          aria-hidden
          className="absolute top-[3px] left-[3px] size-3.5 rounded-full bg-ink-2 transition-transform peer-checked:translate-x-4 peer-checked:bg-plane motion-reduce:transition-none"
        />
      </span>
    </label>
  )
}

/** The desktop behaviour: autostart, notifications, tray. Mirrors the tray menu. */
export function SettingsCard({ settings, onUpdate, onOpenMini, className }: SettingsCardProps) {
  if (!settings) {
    return (
      <Card subtitle="Nur in der Desktop-App" className={className}>
        <p className="text-sm text-muted">
          Autostart, Benachrichtigungen und das Tray-Symbol gibt es nur in der Desktop-App. Im Browser läuft der
          Simulator.
        </p>
      </Card>
    )
  }

  const rows: Array<{
    key: 'autostart' | 'notifications' | 'closeToTray'
    label: string
    hint: string
    disabled?: boolean
  }> = [
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
    <Card title="Verhalten" subtitle="Was die App tut, während sie nicht im Vordergrund ist" className={className}>
      <ul className="divide-y divide-hairline">
        {rows.map((row) => (
          <li key={row.key} className="py-3.5 first:pt-0">
            <Switch
              label={row.label}
              hint={row.hint}
              checked={settings[row.key]}
              disabled={row.disabled}
              onChange={(checked) => onUpdate({ [row.key]: checked })}
            />
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-hairline pt-4">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-md font-semibold text-ink">Warnschwellen</h3>
          <button
            type="button"
            onClick={() => onUpdate({ thresholds: DEFAULT_ALERT_THRESHOLDS })}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
          >
            <RotateCcw aria-hidden size={13} />
            Auf Standard zurücksetzen
          </button>
        </div>
        <p className="mt-0.5 text-sm text-muted">
          Gelten für das Banner im Dashboard und für die Benachrichtigungen gleichermaßen.
        </p>
        <ul className="mt-4 grid gap-x-10 gap-y-3 sm:grid-cols-2">
          {THRESHOLD_FIELDS.map((field) => {
            const limits = ALERT_THRESHOLD_LIMITS[field.key]
            return (
              <li key={field.key} className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm text-ink-2">{field.label}</span>
                  <span className="block text-xs text-muted">
                    {field.hint} · {limits.min}–{limits.max}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <ThresholdInput
                    value={settings.thresholds[field.key]}
                    min={limits.min}
                    max={limits.max}
                    label={`${field.label} in ${field.unit}`}
                    onCommit={(value) => onUpdate({ thresholds: { ...settings.thresholds, [field.key]: value } })}
                  />
                  <span className="w-6 text-xs text-muted">{field.unit}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      {onOpenMini && (
        <div className="mt-2 flex items-center justify-between gap-4 border-t border-hairline pt-4">
          <p className="text-sm text-muted">
            Die Mini-Ansicht zeigt Reserve, CPU, RAM und GPU in einem kleinen Fenster über allen anderen.
          </p>
          <button
            type="button"
            onClick={onOpenMini}
            className="flex shrink-0 items-center gap-2 rounded-md border border-hairline px-3 py-1.5 text-sm text-ink-2 hover:border-baseline hover:text-ink"
          >
            <PanelTopOpen aria-hidden size={14} />
            Mini-Ansicht öffnen
          </button>
        </div>
      )}

      <p className="mt-4 border-t border-hairline pt-3 text-xs text-muted tabular-nums">
        HardwareFlow {settings.version}
      </p>
    </Card>
  )
}
