"use client"

import { useState, useRef, useEffect } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
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
      <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          hideCloseButton
          overlayOffset="42px"
          nonModal
          className="max-w-3xl mx-auto px-6 py-4"
          onInteractOutside={(e) => {
            // Prevent closing when clicking on footer buttons
            const target = e.target as HTMLElement
            if (target.closest('footer')) {
              e.preventDefault()
            }
          }}
        >
          <div className="pr-8">
            <SheetHeader className="p-0 mb-4">
              <SheetTitle className="flex items-center gap-2">
                <Printer className="h-4 w-4" />
                Status drucken
              </SheetTitle>
              <SheetDescription>
                Wählen Sie aus, welche Informationen gedruckt werden sollen.
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeCompleted"
                  checked={options.includeCompleted}
                  onCheckedChange={(checked) =>
                    updateOption("includeCompleted", checked === true)
                  }
                />
                <Label htmlFor="includeCompleted" className="cursor-pointer text-sm">
                  Abgeschlossene Einsätze
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includePersonnel"
                  checked={options.includePersonnel}
                  onCheckedChange={(checked) =>
                    updateOption("includePersonnel", checked === true)
                  }
                />
                <Label htmlFor="includePersonnel" className="cursor-pointer text-sm">
                  Personal-Liste
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeVehicles"
                  checked={options.includeVehicles}
                  onCheckedChange={(checked) =>
                    updateOption("includeVehicles", checked === true)
                  }
                />
                <Label htmlFor="includeVehicles" className="cursor-pointer text-sm">
                  Fahrzeug-Status
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeMaterials"
                  checked={options.includeMaterials}
                  onCheckedChange={(checked) =>
                    updateOption("includeMaterials", checked === true)
                  }
                />
                <Label htmlFor="includeMaterials" className="cursor-pointer text-sm">
                  Material-Inventar
                </Label>
              </div>
            </div>

            {/* Summary and actions */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t">
              <p className="text-xs text-muted-foreground">
                {operationCount} Einsätze
                {options.includePersonnel && `, ${personnel.length} Personal`}
                {options.includeVehicles && `, ${vehicles.length} Fahrzeuge`}
                {options.includeMaterials && `, ${materials.length} Material`}
              </p>
              <Button size="sm" onClick={handlePrint} disabled={isLoading}>
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                Drucken
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
