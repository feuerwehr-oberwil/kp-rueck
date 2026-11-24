"use client"

import { ArrowRightLeft, Clock, Package, Truck, User } from "lucide-react"
import { useTranslations } from "next-intl"
import type { ReactNode } from "react"
import { useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { usePlanned } from "@/lib/contexts/planned-context"
import { drivenElsewhere } from "@/lib/driver-conflict"
import { getIncidentRefParts } from "@/lib/incident-types"
import { ChoiceDiagram, ChoiceDialog, type MiniCard, type MiniChipTone } from "@/components/ui/choice-dialog"

const strong = (chunks: ReactNode) => <strong className="font-semibold text-foreground">{chunks}</strong>

/**
 * A person, a vehicle and a Tauchpumpe are all single physical things — each can
 * only be in one place at a time. When an operator assigns one that is still on
 * another incident or Auftrag (see operations-context `resourceConflict`), this asks the
 * three questions that actually exist: move it here **Jetzt** (release it there), plan it
 * **Danach** here (it stays where it works; «Zuteilen» comes once it is free), or leave it
 * alone. A resource is Jetzt on one holder only (owner pick 2B, 24.11.2026): «Auf beiden
 * führen» is gone, and the server refuses a second one (409 `resource_busy`).
 *
 * Leaving it alone is the default for every resource (owner pick #3, 23.11.2026: «cancel is
 * default. move or auf beiden needs to be clearly described and manually selected»). The two
 * changes are choice cards (`ChoiceDialog`): a mini before/after of the cards and one sentence
 * each, a click or the card's letter (V / D) runs it, Enter and Esc change nothing. A resource
 * that already has a Danach says so: a new one queues behind. A consumable never gets here –
 * several incidents draw from the same Bindemittel.
 *
 * It is THE dialog for that question, from every entry point: kanban drag-drop, map, command
 * palette, context menu, assignment dialog, Auftrag sheet.
 *
 * A Fahrer is also wherever the vehicle they drive stands: that Einsatz is a «from» card too
 * («fährt Mowa», added when the entry point only knew the crew rows), and the move sentence says
 * it releases the role (lib/driver-conflict.ts).
 *
 * Mounted once in the root layout.
 */
export function ResourceConflictPrompt() {
  const t = useTranslations('incidents.resourceConflict')
  const tCommon = useTranslations('incidents.common')
  const { resourceConflict, resolveResourceConflict, cancelResourceConflict, operations, personnel } = useOperations()
  const { groups } = useGroups()
  const { queueOf } = usePlanned()

  if (!resourceConflict) return null

  const { resourceType, resourceName, targetOperationId, targetOperationLabel } = resourceConflict
  const count = resourceConflict.resourceCount ?? 1
  const Icon = resourceType === "vehicle" ? Truck : resourceType === "material" ? Package : User
  const driving = resourceType === "personnel"
    ? drivenElsewhere(personnel.find((p) => p.id === resourceConflict.resourceId), operations, targetOperationId)
    : null
  const drivenOp = driving ? operations.find((op) => op.id === driving.operationId) : undefined
  const conflicts: NonNullable<typeof resourceConflict>["conflicts"] =
    drivenOp && !resourceConflict.conflicts.some((c) => c.operationId === drivenOp.id)
      ? [...resourceConflict.conflicts, { operationId: drivenOp.id, operationLabel: getIncidentRefParts(drivenOp).head }]
      : resourceConflict.conflicts

  // The description names where it stands (and what it drives there); the sentences name it plain.
  const fromNamed = conflicts
    .map((c) => (driving?.operationId === c.operationId ? `${c.operationLabel} (${t('drives', { vehicle: driving.vehicleName })})` : c.operationLabel))
    .join(", ")
  const from = conflicts.map((c) => c.operationLabel).join(", ")
  const names = { name: resourceName, count, from, to: targetOperationLabel }
  // Where it is planned Danach already – a new plan goes to the end of that queue.
  const queued = queueOf(resourceType, resourceConflict.resourceId).map((plan) => {
    const holderId = plan.incident_id ?? plan.incident_group_id
    const op = operations.find((o) => o.id === holderId)
    return op ? getIncidentRefParts(op).head : (groups.find((g) => g.id === holderId)?.name ?? "")
  })

  // What stands on each holder: one drop of a Modul-Block asks once, but its devices can sit on
  // different cards (`held`). The target gets all of them.
  const heldOn = (c: (typeof conflicts)[number]) => c.held ?? [{ id: resourceConflict.resourceId, name: resourceName }]
  const everything = [...new Map(conflicts.flatMap(heldOn).map((r) => [r.id, r])).values()]
  const card = (id: string, title: string, tone: MiniChipTone, resources: { id: string; name: string }[]): MiniCard => ({
    id,
    title,
    chips: resources.map((r) => ({ label: tone === "danach" ? t('danachChip', { name: r.name }) : r.name, tone })),
  })

  return (
    // Every answer clears the conflict itself (resolve/cancel) – the caller closes.
    <ChoiceDialog
      onCancel={cancelResourceConflict}
      icon={<Icon className="h-5 w-5 text-muted-foreground" />}
      title={t('titleNamed', { name: resourceName, count })}
      description={t.rich('description', { ...names, from: fromNamed, strong })}
      cancelText={tCommon('cancel')}
      choices={[
        {
          shortcut: t('moveKey'),
          label: t('moveHere'),
          icon: <ArrowRightLeft aria-hidden />,
          diagram: (
            <ChoiceDiagram
              link="move"
              from={conflicts.map((c) => card(c.operationId, c.operationLabel, "gone", heldOn(c)))}
              to={card(targetOperationId, targetOperationLabel, "plain", everything)}
            />
          ),
          consequence: driving
            ? t.rich('moveConsequenceDriver', { ...names, vehicle: driving.vehicleName, strong })
            : t.rich('moveConsequence', { ...names, strong }),
          onSelect: () => resolveResourceConflict("move"),
        },
        {
          shortcut: t('planKey'),
          label: t('planNext'),
          icon: <Clock aria-hidden />,
          diagram: (
            <ChoiceDiagram
              link="next"
              from={conflicts.map((c) => card(c.operationId, c.operationLabel, "plain", heldOn(c)))}
              to={card(targetOperationId, targetOperationLabel, "danach", everything)}
            />
          ),
          consequence: (
            <>
              {t.rich('planConsequence', { ...names, strong })}
              {queued.length > 0 && <> {t('queued', { list: queued.join(", ") })}</>}
            </>
          ),
          onSelect: () => resolveResourceConflict("plan"),
        },
      ]}
    />
  )
}
