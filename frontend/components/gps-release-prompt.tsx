"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Truck } from "lucide-react"
import { wsClient } from "@/lib/websocket-client"
import { apiClient } from "@/lib/api-client"
import { requestCompletion } from "@/lib/hooks/use-completion-request"
import { useAuth } from "@/lib/contexts/auth-context"
import { apiEventToEvent, useEvent } from "@/lib/contexts/event-context"
import { useIsMobile } from "@/components/ui/use-mobile"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

interface ReleasePrompt {
  assignmentId: string
  incidentId: string
  /** The Einsatz's Ereignis; unknown when the lookup failed. */
  eventId?: string
  vehicleName: string
  incidentLabel: string
}

/**
 * GPS Rule B (plan 10) — confirm-release. When the backend GPS automation detects an
 * assigned vehicle back at the magazin geofence, it broadcasts a `gps_release_prompt`
 * WebSocket event. This globally-mounted component asks
 * "Fahrzeug zurück im Magazin — freigeben?" (answers below). Nothing is closed or
 * released without an answer; declining leaves everything as it was.
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
 * The main answer (ink, Enter) is «Einsatz abschliessen», always: a vehicle back home means
 * the crew and the material are back too (owner feedback 23.11.2026 #13). It runs the board's
 * usual close flow (`requestCompletion` → `useIncidentDialogs`), so the question which
 * material stays on site comes as after a drag onto «Abgeschlossen». With another Ereignis
 * open, it first switches to the Einsatz's own, whose board then runs that flow. It closes
 * only once a board took the request – never a silent dismiss. «Nur {vehicle} freigeben» is
 * the line above «Nicht freigeben».
 */
export function GpsReleasePrompt() {
  const t = useTranslations('incidents.gpsRelease')
  const { isEditor } = useAuth()
  const { selectedEvent, setSelectedEvent } = useEvent()
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
      let eventId: string | undefined
      try {
        const incident = await apiClient.getIncident(payload.incident_id)
        if (incident.status === "complete") return
        eventId = incident.event_id
      } catch {
        // Can't verify — show the prompt; the unassign endpoint is the backstop.
      }
      // Last prompt wins; the operator handles one at a time. A re-broadcast for the
      // same assignment simply refreshes the open dialog.
      setPrompt({
        assignmentId: payload.assignment_id,
        incidentId: payload.incident_id,
        eventId,
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

  // The board's close flow: personnel and vehicles are released server-side, and it asks
  // which material stays on site. Its own dialog takes over from here.
  const handleComplete = async () => {
    const { incidentId, eventId } = prompt
    try {
      if (eventId && eventId !== selectedEvent?.id) setSelectedEvent(apiEventToEvent(await apiClient.getEvent(eventId)))
    } catch {
      toast.error(t('completeFailed'))
      return
    }
    if (!requestCompletion({ incidentId, eventId })) {
      toast.error(t('completeFailed'))
      return
    }
    setPrompt(null)
  }

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
      extraAction={{ label: t('releaseOnly', { vehicle: prompt.vehicleName }), onSelect: handleRelease }}
      cancelText={t('decline')}
      confirmText={t('completeIncident')}
      onConfirm={handleComplete}
    />
  )
}
