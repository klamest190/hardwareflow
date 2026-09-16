import { useCallback, useEffect, useState } from 'react'

import type { DesktopSettings } from '../types/bridge'

/** Desktop settings from the main process; `null` in the browser, where none exist. */
export function useDesktopSettings() {
  const [settings, setSettings] = useState<DesktopSettings | null>(null)

  useEffect(() => {
    void window.hardwareflow?.getSettings().then(setSettings)
  }, [])

  const update = useCallback((patch: Partial<DesktopSettings>) => {
    void window.hardwareflow?.updateSettings(patch).then(setSettings)
  }, [])

  return { settings, update }
}
