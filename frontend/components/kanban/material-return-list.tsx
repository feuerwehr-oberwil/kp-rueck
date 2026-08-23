'use client'

/**
 * "Material zurück – freigeben" (plan 25, decision 17).
 *
 * A field form must not silently write assignments — that is the board's job,
 * and the reason the 409-conflict design in `operations-context` exists. So the
 * crew's checklist does not release anything; it produces this list, and the
 * operator clicks once. The hunting disappears, the decision stays with the KP.
 *
 * Today somebody works out by hand which of fourteen units are still out. This
 * is the part of the phase the KP feels first.
 *
 * Two exclusions that are not oversights:
 * * units the crew marked **vor Ort verblieben** are listed separately and are
 *   NOT in the release set — the pump genuinely is still in that cellar, and
 *   `unassigned_at` staying NULL is what feeds the Restliste (decision 15);
 * * **consumables** are in neither list. A consumable that was used is gone
 *   (decision 26).
 *
 * A third block, and the reason it exists (§18.35): "Weiteres gebrauchtes
 * Material" the crew left behind. Those are NAMES — improvised or borrowed
 * things the board never dispatched — so there is no assignment to free and no
 * button next to them. They are shown anyway, because the Abholliste is about
 * to send somebody to that address, and an operator who has just released four
 * pumps must not read the rest of this panel as "the address is clear".
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2, MapPin, PackageCheck, Undo2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api-client'
import type { ApiMaterialReturnUnit } from '@/lib/api/types'
import { useOperations } from '@/lib/contexts/operations-context'

interface MaterialReturnListProps {
  incidentId: string
  canEdit?: boolean
  /** Bumped by the parent whenever the rapport was saved, to refetch. */
  refreshKey?: number
}

export function MaterialReturnList({ incidentId, canEdit = true, refreshKey = 0 }: MaterialReturnListProps) {
  const t = useTranslations('feld.materialReturn')
  const { refreshOperations } = useOperations()
  const [returned, setReturned] = useState<ApiMaterialReturnUnit[]>([])
  const [leftOnSite, setLeftOnSite] = useState<ApiMaterialReturnUnit[]>([])
  const [leftOnSiteNamed, setLeftOnSiteNamed] = useState<string[]>([])
  const [releasing, setReleasing] = useState(false)

  const load = useCallback(async () => {
    try {
      // Submitted rapports only — no `includeDraft` here, deliberately
      // (§18.23). "Freigeben" on this list RELEASES assignments on one click,
      // and doing that against a checklist somebody is still filling in on a
      // phone is how a pump gets freed while it is running in a cellar. The
      // completion gate reads drafts because it only prefills a question the
      // operator then confirms; this list has no such second step.
      const data = await apiClient.getRapportMaterialReturn(incidentId)
      setReturned(data.returned)
      setLeftOnSite(data.left_on_site)
      setLeftOnSiteNamed(data.left_on_site_named ?? [])
    } catch (error) {
      console.error('Failed to load material return list:', error)
      setReturned([])
      setLeftOnSite([])
      setLeftOnSiteNamed([])
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

  if (returned.length === 0 && leftOnSite.length === 0 && leftOnSiteNamed.length === 0) return null

  // Unboxed («Nur Abstand»): its only production mount is the incident
  // detail's Rapport column, where the heading + whitespace do what the card
  // border used to.
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold">{t('title')}</h4>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>

      {returned.length > 0 && (
        <div className="space-y-2">
          <ul className="space-y-1">
            {returned.map(unit => (
              <li key={unit.assignment_id} className="flex items-center gap-2 text-sm">
                <PackageCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{unit.name}</span>
                {unit.used === false && <span className="text-xs text-muted-foreground">{t('notUsed')}</span>}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" disabled={!canEdit || releasing} onClick={releaseAll}>
            {releasing ? <Loader2 className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
            {t('releaseAll', { count: returned.length })}
          </Button>
        </div>
      )}

      {leftOnSite.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('stillOnSiteTitle')}</p>
          <ul className="space-y-1">
            {leftOnSite.map(unit => (
              <li key={unit.assignment_id} className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{unit.name}</span>
              </li>
            ))}
          </ul>
          {/* Says out loud why these are not in the button's set: the Ereignis
              stays open until somebody fetches them, and that is a feature. */}
          <p className="text-xs text-muted-foreground">{t('stillOnSiteHint')}</p>
        </div>
      )}

      {leftOnSiteNamed.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('namedTitle')}</p>
          <ul className="space-y-1">
            {leftOnSiteNamed.map(name => (
              <li key={name} className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{name}</span>
              </li>
            ))}
          </ul>
          {/* The asymmetry, spelled out: it is on the Abholliste and it will
              never be on the button, because a name has no assignment. */}
          <p className="text-xs text-muted-foreground">{t('namedHint')}</p>
        </div>
      )}
    </div>
  )
}
