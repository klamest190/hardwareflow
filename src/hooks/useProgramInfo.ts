import { useEffect, useState } from 'react'

import type { ProgramInfo } from '../types/bridge'
import type { ProcessSummary } from '../types/hardware'

/**
 * Display names and icons for the programs in the process list, fetched from the main
 * process for paths it has not seen yet. Without the desktop bridge the map stays empty
 * and the list shows executable names.
 */
export function useProgramInfo(processes: ProcessSummary | null): Record<string, ProgramInfo> {
  const [info, setInfo] = useState<Record<string, ProgramInfo>>({})

  const paths = processes
    ? [...processes.byCpu, ...processes.byMemory].flatMap((group) => (group.path ? [group.path] : []))
    : []
  // A stable key, so the effect runs when the set of programs changes, not on every tick.
  const key = [...new Set(paths)].sort().join('|')

  useEffect(() => {
    const bridge = window.hardwareflow
    if (!bridge || key === '') return
    let current = true
    bridge
      .describePrograms(key.split('|'))
      .then((result) => {
        if (current) setInfo((previous) => ({ ...previous, ...result }))
      })
      .catch(() => {
        // Names and icons are a nicety; the list works without them.
      })
    return () => {
      current = false
    }
  }, [key])

  return info
}
