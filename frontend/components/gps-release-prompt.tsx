"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Truck } from "lucide-react"
import { wsClient } from "@/lib/websocket-client"
import { apiClient } from "@/lib/api-client"
import { reportStatusConflict } from "@/lib/status-conflict"
import type { IncidentStatus } from "@/lib/types/incidents"
import { useAuth } from "@/lib/contexts/auth-context"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import { useIsMobile } from "@/components/ui/use-mobile"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

interface ReleasePrompt {
  assignmentId: string
  incidentId: string
  /** Absent from a backend that predates it – then nothing counts as «the last one». */
  vehicleId: string | null
  vehicleName: string
  incidentLabel: string
}

/**
 * GPS Rule B (plan 10) — confirm-release. When the backend GPS automation detects an
 * assigned vehicle back at the magazin geofence, it broadcasts a `gps_release_prompt`
 * WebSocket event. This globally-mounted component shows a one-click confirm dialog:
 * "Fahrzeug zurück im Magazin — freigeben?". On confirm it releases that vehicle's
 * assignment via the existing unassign endpoint. The incident is never auto-closed;
 * declining leaves everything as it was.
 *
 * Editors only — a viewer would be 403'd on the unassign, so they get no prompt.
 * Mounted once in the root layout, but only ACTIVE on the board and map — those
 * are the pages where the operator manages resources. Elsewhere
 * (Übungssteuerung, settings, …) the modal would only interrupt; the bell
 * notification still covers it.
 *
 * Never on a phone: the phone board is read-only (owner, 14.11.2026), and this dialog exists only
 * to ask for a write. The bell notification tells the phone what happened.
 *
 * The main answer (ink, Enter) is «Nur {vehicle} freigeben» – a vehicle back home says nothing
 * about the crew still working on site, whether its driver came back with it or stayed. Only
 * when it is the Einsatz's last resource (`isLastResource`) does «Einsatz abschliessen» take
 * the ink and «Nur freigeben» the line above Abbrechen (owner pick #21, 19.11.2026).
 */
/**
 * Whether releasing the prompted assignment leaves the Einsatz with nothing on it: that exact
 * assignment is still live, no other vehicle, no material, no crew – except the person who
 * drives this vehicle when the driver «kehrt zurück» (they travel with it). A driver who
 * «bleibt vor Ort» is still out, so then never – whether the list knows the driver or not.
 */
export function isLastResource(
  operation: Pick<Operation, "vehicles" | "crew" | "materials">,
  prompted: { vehicleId: string; assignmentId: string },
  personnel: readonly { id: string; isDriver?: boolean; driverVehicleId?: string }[],
): boolean {
  const { vehicleId, assignmentId } = prompted
  const assigned = operation.vehicles.find((v) => v.vehicleId === vehicleId && v.assignmentId === assignmentId)
  if (!assigned || assigned.driverStay) return false
  if (operation.vehicles.some((v) => v.vehicleId !== vehicleId)) return false
  if (operation.materials.length > 0) return false
  const driverId = personnel.find((p) => p.isDriver && p.driverVehicleId === vehicleId)?.id
  return operation.crew.every((member) => member.personnelId === driverId)
}

