'use client'

/**
 * «N Geräte freigeben» (plan 25, decision 17) – the KP's one click under «Zurück»
 * in the rapport's Material block (`FeldMaterialChecklist`, `grouped`).
 *
 * A field form must not silently write assignments — that is the board's job,
 * and the reason the 409-conflict design in `operations-context` exists. So the
 * crew's checklist does not release anything; it produces this set, and the
 * operator clicks once. The hunting disappears, the decision stays with the KP.
 *
 * The set comes from the server, not from the chips: it is the units still
 * assigned here that the FILED rapport did not mark «vor Ort verblieben»
 * (consumables never – a used consumable is gone, decision 26). What stays on
 * site, and the names the crew typed, are the chips' own «Noch vor Ort» group;
 * a name has no assignment and is never in this set (§18.35).
 *
 * Renders nothing while there is nothing to release.
 *
 * Used by `SchadenplatzRapportSection`, which bumps `refreshKey` whenever a save
 * files the rapport.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'
import type { ApiMaterialReturnUnit } from '@/lib/api/types'
import { useOperations } from '@/lib/contexts/operations-context'
import { ShellLoader } from '@/components/ui/shell-loader'

interface MaterialReleaseProps {
  incidentId: string
  /** Bumped by the parent whenever the rapport was saved, to refetch. */
  refreshKey?: number
}

export function MaterialRelease({ incidentId, refreshKey = 0 }: MaterialReleaseProps) {
  const t = useTranslations('feld.materialReturn')
  const { refreshOperations } = useOperations()
  const [returned, setReturned] = useState<ApiMaterialReturnUnit[]>([])
  const [releasing, setReleasing] = useState(false)

  const load = useCallback(async () => {
    try {
      // Submitted rapports only — no `includeDraft` here, deliberately
      // (§18.23). The button RELEASES assignments on one click, and doing that
      // against a checklist somebody is still filling in on a phone is how a
      // pump gets freed while it is running in a cellar.
      const data = await apiClient.getRapportMaterialReturn(incidentId)
      setReturned(data.returned)
    } catch (error) {
      console.error('Failed to load material return list:', error)
      setReturned([])
    }
  }, [incidentId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const releaseAll = async () => {
    if (returned.length === 0) return
    setReleasing(true)
    try {
      // One call per assignment through the existing per-assignment release —
      // no new endpoint, and every unit gets its own audit entry the way any
      // other board release does.
      for (const unit of returned) {
        await apiClient.unassignResource(incidentId, unit.assignment_id)
      }
      toast.success(t('released', { count: returned.length }))
      await refreshOperations()
      await load()
    } catch (error) {
      console.error('Failed to release returned material:', error)
      toast.error(t('releaseFailed'))
      await load()
    } finally {
      setReleasing(false)
    }
  }

  if (returned.length === 0) return null

  // Names the set, so the click is not a blind one: an unused unit is in it too.
  const names = returned
    .map(unit => (unit.used === false ? `${unit.name} (${t('notUsed')})` : unit.name))
    .join(', ')
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Button size="sm" variant="outline" disabled={releasing} onClick={releaseAll}>
        {releasing ? <ShellLoader className="size-3.5" /> : <Undo2 className="size-3.5" />}
        {t('releaseAll', { count: returned.length })}
      </Button>
      <p className="min-w-0 text-xs text-muted-foreground">{t('stillAssigned', { names })}</p>
    </div>
  )
}
