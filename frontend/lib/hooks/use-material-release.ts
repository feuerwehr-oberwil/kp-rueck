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
 * in a cellar. `release` takes the assignment ids to free from the caller, which drops
 * whatever the form marks «vor Ort» right now – so a tick the autosave has not reached
 * the server yet can never be released. `loading` stays true until the set answers for
 * the latest `refreshKey` (i.e. the latest filed save); the caller keeps the button
 * disabled until then and while its own edits are unsaved, so a set from before an
 * edit is never clicked (Sol review round 2).
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
  /** The set has not answered for the latest save yet – do not offer it. */
  loading: boolean
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
  // The refreshKey the current `units` answer for; only the latest request may set it.
  const [loadedFor, setLoadedFor] = useState<number | null>(null)
  const latest = useRef(0)
  const [releasing, setReleasing] = useState(false)

  const load = useCallback(
    async (key: number) => {
      latest.current = key
      let next: ApiMaterialReturnUnit[] = []
      try {
        next = (await apiClient.getRapportMaterialReturn(incidentId)).returned
      } catch (error) {
        console.error('Failed to load material return list:', error)
      }
      // An older request answering late must not overwrite a newer one.
      if (latest.current !== key) return
      setUnits(next)
      setLoadedFor(key)
    },
    [incidentId],
  )

  // Not before a rapport is filed: the set is empty for a draft, and the detail mounts
  // this with every opening – a request that can only answer «nothing».
  useEffect(() => {
    if (enabled) void load(refreshKey)
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
        await load(latest.current)
        setReleasing(false)
      }
    },
    [incidentId, load, refreshOperations, t],
  )

  return { units: enabled ? units : [], loading: enabled && loadedFor !== refreshKey, releasing, release }
}
