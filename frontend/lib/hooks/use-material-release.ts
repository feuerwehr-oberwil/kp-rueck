'use client'

/**
 * «N Geräte freigeben» (plan 25, decision 17): the units the KP may release for one
 * incident, and the one click that releases them.
 *
 * A field form must not silently write assignments — that is the board's job, and the
 * reason the 409-conflict design in `operations-context` exists. So the crew's checklist
 * does not release anything; it produces this set, and the operator clicks once.
 *
 * The set comes from the server (`GET …/rapport/material-return`): units still assigned
 * here that the FILED rapport did not mark «vor Ort verblieben», consumables never.
 * Submitted rapports only, deliberately (§18.23): the click RELEASES, and doing that
 * against a checklist somebody is still filling in is how a pump gets freed while it runs
 * in a cellar. The form offers only the part of this set its own checklist also calls back,
 * so neither a stale set nor an unsaved answer can free a unit kept on site.
 *
 * Used by `SchadenplatzRapportSection` (editor + filed rapport only); it bumps
 * `refreshKey` whenever a save files the rapport.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { apiClient } from '@/lib/api-client'
import type { ApiMaterialReturnUnit } from '@/lib/api/types'
import { useOperations } from '@/lib/contexts/operations-context'

export interface MaterialRelease {
  /** The server's release set, before the caller drops what the form marks «vor Ort». */
  units: ApiMaterialReturnUnit[]
  releasing: boolean
  /** Release exactly these assignments, one board release each, then reload. */
  release: (assignmentIds: readonly string[]) => Promise<void>
}

export function useMaterialRelease(
  incidentId: string,
  { enabled, refreshKey }: { enabled: boolean; refreshKey: number },
): MaterialRelease {
  const t = useTranslations('feld.materialReturn')
  const { refreshOperations } = useOperations()
  const [units, setUnits] = useState<ApiMaterialReturnUnit[]>([])
  // Only the newest request may set `units` – a sequence number, since a save and a release
  // can ask at the same time.
  const requestSeq = useRef(0)
  const [releasing, setReleasing] = useState(false)

  const load = useCallback(
    async () => {
      const seq = ++requestSeq.current
      let next: ApiMaterialReturnUnit[] = []
      try {
        next = (await apiClient.getRapportMaterialReturn(incidentId)).returned
      } catch (error) {
        console.error('Failed to load material return list:', error)
      }
      // An older request answering late must not overwrite a newer one.
      if (seq !== requestSeq.current) return
      setUnits(next)
    },
    [incidentId],
  )

  // Not before a rapport is filed: the set is empty for a draft, and the detail mounts
  // this with every opening – a request that can only answer «nothing». `refreshKey` is
  // only a trigger: a new filed save asks again.
  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load, refreshKey])

  const release = useCallback(
    async (assignmentIds: readonly string[]) => {
      if (assignmentIds.length === 0) return
      setReleasing(true)
      try {
        // The existing per-assignment release — no new endpoint, and every unit gets its
        // own audit entry the way any other board release does.
        for (const id of assignmentIds) await apiClient.unassignResource(incidentId, id)
        toast.success(t('released', { count: assignmentIds.length }))
        await refreshOperations()
      } catch (error) {
        console.error('Failed to release returned material:', error)
        toast.error(t('releaseFailed'))
      } finally {
        await load()
        setReleasing(false)
      }
    },
    [incidentId, load, refreshOperations, t],
  )

  return { units: enabled ? units : [], releasing, release }
}
