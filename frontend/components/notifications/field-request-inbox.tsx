'use client'

/**
 * «Vom Feld – offen»: the field's requests as the top section of the
 * notification sidebar (R13).
 *
 * A request stays here until somebody handles it — closing a notification
 * never does. Its bell entry is not listed a second time below (the context's
 * `representedIds`), so one Meldung is one row. The row opens the incident on
 * the tab the list lives on; its buttons work the request in place, and
 * «Material zuteilen» / «Personal zuteilen» open the board's assignment dialog
 * when the board is the page that is open.
 */

import { useTranslations } from 'next-intl'
import { ClipboardList } from 'lucide-react'

import { FieldRequestItem } from '@/components/kanban/field-requests'
import { useAuth } from '@/lib/contexts/auth-context'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useFieldRequestActions, type OpenFieldRequest } from '@/lib/hooks/use-field-requests'
import { getIncidentLocationLabel } from '@/lib/incident-types'

export function FieldRequestInbox({
  items,
  onOpenIncident,
}: {
  items: OpenFieldRequest[]
  onOpenIncident?: (incidentId: string) => void
}) {
  const t = useTranslations('feld.requests')
  const { isEditor } = useAuth()
  const { assignAction } = useNotifications()
  const { setStatus, markSeen, canMarkSeen, busyId } = useFieldRequestActions()

  if (items.length === 0) return null

  return (
    <section aria-labelledby="field-request-inbox-title">
      <div className="mb-2 flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 id="field-request-inbox-title" className="text-sm font-semibold text-foreground" title={t('sidebarHint')}>
          {t('sidebarTitle')}
        </h3>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning/15 px-1.5 text-xs font-bold text-warning-foreground">
          {items.length}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map(({ request, operation }) => (
          <FieldRequestItem
            key={request.id}
            request={request}
            canEdit={isEditor}
            place={getIncidentLocationLabel(operation)}
            onAssign={assignAction ?? undefined}
            busy={busyId === request.id}
            onSetStatus={(r, status) => void setStatus(r, status)}
            onMarkSeen={canMarkSeen ? r => void markSeen(r) : undefined}
            onOpen={onOpenIncident ? () => onOpenIncident(request.incident_id) : undefined}
          />
        ))}
      </ul>
    </section>
  )
}
