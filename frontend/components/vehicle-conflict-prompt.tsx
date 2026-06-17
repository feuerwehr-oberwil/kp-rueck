"use client"

import { Truck } from "lucide-react"
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
            Fahrzeug bereits im Einsatz
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{vehicleName}</span> ist bereits zugewiesen
            {conflictLabels.length === 1 ? (
              <> auf »{conflictLabels[0]}«.</>
            ) : (
              <>
                {" "}auf:
                <span className="mt-1 block">
                  {conflictLabels.map((label) => (
                    <span key={label} className="block">• {label}</span>
                  ))}
                </span>
              </>
            )}
            {" "}Soll das Fahrzeug hierher verschoben werden, oder auf beiden Einsätzen bleiben?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={cancelVehicleConflict}>
            Abbrechen
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => resolveVehicleConflict("keep")}>
              Mehrfach zuweisen
            </Button>
            <Button onClick={() => resolveVehicleConflict("move")}>
              Hierher verschieben
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
