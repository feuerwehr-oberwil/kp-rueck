"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Truck } from "lucide-react"
import { wsClient } from "@/lib/websocket-client"
import { apiClient } from "@/lib/api-client"
import { useAuth } from "@/lib/contexts/auth-context"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

interface ReleasePrompt {
  assignmentId: string
  incidentId: string
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
 */
export function GpsReleasePrompt() {
  const t = useTranslations('incidents.gpsRelease')
  const { isEditor } = useAuth()
  const pathname = usePathname()
  const [prompt, setPrompt] = useState<ReleasePrompt | null>(null)
  const [releasing, setReleasing] = useState(false)

  const onOperatorPage = pathname === "/" || pathname === "/map"

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
        if (incident.status === "abschluss") return
      } catch {
        // Can't verify — show the prompt; the unassign endpoint is the backstop.
      }
      // Last prompt wins; the operator handles one at a time. A re-broadcast for the
      // same assignment simply refreshes the open dialog.
      setPrompt({
        assignmentId: payload.assignment_id,
        incidentId: payload.incident_id,
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
        if (msg.data.status === "abschluss" || msg.action === "delete") setPrompt(null)
      },
    )
    return () => unsubscribe()
  }, [prompt])

  if (!isEditor || !onOperatorPage || !prompt) return null

  const handleRelease = async () => {
    setReleasing(true)
    try {
      await apiClient.unassignResource(prompt.incidentId, prompt.assignmentId)
      toast.success(t('released', { vehicle: prompt.vehicleName }))
      setPrompt(null)
    } catch {
      toast.error(t('releaseFailed'))
    } finally {
      setReleasing(false)
    }
  }

  // Archive the incident — the status change to abschluss auto-releases
  // personnel and vehicles server-side (materials stay, like on the board).
  const handleReleaseAndComplete = async () => {
    setReleasing(true)
    try {
      const incident = await apiClient.getIncident(prompt.incidentId)
      if (incident.status !== "abschluss") {
        await apiClient.updateIncidentStatus(prompt.incidentId, incident.status, "abschluss")
      }
      toast.success(t('completed', { label: prompt.incidentLabel }))
      setPrompt(null)
    } catch {
      toast.error(t('completeFailed'))
    } finally {
      setReleasing(false)
    }
  }

  return (
    <AlertDialog open={true} onOpenChange={(open) => { if (!open) setPrompt(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            {t('title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t.rich('description', {
              vehicle: prompt.vehicleName,
              label: prompt.incidentLabel,
              strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => setPrompt(null)} disabled={releasing}>
            {t('decline')}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={handleRelease} disabled={releasing}>
              {t('releaseOnly', { vehicle: prompt.vehicleName })}
            </Button>
            <Button onClick={handleReleaseAndComplete} disabled={releasing}>
              {t('completeIncident')}
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
