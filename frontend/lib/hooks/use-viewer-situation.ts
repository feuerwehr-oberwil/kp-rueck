'use client'

import { useCallback, useMemo, useState } from 'react'
import { apiClient, type ApiViewerData } from '@/lib/api-client'
import { usePolling } from '@/lib/hooks/use-polling'
import { buildSituationData, viewerGroupsToIncidentGroups, type SituationData } from '@/lib/viewer-data'
import type { IncidentGroup } from '@/lib/types/groups'

/**
 * A share link's picture of the Ereignis, polled every 5 s: the same view-model the logged-in
 * display reads from its contexts, built from the token payload.
 *
 * `data` is null until the first answer. A failed poll keeps the last picture; hand
 * `lastRefresh` to `DisplayStaleBanner`, which says when it has gone stale. Never paused on
 * visibility – a display runs unattended.
 *
 * Usage: `const { data, groups, lastRefresh } = useViewerSituation(token)`
 */
export function useViewerSituation(token: string): {
  data: SituationData | null
  /** The payload's Aufträge – there is no groups context without a login. */
  groups: IncidentGroup[]
  lastRefresh: Date | null
} {
  const [payload, setPayload] = useState<ApiViewerData | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const load = useCallback(async () => {
    try {
      const answer = await apiClient.getViewerData(token)
      // A GET with no answer resolves to nothing: a failed poll, not an empty Ereignis.
      if (!answer) return
      setPayload(answer)
      setLastRefresh(new Date())
    } catch {
      // Keep the last picture; the stale banner says so.
    }
  }, [token])
  usePolling(load, { intervalMs: 5000, pauseWhenHidden: false })

  const data = useMemo(() => (payload ? buildSituationData(payload) : null), [payload])
  const groups = useMemo(() => (payload ? viewerGroupsToIncidentGroups(payload) : []), [payload])
  return { data, groups, lastRefresh }
}
