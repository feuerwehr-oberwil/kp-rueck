"use client"

import { Package, Truck, User } from "lucide-react"
import { useTranslations } from "next-intl"
import { useOperations } from "@/lib/contexts/operations-context"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * A person, a vehicle and a Tauchpumpe are all single physical things — each can
 * only be in one place at a time. When an operator assigns one that is still on
 * another incident (see operations-context `resourceConflict`), this asks the
 * three questions that actually exist: *move* it here (release it there), *keep*
 * the double booking, or leave it alone.
 *
 * It was vehicles-only, and the other two kinds took the silent route instead —
 * assigning an already-assigned person or unit simply returned. That made the
 * assignment dialog's own «Doppelbelegung? Trotzdem zuweisen» a button that did
 * nothing, and it made a busy person undraggable rather than negotiable.
 *
 * Mounted once in the root layout so it covers every assignment entry point
 * (kanban drag-drop from the sidebars, map, command palette, context menu,
 * assignment dialog, Auftrag sheet).
 */
export function ResourceConflictPrompt() {
  const t = useTranslations('incidents.resourceConflict')
  const tCommon = useTranslations('incidents.common')
  const { resourceConflict, resolveResourceConflict, cancelResourceConflict } = useOperations()

  if (!resourceConflict) return null

  const { resourceType, resourceName, conflicts } = resourceConflict
  const conflictLabels = conflicts.map((c) => c.operationLabel)
  const Icon = resourceType === "vehicle" ? Truck : resourceType === "material" ? Package : User

  return (
    <AlertDialog open={true} onOpenChange={(open) => { if (!open) cancelResourceConflict() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {t('title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t.rich('alreadyAssigned', {
              name: resourceName,
              strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
            })}
            {conflictLabels.length === 1 ? (
              <> {t('assignedToSingle', { label: conflictLabels[0] })}</>
            ) : (
              <>
                {" "}{t('assignedToMultiple')}
                <span className="mt-1 block">
                  {conflictLabels.map((label) => (
                    <span key={label} className="block">{t('bullet', { label })}</span>
                  ))}
                </span>
              </>
            )}
            {" "}{t('question')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={cancelResourceConflict}>
            {tCommon('cancel')}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => resolveResourceConflict("keep")}>
              {t('keepBoth')}
            </Button>
            <Button onClick={() => resolveResourceConflict("move")}>
              {t('moveHere')}
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
