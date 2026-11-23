"use client"

import { Copy, ListPlus, Route } from "lucide-react"
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
 * - «Nur zusätzlich zuweisen» (Z) is the plain double booking – also on the other Einsätze that
 *   have the vehicle (`alsoOn`), whose cards it draws too, so no second question follows.
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

  const assignOnly = async () => {
    closeAuftragStop()
    await question.assignOnly()
  }

  const auftragCard = { id: question.groupId, title: question.groupName }
  const incidentCard = { id: question.incidentId, title: question.incidentLabel }
  // The Auftrag, every other Einsatz that has it, and this one: «2×» on two cards, «3×» on three.
  const cards = question.alsoOn.length + 2
  const doubled = `${question.vehicleName} · ${cards}×`
  const doubledChip = [{ label: doubled, tone: "double" as const }]

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
          shortcut: t("assignOnlyKey"),
          label: t("assignOnly"),
          icon: <Copy aria-hidden />,
          diagram: (
            <ChoiceDiagram
              link="both"
              from={[
                { ...auftragCard, chips: doubledChip },
                ...question.alsoOn.map((other) => ({ id: other.id, title: other.label, chips: doubledChip })),
              ]}
              to={{ ...incidentCard, chips: doubledChip }}
            />
          ),
          consequence: question.alsoOn.length
            ? t.rich("assignOnlyConsequenceAlso", {
                ...names,
                others: question.alsoOn.map((other) => other.label).join(", "),
                cards,
                strong,
              })
            : t.rich("assignOnlyConsequence", { ...names, strong }),
          onSelect: assignOnly,
        },
      ]}
    />
  )
}
