"use client"

import { Truck } from "lucide-react"
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
 * A vehicle is a single physical asset — it can only be in one place at a
 * time. When an operator assigns a vehicle that is still assigned to one or
 * more other incidents (see operations-context `vehicleConflict`), this prompt
 * asks whether to *move* it here (remove from the others) or *keep* the double
 * booking. Cancelling leaves everything as it was.
 *
 * Mounted once in the root layout so it covers every assignment entry point
 * (kanban drag-drop, map, command palette, context menu, assignment dialog).
 */
export function VehicleConflictPrompt() {
  const t = useTranslations('incidents.vehicleConflict')
  const tCommon = useTranslations('incidents.common')
  const { vehicleConflict, resolveVehicleConflict, cancelVehicleConflict } = useOperations()

  if (!vehicleConflict) return null

  const { vehicleName, conflicts } = vehicleConflict
  const conflictLabels = conflicts.map((c) => c.operationLabel)

  return (
    <AlertDialog open={true} onOpenChange={(open) => { if (!open) cancelVehicleConflict() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            {t('title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t.rich('alreadyAssigned', {
              vehicle: vehicleName,
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
          <Button variant="ghost" onClick={cancelVehicleConflict}>
            {tCommon('cancel')}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => resolveVehicleConflict("keep")}>
              {t('keepBoth')}
            </Button>
            <Button onClick={() => resolveVehicleConflict("move")}>
              {t('moveHere')}
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
