/**
 * «Danach vormerken» from anywhere – the conflict prompt's main answer (owner pick 2B, 24.11.2026),
 * the Auftrag-stop question and the Auftrag conflicts. A plain call rather than a context method:
 * the operations provider that resolves the prompt sits ABOVE `PlannedProvider`.
 *
 * It says the outcome itself (a toast either way) and tells `PlannedProvider` to reload at once
 * (`PLANNED_CHANGED`); the server's broadcast would do it a moment later anyway.
 */

import { toast } from "sonner"
import { apiClient, ApiError, type ApiPlannedAssignment } from "@/lib/api-client"
import { translateOutsideReact } from "@/lib/i18n-messages"

export const PLANNED_CHANGED = "kp:planned-changed"

export type PlanTarget = { kind: "incident"; id: string } | { kind: "group"; id: string }

/** Resolves the plan, or null after the failure toast (a refused 409 says why). */
export async function planNext(
  resourceType: ApiPlannedAssignment["resource_type"],
  resourceId: string,
  resourceName: string,
  target: PlanTarget & { label: string },
): Promise<ApiPlannedAssignment | null> {
  try {
    const row = await apiClient.planResource({
      resource_type: resourceType,
      resource_id: resourceId,
      ...(target.kind === "incident" ? { incident_id: target.id } : { incident_group_id: target.id }),
    })
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PLANNED_CHANGED))
    toast.success(translateOutsideReact("notifications.planned.plannedTitle", { name: resourceName }), {
      description: translateOutsideReact("notifications.planned.plannedDescription", { target: target.label }),
    })
    return row
  } catch (error) {
    // Anything but a refusal was toasted by the transport (lib/api/http.ts).
    if (error instanceof ApiError && error.status === 409) {
      toast.error(translateOutsideReact("notifications.planned.planFailed"), { description: error.message })
    }
    return null
  }
}
