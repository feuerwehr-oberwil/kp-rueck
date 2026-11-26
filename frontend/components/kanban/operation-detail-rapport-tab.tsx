"use client"

import { FieldMessageThread, FieldReportsRow } from "@/components/kanban/field-reports-row"
import { FieldRequestList } from "@/components/kanban/field-requests"
import { SchadenplatzRapportSection } from "@/components/kanban/schadenplatz-rapport-section"
import { type Operation } from "@/lib/contexts/operations-context"
import { type IncidentTimelineState } from "@/lib/hooks/use-incident-timeline"
import { rapportApplies } from "@/lib/rapport-visibility"
import { cn } from "@/lib/utils"
import { detailTabLayout, type DetailLayout } from "@/components/kanban/operation-detail-tab-layout"

/**
 * The Feld tab (value `rapport`): what came in from the field on the left —
 * Abholung, Anforderungen, the crew's messages — and the Schadenplatz-Rapport
 * on the right. Rendered by `OperationDetailContent` inside its force-mounted
 * Feld tab panel; `timeline` is the detail's `useIncidentTimeline`, shared with
 * Verlauf.
 */
export function RapportTab({
  operation,
  layout,
  canEdit,
  acceptsAssignments,
  timeline,
  autoFocusKurzbericht,
  onAssignResource,
}: {
  operation: Operation
  layout: DetailLayout
  canEdit: boolean
  acceptsAssignments: boolean
  timeline: IncidentTimelineState
  autoFocusKurzbericht: boolean
  onAssignResource?: (resourceType: 'crew' | 'vehicles' | 'materials', operationId: string, search?: string) => void
}) {
  const { sectionStep, tabGridClass, tabColumnBreakClass } = detailTabLayout(layout)

  return (
    <div className={tabGridClass}>
      <div className={sectionStep.stack}>
        {/* Feldmeldungen — KP parity (decision 28). Everything a crew taps
            on /feld, an operator enters here from a radio message.
            «Reko vor Ort» lives on the Reko tab with the rest of the
            reconnaissance. */}
        <FieldReportsRow operation={operation} canEdit={canEdit} only={['pickup']} />

        {/* Everything the field asked for, with its state (R13): offen →
            in Arbeit → erledigt, who and when. «Material zuweisen» opens
            the same assignment dialog as the «+» on the resource rows. */}
        <FieldRequestList
          operation={operation}
          canEdit={canEdit}
          onAssign={
            canEdit && onAssignResource && acceptsAssignments
              ? (incidentId, resourceType, search) => onAssignResource(resourceType, incidentId, search)
              : undefined
          }
        />

        {/* Everything the crew said, plus the two reports that used to be
            toggles (§18.19). Before this thread existed a Meldung became a
            notification and an audit entry and showed up on the incident
            nowhere at all — dismiss the bell and it was gone. */}
        <FieldMessageThread
          operation={operation}
          events={timeline.events}
          isLoading={timeline.isLoading}
          failed={timeline.failed}
          onRetry={timeline.reload}
          canEdit={canEdit}
        />
      </div>

      {/* Stacked (docked panel, narrow modal), a rule above the rapport
          says where the field's messages end and the rapport begins. */}
      <div className={cn(tabColumnBreakClass, "border-t border-border pt-4", layout === 'modal' && "lg:border-t-0 lg:pt-0")}>
      {/* The Schadenplatz-Rapport itself, as a FULL editing surface: the KP
          must be able to file one for an incident that never had any field
          contact. Same form component /feld mounts, different transport. */}
      <SchadenplatzRapportSection
        incidentId={operation.id}
        canEdit={canEdit}
        boxed={false}
        hasRapport={operation.hasSchadenplatzRapport}
        activeAssignmentIds={[...operation.materialAssignments.values()]}
        // Only when the detail was OPENED on this tab — from Offene
        // Rapporte or a notification, i.e. somebody was sent here to write
        // it. Clicking «Rapport» by hand leaves the cursor alone: stealing
        // focus from someone who came to read is its own bug.
        autoFocusKurzbericht={autoFocusKurzbericht}
        // No rapport before the Schadenplatz was disponiert (§18.27).
        // Same gate on both shapes of the detail, because it is the same
        // component — and on the card and the Restliste through the same
        // helper.
        applies={rapportApplies({
          hasBeenDispatched: operation.hasBeenDispatched,
          status: operation.status,
          hasReport: operation.hasSchadenplatzRapport || operation.hasSchadenplatzRapportDraft,
          // «Kein Einsatz nötig» + closed = no rapport is due (§P2.7).
          rekoNotRelevant: operation.rekoSummary?.isRelevant === false,
        })}
      />
      </div>
    </div>
  )
}
