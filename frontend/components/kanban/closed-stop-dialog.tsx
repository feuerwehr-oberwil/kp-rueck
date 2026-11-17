"use client"

import { useTranslations } from "next-intl"
import { CheckCircle2 } from "lucide-react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import type { ClosedStopPrompt } from "@/lib/hooks/use-closed-stop-guard"

interface ClosedStopDialogProps {
  prompt: ClosedStopPrompt | null
  onProceed: () => void
  onCancel: () => void
}

/**
 * «Dieser Einsatz ist abgeschlossen. Trotzdem als Stop hinzufügen?»
 *
 * Names the closed incidents rather than just counting them — with several
 * selected in the stop picker, "3 abgeschlossene Einsätze" leaves the operator
 * guessing which ones, and guessing is what the confirmation is meant to end.
 */
export function ClosedStopDialog({ prompt, onProceed, onCancel }: ClosedStopDialogProps) {
  const t = useTranslations("kanban.closedStop")
  const tCommon = useTranslations("kanban.common")

  const names = (prompt?.closed ?? []).map(
    (operation) =>
      (operation.locationDisplay ?? formatLocationForDisplay(operation.location, getGlobalHomeCity()))
      || getIncidentTypeLabel(operation.incidentType),
  )

  return (
    <ConfirmDialog
      open={!!prompt}
      onCancel={onCancel}
      icon={<CheckCircle2 className="h-5 w-5 text-muted-foreground" />}
      title={t(names.length === 1 ? "title" : "titleMany", { count: names.length })}
      description={t(names.length === 1 ? "description" : "descriptionMany", {
        name: names[0] ?? "",
        names: names.join(", "),
      })}
      cancelText={tCommon("cancel")}
      confirmText={t("confirm")}
      onConfirm={onProceed}
    />
  )
}
