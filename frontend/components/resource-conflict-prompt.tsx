"use client"

import { ArrowRightLeft, Copy, Package, Truck, User } from "lucide-react"
import { useTranslations } from "next-intl"
import type { ReactNode } from "react"
import { useOperations } from "@/lib/contexts/operations-context"
import { drivenElsewhere } from "@/lib/driver-conflict"
import { getIncidentRefParts } from "@/lib/incident-types"
import { ChoiceDiagram, ChoiceDialog, type MiniCard } from "@/components/ui/choice-dialog"

const strong = (chunks: ReactNode) => <strong className="font-semibold text-foreground">{chunks}</strong>

/**
 * A person, a vehicle and a Tauchpumpe are all single physical things — each can
 * only be in one place at a time. When an operator assigns one that is still on
 * another incident (see operations-context `resourceConflict`), this asks the
 * three questions that actually exist: *move* it here (release it there), *keep*
 * the double booking, or leave it alone.
 *
 * Leaving it alone is the default for every resource (owner pick #3, 23.11.2026: «cancel is
 * default. move or auf beiden needs to be clearly described and manually selected»). The two
 * changes are choice cards (`ChoiceDialog`): a mini before/after of the cards and one sentence
 * each, a click or the card's letter (V / B) runs it, Enter and Esc change nothing. A consumable
 * never gets here – several incidents draw from the same Bindemittel.
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

  if (!resourceConflict) return null

  const { resourceType, resourceName, targetOperationId, targetOperationLabel } = resourceConflict
  const count = resourceConflict.resourceCount ?? 1
  const Icon = resourceType === "vehicle" ? Truck : resourceType === "material" ? Package : User
  const driving = resourceType === "personnel"
    ? drivenElsewhere(personnel.find((p) => p.id === resourceConflict.resourceId), operations, targetOperationId)
    : null
  const drivenOp = driving ? operations.find((op) => op.id === driving.operationId) : undefined
  const conflicts: { operationId: string; operationLabel: string }[] =
    drivenOp && !resourceConflict.conflicts.some((c) => c.operationId === drivenOp.id)
      ? [...resourceConflict.conflicts, { operationId: drivenOp.id, operationLabel: getIncidentRefParts(drivenOp).head }]
      : resourceConflict.conflicts

  // The description names where it stands (and what it drives there); the sentences name it plain.
  const fromNamed = conflicts
    .map((c) => (driving?.operationId === c.operationId ? `${c.operationLabel} (${t('drives', { vehicle: driving.vehicleName })})` : c.operationLabel))
    .join(", ")
  const from = conflicts.map((c) => c.operationLabel).join(", ")
  const names = { name: resourceName, count, from, to: targetOperationLabel }
  // Each holder card plus the target: «2×» on two cards, «3×» on three.
  const cards = conflicts.length + 1

  const card = (id: string, title: string, tone: MiniCard["chips"][number]["tone"], label = resourceName): MiniCard => ({
    id,
    title,
    chips: [{ label, tone }],
  })
  const doubled = `${resourceName} · ${cards}×`

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
              from={conflicts.map((c) => card(c.operationId, c.operationLabel, "gone"))}
              to={card(targetOperationId, targetOperationLabel, "plain")}
            />
          ),
          consequence: driving
            ? t.rich('moveConsequenceDriver', { ...names, vehicle: driving.vehicleName, strong })
            : t.rich('moveConsequence', { ...names, strong }),
          onSelect: () => resolveResourceConflict("move"),
        },
        {
          shortcut: t('keepKey'),
          label: t('keepBoth'),
          icon: <Copy aria-hidden />,
          diagram: (
            <ChoiceDiagram
              link="both"
              from={conflicts.map((c) => card(c.operationId, c.operationLabel, "double", doubled))}
              to={card(targetOperationId, targetOperationLabel, "double", doubled)}
            />
          ),
          consequence: t.rich('keepConsequence', { ...names, cards, strong }),
          onSelect: () => resolveResourceConflict("keep"),
        },
      ]}
    />
  )
}
