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
import { FileText } from 'lucide-react'

import { FeldRapportForm, type RapportTransport } from '@/components/feld/feld-rapport-form'
import { MaterialReturnList } from '@/components/kanban/material-return-list'
import { apiClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import type { ApiRapportUpdate, ApiSchadenplatzRapport } from '@/lib/api/types'

interface SchadenplatzRapportSectionProps {
  incidentId: string
  canEdit?: boolean
  /** The detail's own column is the frame — see `boxed` below. */
  boxed?: boolean
  /** The board already knows whether a rapport was filed — no extra request. */
  hasRapport?: boolean
  /** False while the Schadenplatz has never been disponiert (§18.27): the
   *  rapport does not exist yet, so the section states that instead of offering
   *  an empty form nobody can fill in meaningfully. Computed by the caller
   *  through `rapportApplies`, which never hides an already-filed rapport. */
  applies?: boolean
  /** Opt out of the built-in «Material zurück – freigeben» list. The incident
   *  detail sets this false and mounts `MaterialReturnList` itself, in the
   *  column that holds what came in from the field — the release is the KP's
   *  to-do, not part of the form. Every other mount (display modal) keeps the
   *  list here. Pair it with `onFiled` to know when to refetch. */
  showMaterialReturn?: boolean
  /** Fired when a rapport is saved as filed rather than a draft — the moment
   *  the material-return list stops being empty. Only of interest to a caller
   *  that renders that list itself. */
  onFiled?: () => void
  /** Passed straight to the form: put the cursor in the Kurzbericht when the
   *  operator was sent here to write it (Offene Rapporte, a notification). */
  autoFocusKurzbericht?: boolean
}

export function SchadenplatzRapportSection({
  incidentId,
  canEdit = true,
  hasRapport = false,
  applies = true,
  boxed = true,
  showMaterialReturn = true,
  onFiled,
  autoFocusKurzbericht,
}: SchadenplatzRapportSectionProps) {
  const t = useTranslations('feld.rapport')
  const [returnKey, setReturnKey] = useState(0)
  // The board's own flag is the starting point; the form knows sooner. Since
  // the KP mount files as it saves (§18.17) there is no submit click to hang
  // this on, so the state chip follows the save instead of the ~5 s poll.
  const [filed, setFiled] = useState(hasRapport)

  const transport: RapportTransport = useMemo(
    () => ({
      load: () => apiClient.getIncidentRapport(incidentId),
      save: (update: ApiRapportUpdate) => apiClient.saveIncidentRapport(incidentId, update),
      // The WhatsApp-photo case (§6.1): the crew has no signal for the form but
      // gets a picture out somehow, and the operator attaches it here. Same
      // storage and the same files as the field upload — only the door and the
      // provenance differ.
      photos: {
        upload: async (file: File) => (await apiClient.uploadRapportPhoto(incidentId, file)).filename ?? '',
        remove: async (filename: string) => {
          await apiClient.deleteRapportPhoto(incidentId, filename)
        },
      },
    }),
    [incidentId],
  )

  const handleSaved = useCallback((saved: ApiSchadenplatzRapport) => {
    setFiled(!saved.is_draft)
    // The return list only exists for a submitted rapport, so it has to be
    // refetched the moment one is filed — here, or by whoever mounts the list
    // in our place.
    if (!saved.is_draft) {
      setReturnKey(key => key + 1)
      onFiled?.()
    }
  }, [onFiled])

  return (
    <div className="space-y-3">
      {/* Always open, like the Reko-Meldungen beside it. It was collapsed by
          default on the theory that the rapport is paperwork nobody looks at
          during an incident — but the Rapport tab IS that click, and a form
          behind a second one is a form that does not get filled. Nothing about
          the collapse is persisted, so there is no stored flag to clear. */}
      <div className="flex w-full items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-muted-foreground">{t('sectionTitle')}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {!applies ? t('stateNotDispatched') : filed ? t('stateSubmitted') : t('stateMissing')}
        </span>
      </div>

      {/* Nothing was ever sent to this Schadenplatz, so there is nothing to
          report on. One sentence rather than a form: the empty rapport was the
          noise, and the sentence is what turns "where is my form" into "ah,
          this one was never disponiert". The section header stays so the tab
          does not lose the thing the operator came looking for. */}
      {!applies ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('notDispatched')}
        </p>
      ) : (
        // No box in the detail: the tab column already frames this, and the
        // form's own blocks are boxes too — three borders around one form.
        <div className={cn(boxed && "rounded-lg border border-border p-4")}>
          <FeldRapportForm
            incidentId={incidentId}
            transport={transport}
            mount="kp"
            disabled={!canEdit}
            onSaved={handleSaved}
            autoFocusKurzbericht={autoFocusKurzbericht}
          />
        </div>
      )}

      {/* Outside the collapse on purpose: "Material zurück – freigeben" is the
          KP's own to-do, and hiding it behind the form would put it exactly
          where nobody looks at 02:00. Only fetched once a rapport has actually
          been filed — the list is empty for a draft by definition, and every
          incident detail opening would otherwise pay for a request that can
          only answer "nothing".
          The incident detail opts out (`showMaterialReturn={false}`) and puts
          the same list in its own left column, next to the field's messages. */}
      {showMaterialReturn && (filed || returnKey > 0) && (
        <MaterialReturnList incidentId={incidentId} canEdit={canEdit} refreshKey={returnKey} />
      )}
    </div>
  )
}
