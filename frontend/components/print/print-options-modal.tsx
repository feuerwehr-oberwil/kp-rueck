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
import { useIsMobile } from "@/components/ui/use-mobile"
import { apiClient, type ApiVehicle, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"

interface PrintOptionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PrintOptionsModal({ open, onOpenChange }: PrintOptionsModalProps) {
  const { operations, personnel, materials } = useOperations()
  const { selectedEvent } = useEvent()
  const isMobile = useIsMobile()
  const printRef = useRef<HTMLDivElement>(null)

  const [options, setOptions] = useState<PrintOptions>({
    includeCompleted: false,
    includePersonnel: true,
    includeVehicles: true,
    includeMaterials: false,
    includeMap: false,
  })

  const [vehicles, setVehicles] = useState<ApiVehicle[]>([])
  const [vehicleDrivers, setVehicleDrivers] = useState<Map<string, string>>(new Map())
  const [isLoading, setIsLoading] = useState(false)

  // Fetch vehicles and drivers when modal opens
  useEffect(() => {
    if (open) {
      setIsLoading(true)
      const loadData = async () => {
        try {
          const [vehiclesList, specialFunctions] = await Promise.all([
            apiClient.getVehicles(),
            selectedEvent ? apiClient.getEventSpecialFunctions(selectedEvent.id) : Promise.resolve([]),
          ])
          setVehicles(vehiclesList)

          // Build vehicle driver map
          const vehicleIdToName = new Map<string, string>()
          vehiclesList.forEach(v => vehicleIdToName.set(v.id, v.name))

          const driverMap = new Map<string, string>()
          specialFunctions
            .filter(f => f.function_type === 'driver' && f.vehicle_id)
            .forEach(f => {
              const vehicleName = vehicleIdToName.get(f.vehicle_id!)
              if (vehicleName) {
                driverMap.set(vehicleName, f.personnel_name)
              }
            })
          setVehicleDrivers(driverMap)
        } catch (error) {
          console.error('Failed to load print data:', error)
        } finally {
          setIsLoading(false)
        }
      }
      loadData()
    }
  }, [open, selectedEvent])

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
      <Sheet modal={isMobile} open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          hideCloseButton={!isMobile}
          overlayOffset={isMobile ? undefined : "42px"}
          nonModal={!isMobile}
          className="max-w-3xl mx-auto px-6 py-4"
          onInteractOutside={isMobile ? undefined : (e) => {
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
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

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeMap"
                  checked={options.includeMap}
                  onCheckedChange={(checked) =>
                    updateOption("includeMap", checked === true)
                  }
                />
                <Label htmlFor="includeMap" className="cursor-pointer text-sm">
                  Karten-Übersicht
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
          vehicleDrivers={vehicleDrivers}
        />
      )}
    </>
  )
}
