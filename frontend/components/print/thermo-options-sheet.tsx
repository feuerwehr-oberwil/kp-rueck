"use client"

import { useState } from "react"
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

export interface ThermoPrintOptions {
  includeIncidents: boolean
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
  const t = useTranslations("print")
  const [options, setOptions] = useState<ThermoPrintOptions>({
    includeIncidents: true,
    includeCompleted: true,
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
    <FooterSheet open={open} onOpenChange={onOpenChange} className="max-w-3xl mx-auto px-6 py-4">
        <div className="pr-8">
          <SheetHeader className="p-0 mb-4">
            <SheetTitle className="flex items-center gap-2">
              <Printer className="h-4 w-4" />
              {t("thermoSheet.title")}
            </SheetTitle>
            <SheetDescription>
              {t("thermoSheet.description")}
            </SheetDescription>
          </SheetHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="thermoIncludeIncidents"
                checked={options.includeIncidents}
                onCheckedChange={(checked) =>
                  updateOption("includeIncidents", checked === true)
                }
              />
              <Label htmlFor="thermoIncludeIncidents" className="cursor-pointer text-sm">
                {t("common.incidentList")}
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="thermoIncludeCompleted"
                checked={options.includeCompleted}
                onCheckedChange={(checked) =>
                  updateOption("includeCompleted", checked === true)
                }
              />
              <Label htmlFor="thermoIncludeCompleted" className="cursor-pointer text-sm">
                {t("common.completedIncidents")}
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
                {t("common.vehicleStatus")}
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
                {t("thermoSheet.personnelOverview")}
              </Label>
            </div>
          </div>

          <div className="flex items-center justify-end mt-4 pt-3 border-t">
            <Button size="sm" onClick={handlePrint} disabled={isPrinting}>
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              {isPrinting ? t("thermoSheet.printing") : t("common.print")}
            </Button>
          </div>
        </div>
    </FooterSheet>
  )
}
