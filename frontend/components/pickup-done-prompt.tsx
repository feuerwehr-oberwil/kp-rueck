"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { CarTaxiFront } from "lucide-react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { apiClient } from "@/lib/api-client"
import { useAuth } from "@/lib/contexts/auth-context"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { wsClient } from "@/lib/websocket-client"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { formatPickupWaiting } from "@/lib/pickup"

/**
 * "Abholung disponiert?" — the ASK, from the vehicle side (plan 25, §18.9).
 *
 * `/feld` lost its "Abgeholt" button because nobody in the field presses it,
 * which leaves the amber chip standing until a human decides it is done. Two
 * moments know better than the operator does that it probably is, and both of
 * them are about a car:
 *
 *  * a **vehicle was just assigned** to a Schadenplatz that has an open
 *    Abholung — somebody is being sent to fetch them;
 *  * a **vehicle came back to the Magazin** from a Schadenplatz with an open
 *    Abholung — it very likely brought them.
 *
 * It **never clears anything by itself.** A pickup that is quietly marked done
 * while three people are still standing in the rain is the one failure this
 * whole flag exists to prevent, so the automation's entire job is to ask at the
 * right moment; the answer stays a click.
 *
 * The return half deliberately rides on the EXISTING Rule B geofence
 * (`gps_release_prompt`, `services/gps_automation.py`) rather than adding a
 * second one. That also means demo mode is already handled — the backend rule
 * does not run there — and the assignment half checks the demo flag itself.
 *
 * Editors only, board and map only: same reasoning as `GpsReleasePrompt`.
 */

type Trigger = "assigned" | "returned"

interface PickupPrompt {
  incidentId: string
  label: string
  vehicleName: string
  waiting: string
  trigger: Trigger
}

/** One ask per incident+vehicle+reason. Answering "noch offen" must stick. */
function askKey(incidentId: string, vehicleName: string, trigger: Trigger): string {
  return `${incidentId}|${vehicleName}|${trigger}`
}

export function PickupDonePrompt() {
  const t = useTranslations("feld.pickupPrompt")
  const tPickup = useTranslations("feld.pickup")
  const { isEditor } = useAuth()
  const pathname = usePathname()
  const { operations, refreshOperations } = useOperations()

  const [prompt, setPrompt] = useState<PickupPrompt | null>(null)
  const [saving, setSaving] = useState(false)
  const [isDemo, setIsDemo] = useState<boolean | null>(null)

  const askedRef = useRef<Set<string>>(new Set())
  /** Vehicle names per incident as of the previous render, to spot a new one. */
  const vehiclesRef = useRef<Map<string, Set<string>> | null>(null)

  const onOperatorPage = pathname === "/" || pathname === "/map"
  const active = isEditor && onOperatorPage && isDemo === false

  useEffect(() => {
    let cancelled = false
    apiClient.getDemoStatus().then(status => {
      if (!cancelled) setIsDemo(Boolean(status))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!onOperatorPage) setPrompt(null)
  }, [onOperatorPage])

  const raise = useCallback(
    (operation: Operation, vehicleName: string, trigger: Trigger) => {
      const key = askKey(operation.id, vehicleName, trigger)
      if (askedRef.current.has(key)) return
      askedRef.current.add(key)
      setPrompt({
        incidentId: operation.id,
        label: getIncidentRefLabel(operation),
        vehicleName,
        waiting: formatPickupWaiting(operation.pickupRequestedAt),
        trigger,
      })
    },
    [],
  )

  // --- Trigger 1: a vehicle lands on an incident that is waiting -----------
  //
  // Read off the operations list rather than hooked into `assignVehicle`: the
  // board is not the only way a vehicle gets assigned (map, palette, another
  // operator's WebSocket update), and every one of them ends up here.
  useEffect(() => {
    const current = new Map<string, Set<string>>(
      operations.map(op => [op.id, new Set(op.vehicles)]),
    )
    const previous = vehiclesRef.current
    vehiclesRef.current = current
    // First pass seeds the baseline: on a fresh page load every vehicle is
    // "new", and asking about all of them at once would be noise.
    if (!previous || !active) return

    for (const operation of operations) {
      if (!operation.pickupNeeded) continue
      const before = previous.get(operation.id)
      if (!before) continue
      const added = operation.vehicles.find(name => !before.has(name))
      if (added) raise(operation, added, "assigned")
    }
  }, [operations, active, raise])

  // --- Trigger 2: Rule B says a vehicle is back at the Magazin -------------
  useEffect(() => {
    if (!active) return
    const unsubscribe = wsClient.on("gps_release_prompt", (payload: Record<string, string>) => {
      if (!payload?.incident_id) return
      const operation = operations.find(op => op.id === payload.incident_id)
      if (!operation?.pickupNeeded) return
      raise(operation, payload.vehicle_name || t("fallbackVehicle"), "returned")
    })
    return () => unsubscribe()
  }, [active, operations, raise, t])

  // The chip may be cleared from somewhere else while the dialog is open.
  useEffect(() => {
    if (!prompt) return
    const operation = operations.find(op => op.id === prompt.incidentId)
    if (operation && !operation.pickupNeeded) setPrompt(null)
  }, [operations, prompt])

  if (!active || !prompt) return null

  const handleConfirm = async () => {
    setSaving(true)
    try {
      await apiClient.setIncidentFieldReport(prompt.incidentId, { pickup_needed: false })
      toast.success(tPickup("clearedToast"))
      await refreshOperations()
      setPrompt(null)
    } catch (error) {
      console.error("Failed to clear pickup:", error)
      toast.error(tPickup("clearFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AlertDialog open onOpenChange={open => { if (!open) setPrompt(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CarTaxiFront className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            {t("title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(prompt.trigger === "assigned" ? "assigned" : "returned", {
              vehicle: prompt.vehicleName,
              label: prompt.label,
            })}
            {prompt.waiting ? ` ${t("waiting", { duration: prompt.waiting })}` : ""}
            <span className="mt-2 block text-xs">{t("neverAutomatic")}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => setPrompt(null)} disabled={saving}>
            {t("stillOpen")}
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {tPickup("clear")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
