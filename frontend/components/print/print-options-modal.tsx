"use client"

import { useState, useRef, useEffect } from "react"
import {
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Printer } from "lucide-react"
import { useTranslations } from "next-intl"
import { PrintView, type PrintOptions } from "./print-view"
import { useOperations } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { apiClient, type ApiVehicle, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"

interface PrintOptionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PrintOptionsModal({ open, onOpenChange }: PrintOptionsModalProps) {
  const t = useTranslations("print")
  const { operations, personnel, materials } = useOperations()
  const { selectedEvent } = useEvent()
  const printRef = useRef<HTMLDivElement>(null)

  const [options, setOptions] = useState<PrintOptions>({
    includeIncidents: true,
    includeCompleted: true,
    includePersonnel: true,
    includeVehicles: true,
    includeMaterials: true,
    // Map is a heavy, deliberately-chosen artifact — left off by default.
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
      <FooterSheet open={open} onOpenChange={onOpenChange} className="max-w-3xl mx-auto px-6 py-4">
          <div className="pr-8">
            <SheetHeader className="p-0 mb-4">
              <SheetTitle className="flex items-center gap-2">
                <Printer className="h-4 w-4" />
                {t("optionsModal.title")}
              </SheetTitle>
              <SheetDescription>
                {t("optionsModal.description")}
              </SheetDescription>
            </SheetHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeIncidents"
                  checked={options.includeIncidents}
                  onCheckedChange={(checked) =>
                    updateOption("includeIncidents", checked === true)
                  }
                />
                <Label htmlFor="includeIncidents" className="cursor-pointer text-sm">
                  {t("common.incidentList")}
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeCompleted"
                  checked={options.includeCompleted}
                  onCheckedChange={(checked) =>
                    updateOption("includeCompleted", checked === true)
                  }
                />
                <Label htmlFor="includeCompleted" className="cursor-pointer text-sm">
                  {t("common.completedIncidents")}
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
                  {t("optionsModal.personnelList")}
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
                  {t("common.vehicleStatus")}
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
                  {t("optionsModal.materialInventory")}
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
                  {t("optionsModal.mapOverview")}
                </Label>
              </div>
            </div>

            {/* Summary and actions */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t">
              <p className="text-xs text-muted-foreground">
                {t("optionsModal.summaryIncidents", { count: operationCount })}
                {options.includePersonnel && `, ${t("optionsModal.summaryPersonnel", { count: personnel.length })}`}
                {options.includeVehicles && `, ${t("optionsModal.summaryVehicles", { count: vehicles.length })}`}
                {options.includeMaterials && `, ${t("optionsModal.summaryMaterials", { count: materials.length })}`}
              </p>
              <Button size="sm" onClick={handlePrint} disabled={isLoading}>
                <Printer className="h-3.5 w-3.5 mr-1.5" />
                {t("common.print")}
              </Button>
            </div>
          </div>
      </FooterSheet>

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
