'use client'

/**
 * The Schadenplatz-Rapport in the incident detail (plan 25, decision 28, §6.1).
 *
 * A **full editing surface**, not a read-only view with a typo fix. An editor
 * can create a rapport for an incident that never had any field contact, fill
 * every field the form has, tick the material checklist and submit it — because
 * the normal case is a radio message: the crew has no signal, no phone, or no
 * hands, and dictates. A field surface whose data could only arrive through
 * that surface would make the KP a spectator to its own board.
 *
 * It mounts the **same** `FeldRapportForm` the field page uses, with a different
 * transport and identity. That is the whole rule: one component, two mounts.
 */

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'

import { FeldRapportForm, type RapportTransport } from '@/components/feld/feld-rapport-form'
import { MaterialReturnList } from '@/components/kanban/material-return-list'
import { apiClient } from '@/lib/api-client'
import type { ApiRapportUpdate, ApiSchadenplatzRapport } from '@/lib/api/types'

interface SchadenplatzRapportSectionProps {
  incidentId: string
  canEdit?: boolean
  /** The board already knows whether a rapport was filed — no extra request. */
  hasRapport?: boolean
}

export function SchadenplatzRapportSection({
  incidentId,
  canEdit = true,
  hasRapport = false,
}: SchadenplatzRapportSectionProps) {
  const t = useTranslations('feld.rapport')
  // Collapsed by default: the board is dense, and the rapport is the paperwork
  // end of an incident, not the thing an operator looks at during it.
  const [open, setOpen] = useState(false)
  const [returnKey, setReturnKey] = useState(0)

  const transport: RapportTransport = useMemo(
    () => ({
      load: () => apiClient.getIncidentRapport(incidentId),
      save: (update: ApiRapportUpdate) => apiClient.saveIncidentRapport(incidentId, update),
    }),
    [incidentId],
  )

  const handleSaved = useCallback((saved: ApiSchadenplatzRapport) => {
    // The return list only exists for a submitted rapport, so it has to be
    // refetched the moment one is filed.
    if (!saved.is_draft) setReturnKey(key => key + 1)
  }, [])

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-muted-foreground">{t('sectionTitle')}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {hasRapport ? t('stateSubmitted') : t('stateMissing')}
        </span>
      </button>

      {open && (
        <div className="rounded-lg border border-border p-4">
          <FeldRapportForm
            incidentId={incidentId}
            transport={transport}
            mount="kp"
            disabled={!canEdit}
            onSaved={handleSaved}
          />
        </div>
      )}

      {/* Outside the collapse on purpose: "Material zurück – freigeben" is the
          KP's own to-do, and hiding it behind the form would put it exactly
          where nobody looks at 02:00. Only fetched once a rapport has actually
          been filed — the list is empty for a draft by definition, and every
          incident detail opening would otherwise pay for a request that can
          only answer "nothing". */}
      {(hasRapport || returnKey > 0) && (
        <MaterialReturnList incidentId={incidentId} canEdit={canEdit} refreshKey={returnKey} />
      )}
    </div>
  )
}
