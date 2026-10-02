"use client"

import { useCallback, useMemo, useState } from "react"
import { apiClient, type ApiPrinterStatus } from "@/lib/api-client"
import { useOperations } from "@/lib/contexts/operations-context"
import type { ChecklistFacts } from "@/lib/checklist-tasks"
import { usePolling } from "@/lib/hooks/use-polling"

const PRINTER_POLL_MS = 5000

/**
 * What the Bereitschaft checklist is judged on, off the board's own snapshot.
 *
 * Check-ins, drivers, Reko, Magazin, the fleet and the settings are all in the
 * operations context already — it reloads them on the socket events that change
 * them (`personnel_update`, `special_function_update`, `vehicle_update`) and on
 * every board mount. Until 2026-09-23 the badge AND the open popover each
 * fetched all five endpoints again every 5 s, hidden tab or not. The printer's
 * reachability is the one fact nothing pushes, so only that still polls — and
 * it pauses while the tab is hidden.
 *
 * null until the board's first load has resolved, so a checklist never counts
 * the empty pre-load lists as «nobody checked in».
 */
export function useChecklistFacts({ enabled = true }: { enabled?: boolean } = {}): ChecklistFacts | null {
  const { personnel, specialFunctions, vehicles, settings, isLoaded } = useOperations()
  const [printerStatus, setPrinterStatus] = useState<ApiPrinterStatus | null>(null)

  const loadPrinterStatus = useCallback(async () => {
    try {
      setPrinterStatus((await apiClient.getPrinterStatus()) ?? null)
    } catch {
      setPrinterStatus(null)
    }
  }, [])
  usePolling(loadPrinterStatus, { intervalMs: PRINTER_POLL_MS, enabled })

  return useMemo(
    () =>
      isLoaded
        ? {
            // The board's personnel list IS the checked-in list for this Ereignis
            // (`checked_in_only`), so its length is the check-in count.
            checkedInPersonnel: personnel.length,
            specialFunctions,
            vehicles,
            printerStatus,
            settings,
          }
        : null,
    [isLoaded, personnel.length, specialFunctions, vehicles, printerStatus, settings],
  )
}
