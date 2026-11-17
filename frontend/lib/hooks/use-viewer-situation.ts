'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { apiClient, ApiError, type ApiViewerData } from '@/lib/api-client'
import { usePolling } from '@/lib/hooks/use-polling'
import { buildSituationData, viewerGroupsToIncidentGroups } from '@/lib/viewer-data'

/** The layout keys its poll by token so changing links drops the old event immediately. */
export function useViewerFeed(token: string | null) {
  const [snapshot, setSnapshot] = useState<{ payload: ApiViewerData; received: Date } | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'retrying' | 'invalid'>('loading')
  const load = useCallback(async () => {
    if (!token) return
    try {
      const payload = await apiClient.getViewerData(token)
      if (payload) {
        setSnapshot({ payload, received: new Date() })
        setStatus('ready')
        return
      }
    } catch (error) {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        setSnapshot(null)
        setStatus('invalid')
        return
      }
    }
    setStatus('retrying')
  }, [token])
  usePolling(load, { intervalMs: 5000, pauseWhenHidden: false, enabled: !!token && status !== 'invalid' })
  return { snapshot, status }
}

/** Only mounted below the layout's successful-load gate, including during a transient outage. */
export const ViewerPayloadContext = createContext<ApiViewerData | null>(null)

export function useViewerSituation() {
  const payload = useContext(ViewerPayloadContext)
  if (!payload) throw new Error('A shared display needs a viewer payload')
  const data = useMemo(() => buildSituationData(payload), [payload])
  const groups = useMemo(() => viewerGroupsToIncidentGroups(payload), [payload])
  return { data, groups, payload }
}
