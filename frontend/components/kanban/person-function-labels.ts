import type { useTranslations } from "next-intl"
import { Binoculars, MonitorCog, Phone, Warehouse, type LucideIcon } from "lucide-react"
import type { StationFunction } from "@/lib/person-functions"

/** One glyph per station function – the right-click menu and the person popover draw the same. */
export const STATION_FUNCTION_ICONS: Record<StationFunction, LucideIcon> = {
  reko: Binoculars,
  magazin: Warehouse,
  telefondienst: Phone,
  kommandoposten: MonitorCog,
}

/** A station function's name. `t` is the `kanban` namespace. */
export function stationFunctionLabel(t: ReturnType<typeof useTranslations<"kanban">>, functionType: StationFunction): string {
  switch (functionType) {
    case "reko":
      return t("common.reko")
    case "magazin":
      return t("common.magazin")
    case "telefondienst":
      return t("common.telefondienst")
    case "kommandoposten":
      return t("common.kommandoposten")
  }
}
