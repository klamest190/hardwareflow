import { useEffect, useState } from 'react'

import { loadAlertLog, loadHistory } from '../services/hardwareService'
import type { HistoryBucket, LoggedAlert } from '../types/hardware'

/** New buckets close once a minute; asking more often would only return the same list. */
const REFRESH_MS = 60_000

export interface StoredHistory {
  /** `null` while loading. */
  buckets: HistoryBucket[] | null
  alerts: LoggedAlert[]
}

/** The stored per-minute history and alert log, refreshed once a minute. */
export function useHistory(): StoredHistory {
  const [history, setHistory] = useState<StoredHistory>({ buckets: null, alerts: [] })

  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      Promise.all([loadHistory(), loadAlertLog()])
        .then(([buckets, alerts]) => {
          if (!cancelled) setHistory({ buckets, alerts })
        })
        .catch(() => {
          if (!cancelled) setHistory({ buckets: [], alerts: [] })
        })

    void refresh()
    const handle = setInterval(refresh, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [])

  return history
}
