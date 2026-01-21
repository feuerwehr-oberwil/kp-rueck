"use client"

import { useState, useRef, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Printer } from "lucide-react"
import { PrintView, type PrintOptions } from "./print-view"
import { useOperations } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { apiClient, type ApiVehicle } from "@/lib/api-client"

interface PrintOptionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PrintOptionsModal({ open, onOpenChange }: PrintOptionsModalProps) {
  const { operations, personnel, materials } = useOperations()
  const { selectedEvent } = useEvent()
  const printRef = useRef<HTMLDivElement>(null)

  const [options, setOptions] = useState<PrintOptions>({
    includeCompleted: false,
    includePersonnel: true,
    includeVehicles: true,
    includeMaterials: false,
  })

  const [vehicles, setVehicles] = useState<ApiVehicle[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Fetch vehicles when modal opens
  useEffect(() => {
    if (open) {
      setIsLoading(true)
      apiClient
        .getVehicles()
        .then(setVehicles)
        .catch(console.error)
        .finally(() => setIsLoading(false))
    }
  }, [open])

  const handlePrint = () => {
    // Trigger browser print
    window.print()
  }

  const updateOption = (key: keyof PrintOptions, value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }))
  }

  // Count operations that will be printed
  const operationCount = options.includeCompleted
    ? operations.length
    : operations.filter((op) => op.status !== "complete").length

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5" />
              Status drucken
            </DialogTitle>
            <DialogDescription>
              Wählen Sie aus, welche Informationen gedruckt werden sollen.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Include completed incidents */}
            <div className="flex items-center space-x-3">
              <Checkbox
                id="includeCompleted"
                checked={options.includeCompleted}
                onCheckedChange={(checked) =>
                  updateOption("includeCompleted", checked === true)
                }
              />
              <Label htmlFor="includeCompleted" className="cursor-pointer">
                Abgeschlossene Einsätze einbeziehen
              </Label>
            </div>

            {/* Include personnel manifest */}
            <div className="flex items-center space-x-3">
              <Checkbox
                id="includePersonnel"
                checked={options.includePersonnel}
                onCheckedChange={(checked) =>
                  updateOption("includePersonnel", checked === true)
                }
              />
              <Label htmlFor="includePersonnel" className="cursor-pointer">
                Personal-Liste einbeziehen
              </Label>
            </div>

            {/* Include vehicle status */}
            <div className="flex items-center space-x-3">
              <Checkbox
                id="includeVehicles"
                checked={options.includeVehicles}
                onCheckedChange={(checked) =>
                  updateOption("includeVehicles", checked === true)
                }
              />
              <Label htmlFor="includeVehicles" className="cursor-pointer">
                Fahrzeug-Status einbeziehen
              </Label>
            </div>

            {/* Include materials */}
            <div className="flex items-center space-x-3">
              <Checkbox
                id="includeMaterials"
                checked={options.includeMaterials}
                onCheckedChange={(checked) =>
                  updateOption("includeMaterials", checked === true)
                }
              />
              <Label htmlFor="includeMaterials" className="cursor-pointer">
                Material-Inventar einbeziehen
              </Label>
            </div>

            {/* Summary */}
            <div className="text-sm text-muted-foreground pt-2 border-t">
              {operationCount} Einsätze werden gedruckt
              {options.includePersonnel && `, ${personnel.length} Personal`}
              {options.includeVehicles && `, ${vehicles.length} Fahrzeuge`}
              {options.includeMaterials && `, ${materials.length} Material`}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button onClick={handlePrint} disabled={isLoading}>
              <Printer className="h-4 w-4 mr-2" />
              Drucken
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hidden print view - rendered in DOM but only visible when printing */}
      {open && (
        <PrintView
          ref={printRef}
          eventName={selectedEvent?.name ?? "Unbekanntes Event"}
          operations={operations}
          personnel={personnel}
          vehicles={vehicles}
          materials={materials}
          options={options}
        />
      )}
    </>
  )
}
