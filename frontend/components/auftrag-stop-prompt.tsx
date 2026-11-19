"use client"

import { Route } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useGroups } from "@/lib/contexts/groups-context"
import { closeAuftragStop, useAuftragStopQuestion } from "@/lib/auftrag-stop-question"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

/**
 * Answers `askAuftragStop` (lib/auftrag-stop-question.ts): the vehicle already drives an
 * Auftrag, the operator put it on a lone Einsatz. Main answer «In Auftrag aufnehmen» adds the
 * Einsatz as the Auftrag's last stop (the stop-add endpoint, under the Auftrag row lock) – only
 * while the Einsatz is still lone and live and the vehicle still drives the Auftrag; otherwise
 * it says so and the question closes, it is out of date. The line above Abbrechen, «Nur
 * zusätzlich zuweisen», is the plain double booking. A failed write keeps the question open
 * (the groups context toasts the failure).
 *
 * Mounted once in the root layout.
 */
export function AuftragStopPrompt() {
  const t = useTranslations("incidents.auftragStop")
  const tCommon = useTranslations("incidents.common")
  const question = useAuftragStopQuestion()
  const { addStopForVehicle } = useGroups()

  if (!question) return null

  const names = { incident: question.incidentLabel, auftrag: question.groupName, vehicle: question.vehicleName }

  const addAsStop = async () => {
    const result = await addStopForVehicle(question.groupId, question.incidentId, question.vehicleId)
    if (result === "failed") throw new Error("addStopForVehicle failed")
    if (result === "changed") toast.error(t("changedTitle", names), { description: t("changedDescription", names) })
    else toast.success(t("added", names))
    closeAuftragStop()
  }

  const assignOnly = async () => {
    closeAuftragStop()
    await question.assignOnly()
  }

  return (
    <ConfirmDialog
      open
      onCancel={closeAuftragStop}
      icon={<Route className="h-5 w-5 text-muted-foreground" />}
      title={t("title", names)}
      description={t("description", names)}
      extraAction={{ label: t("assignOnly"), onSelect: assignOnly }}
      cancelText={tCommon("cancel")}
      confirmText={t("addAsStop")}
      onConfirm={addAsStop}
    />
  )
}
