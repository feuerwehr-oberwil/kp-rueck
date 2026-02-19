"use client"

import { useState } from "react"
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

export interface ThermoPrintOptions {
  includeCompleted: boolean
  includeVehicles: boolean
  includePersonnel: boolean
}

interface ThermoOptionsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPrint: (options: ThermoPrintOptions) => void
  isPrinting: boolean
}

export function ThermoOptionsSheet({ open, onOpenChange, onPrint, isPrinting }: ThermoOptionsSheetProps) {
  const [options, setOptions] = useState<ThermoPrintOptions>({
    includeCompleted: false,
    includeVehicles: true,
    includePersonnel: true,
  })

  const updateOption = (key: keyof ThermoPrintOptions, value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }))
  }

  const handlePrint = () => {
    onPrint(options)
  }

  return (
    <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        overlayOffset="42px"
        nonModal
        className="max-w-3xl mx-auto px-6 py-4"
        onInteractOutside={(e) => {
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
              Thermodruck
            </SheetTitle>
            <SheetDescription>
              Board-Snapshot auf Thermodrucker drucken.
            </SheetDescription>
          </SheetHeader>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="thermoIncludeCompleted"
                checked={options.includeCompleted}
                onCheckedChange={(checked) =>
                  updateOption("includeCompleted", checked === true)
                }
              />
              <Label htmlFor="thermoIncludeCompleted" className="cursor-pointer text-sm">
                Abgeschlossene Einsätze
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="thermoIncludeVehicles"
                checked={options.includeVehicles}
                onCheckedChange={(checked) =>
                  updateOption("includeVehicles", checked === true)
                }
              />
              <Label htmlFor="thermoIncludeVehicles" className="cursor-pointer text-sm">
                Fahrzeug-Status
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="thermoIncludePersonnel"
                checked={options.includePersonnel}
                onCheckedChange={(checked) =>
                  updateOption("includePersonnel", checked === true)
                }
              />
              <Label htmlFor="thermoIncludePersonnel" className="cursor-pointer text-sm">
                Personal-Übersicht
              </Label>
            </div>
          </div>

          <div className="flex items-center justify-end mt-4 pt-3 border-t">
            <Button size="sm" onClick={handlePrint} disabled={isPrinting}>
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              {isPrinting ? 'Wird gedruckt...' : 'Drucken'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