export function GpsReleasePrompt() {
  const t = useTranslations('incidents.gpsRelease')
  const { isEditor } = useAuth()
  const { operations, personnel } = useOperations()
  const isPhone = useIsMobile()
  const pathname = usePathname()
  const [prompt, setPrompt] = useState<ReleasePrompt | null>(null)

  // The board or the Lagekarte, on a desk – see the note above.
  const onOperatorPage = !isPhone && (pathname === "/" || pathname === "/map")

  // Drop any pending prompt when leaving the board/map so it can't pop up
  // stale after navigating back.
  useEffect(() => {
    if (!onOperatorPage) setPrompt(null)
  }, [onOperatorPage])

  useEffect(() => {
    if (!isEditor || !onOperatorPage) return
    const unsubscribe = wsClient.on("gps_release_prompt", async (payload: Record<string, string>) => {
      if (!payload?.assignment_id || !payload?.incident_id) return
      // If the incident is already closed out, the operator has handled it —
      // no modal, the bell notification is enough.
      try {
        const incident = await apiClient.getIncident(payload.incident_id)
        if (incident.status === "complete") return
      } catch {
        // Can't verify — show the prompt; the unassign endpoint is the backstop.
      }
      // Last prompt wins; the operator handles one at a time. A re-broadcast for the
      // same assignment simply refreshes the open dialog.
      setPrompt({
        assignmentId: payload.assignment_id,
        incidentId: payload.incident_id,
        vehicleId: payload.vehicle_id || null,
        vehicleName: payload.vehicle_name || t('fallbackVehicle'),
        incidentLabel: payload.incident_label || t('fallbackIncident'),
      })
    })
    return () => unsubscribe()
  }, [isEditor, onOperatorPage, t])

  // Auto-close if the incident gets completed while the dialog is open.
  useEffect(() => {
    if (!prompt) return
    const unsubscribe = wsClient.on(
      "incident_update",
      (msg: { action?: string; data?: { id?: string; status?: string } }) => {
        if (msg?.data?.id !== prompt.incidentId) return
        if (msg.data.status === "complete" || msg.action === "delete") setPrompt(null)
      },
    )
    return () => unsubscribe()
  }, [prompt])

  if (!isEditor || !onOperatorPage || !prompt) return null

  // Both answers close the prompt themselves, and only on success: a failed write
  // leaves the question standing (ConfirmDialog keeps every answer waiting meanwhile).
  const handleRelease = async () => {
    try {
      await apiClient.unassignResource(prompt.incidentId, prompt.assignmentId)
      toast.success(t('released', { vehicle: prompt.vehicleName }))
      setPrompt(null)
    } catch {
      toast.error(t('releaseFailed'))
    }
  }

  // Archive the incident — the status change to abschluss auto-releases
  // personnel and vehicles server-side (materials stay, like on the board).
  const handleReleaseAndComplete = async () => {
    let seen: IncidentStatus | null = null
    try {
      const incident = await apiClient.getIncident(prompt.incidentId)
      if (incident.status !== "complete") {
        seen = incident.status
        await apiClient.updateIncidentStatus(prompt.incidentId, incident.status, "complete")
      }
      toast.success(t('completed', { label: prompt.incidentLabel }))
      setPrompt(null)
    } catch (error) {
      // Moved between the read and the write: «Gerade geändert» asks instead.
      if (seen && reportStatusConflict(error, { operationId: prompt.incidentId, seen, wanted: "complete" })) {
        setPrompt(null)
        return
      }
      toast.error(t('completeFailed'))
    }
  }

  // Read from the board as it stands now, so a crew released meanwhile turns the answer.
  const operation = operations.find((op) => op.id === prompt.incidentId)
  const completeIsMain = !!operation && !!prompt.vehicleId
    && isLastResource(operation, { vehicleId: prompt.vehicleId, assignmentId: prompt.assignmentId }, personnel)
  const releaseOnly = { label: t('releaseOnly', { vehicle: prompt.vehicleName }), run: handleRelease }
  const complete = { label: t('completeIncident'), run: handleReleaseAndComplete }
  const [main, other] = completeIsMain ? [complete, releaseOnly] : [releaseOnly, complete]

  return (
    <ConfirmDialog
      open
      onCancel={() => setPrompt(null)}
      icon={<Truck className="h-5 w-5 text-muted-foreground" />}
      title={t('title')}
      description={t.rich('description', {
        vehicle: prompt.vehicleName,
        label: prompt.incidentLabel,
        strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
      })}
      extraAction={{ label: other.label, onSelect: other.run }}
      cancelText={t('decline')}
      confirmText={main.label}
      onConfirm={main.run}
    />
  )
}
