import { useEffect } from "react"
import { storeFieldNudgeConfirmation } from "@/components/kanban/field-status-nudge"
import { useNotifications } from "@/lib/contexts/notification-context"
import type { Operation } from "@/lib/contexts/operations/types"
import type { DetailTarget } from "@/lib/detail-target"

/**
 * What the bell and its toasts do on the Lagekarte. Both inputs must be stable: registering is a
 * setState in the notification context, which renders the page again.
 *
 * - Phone: a tapped notification opens the same phone Einsatz sheet as a double-tap, right here.
 *   Without a handler the context falls back to the board link, which took the phone off the map
 *   into the board's sheet. Desktop registers nothing: there the fallback is the board's side
 *   panel on the notification's tab, unchanged.
 * - Editor: the bell's «angekommen» / «beendet» button works here too — the map is a full
 *   operating surface. Same move as the board's handler and as the card's own nudge — see the
 *   note on `registerFieldActionHandler` in app/page.tsx for why «beendet» stops at Beendet /
 *   Rückfahrt instead of running the completion flow. It depends on `changeStatusToTop`, NOT on
 *   the workflow object: that object is rebuilt on every render, and re-registering every render
 *   froze the whole Karte page, back button included.
 */
export function useMapNotificationHandlers({
  isMobile,
  isEditor,
  openIncidentDetail,
  changeStatusToTop,
}: {
  isMobile: boolean
  isEditor: boolean
  openIncidentDetail: (incidentId: string, target?: DetailTarget) => void
  changeStatusToTop: (operationId: string, newStatus: Operation["status"]) => void
}) {
  const { registerFieldActionHandler, registerNavigateHandler } = useNotifications()
  useEffect(() => {
    if (!isMobile) return
    registerNavigateHandler((incidentId, tab, section) => openIncidentDetail(incidentId, tab ? { tab, section } : undefined))
    return () => registerNavigateHandler(null)
  }, [isMobile, registerNavigateHandler, openIncidentDetail])
  useEffect(() => {
    if (!isEditor) return
    registerFieldActionHandler((incidentId, kind) => {
      storeFieldNudgeConfirmation(incidentId, kind)
      changeStatusToTop(incidentId, kind === "complete" ? "returning" : "active")
    })
    return () => registerFieldActionHandler(null)
  }, [isEditor, registerFieldActionHandler, changeStatusToTop])
}
