"use client"

import { Clock, ListPlus, Route } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useGroups } from "@/lib/contexts/groups-context"
import { closeAuftragStop, useAuftragStopQuestion } from "@/lib/auftrag-stop-question"
import { ChoiceDiagram, ChoiceDialog } from "@/components/ui/choice-dialog"

const strong = (chunks: ReactNode) => <strong className="font-semibold text-foreground">{chunks}</strong>

/**
 * Answers `askAuftragStop` (lib/auftrag-stop-question.ts): the vehicle already drives an
 * Auftrag, the operator put it on a lone Einsatz. Two choice cards (`ChoiceDialog`, owner pick
 * #3, 23.11.2026), neither of them the default – Enter and Esc change nothing:
 *
 * - «In Auftrag aufnehmen» (A) adds the Einsatz as the Auftrag's last stop (the stop-add
 *   endpoint, under the Auftrag row lock) – only while the Einsatz is still lone and live and
 *   the vehicle still drives the Auftrag; otherwise it says so and the question closes, it is
 *   out of date. It has no undo.
 * - «Danach vormerken» (D) leaves the vehicle on the Auftrag and plans it for the Einsatz next;
 *   «Zuteilen» comes once it is free (owner picks 2B and «Auftrag works like an Einsatz»,
 *   24.11.2026 – it used to be «Nur zusätzlich zuweisen», a double booking).
 *
 * A failed write keeps the question open (the groups context toasts the failure).
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

  const planNext = async () => {
    closeAuftragStop()
    await question.planNext()
  }

  const auftragCard = { id: question.groupId, title: question.groupName }
  const incidentCard = { id: question.incidentId, title: question.incidentLabel }

  return (
    <ChoiceDialog
      onCancel={closeAuftragStop}
      icon={<Route className="h-5 w-5 text-muted-foreground" />}
      title={t("title", names)}
      description={t.rich("description", { ...names, strong })}
      cancelText={tCommon("cancel")}
      choices={[
        {
          shortcut: t("addAsStopKey"),
          label: t("addAsStop"),
          icon: <ListPlus aria-hidden />,
          diagram: (
            <ChoiceDiagram
              link="move"
              from={[{ ...incidentCard, chips: [] }]}
              to={{
                ...auftragCard,
                chips: [
                  { label: question.vehicleName, tone: "plain" },
                  { label: t("stopChip", names), tone: "plain" },
                ],
              }}
            />
          ),
          consequence: t.rich("addAsStopConsequence", { ...names, strong }),
          onSelect: addAsStop,
        },
        {
          shortcut: t("planKey"),
          label: t("planNext"),
          icon: <Clock aria-hidden />,
          diagram: (
            <ChoiceDiagram
              link="next"
              from={[{ ...auftragCard, chips: [{ label: question.vehicleName, tone: "plain" }] }]}
              to={{ ...incidentCard, chips: [{ label: t("danachChip", names), tone: "danach" }] }}
            />
          ),
          consequence: t.rich("planConsequence", { ...names, strong }),
          onSelect: planNext,
        },
      ]}
    />
  )
}
