"use client"

import { useTranslations } from "next-intl"
import { ArrowLeftRight } from "lucide-react"
import type { ChipMenuAction } from "@/components/ui/removable-chip"
import { usePersonNaming } from "@/components/person-name"
import type { VehicleDriver } from "@/lib/hooks/use-vehicle-drivers"

interface VehicleChipMenuInput {
  /** Who drives it now – named in the row, «Kein Fahrer» when nobody. */
  driver: VehicleDriver | undefined
  /** Opens the one driver picker (`requestVehicleDriver` → `VehicleDriverPrompt`). */
  onPickDriver: () => void
  /** The stay flag – undefined while the assignment is still in flight (nothing to write yet). */
  driverStay: boolean | undefined
  /** The same write as the chip's «vor Ort | zurück» pill (Einsatz) or the dispatch gate's (Auftrag). */
  onToggleStay: () => void
}

/**
 * The vehicle chip's own rows, the same on the card, in the detail and in the Auftrag
 * (owner pick 2B, 24.11.2026): «Fahrer ändern …» with who drives now, then «Fahrzeug bleibt
 * vor Ort» as a checkbox. «Fahrzeug freigeben» is the chip's remove row below them.
 * Returns a builder; the caller passes the rows to `RemovableChip` as `menuActions`.
 */
export function useVehicleChipMenu() {
  const t = useTranslations("kanban.chipMenu")
  const tStatus = useTranslations("incidents.vehicleStatus")
  const naming = usePersonNaming()
  return ({ driver, onPickDriver, driverStay, onToggleStay }: VehicleChipMenuInput): ChipMenuAction[] => [
    {
      label: t("changeDriver"),
      icon: <ArrowLeftRight />,
      hint: driver ? naming.inline(driver) : tStatus("noDriver"),
      onSelect: onPickDriver,
    },
    ...(driverStay === undefined ? [] : [{ label: t("driverStays"), checked: driverStay, onSelect: onToggleStay }]),
  ]
}
