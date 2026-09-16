import { useEffect, useState } from 'react'

import { loadHistory } from '../services/hardwareService'
import type { HistoryBucket } from '../types/hardware'

/** New buckets close once a minute; asking more often would only return the same list. */
const REFRESH_MS = 60_000

/** The stored per-minute history, refreshed once a minute. `null` while loading. */
export function useHistory(): HistoryBucket[] | null {
  const [buckets, setBuckets] = useState<HistoryBucket[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = () =>
      loadHistory()
        .then((next) => {
          if (!cancelled) setBuckets(next)
        })
        .catch(() => {
          if (!cancelled) setBuckets([])
        })

    void refresh()
    const handle = setInterval(refresh, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [])

  return buckets
}
