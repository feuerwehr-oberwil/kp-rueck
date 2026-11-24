"use client"

import { useTranslations } from "next-intl"
import { Binoculars, CarTaxiFront } from "lucide-react"

import { DetailFlags } from "@/components/kanban/detail-field"
import type { Operation } from "@/lib/contexts/operations-context"
import { useFieldReportWrites } from "@/lib/hooks/use-field-report-writes"

/**
 * «Reko vor Ort» and «Abholung nötig» as a «Funkmeldungen» chip row in the Übersicht, under
 * «Merkmale» (owner, 24.11.2026: the detail offers what the card's right-click menu offers).
 * The same writes and the same rules as the menu's `FieldReportItems`: «Reko vor Ort» only
 * with a Reko assigned or already on site, ticked = now, unticked = cleared; «Abholung»
 * carries a note the incident already has and clears it when off. The times and the note
 * stay on the Reko and Feld tabs (`FieldReportsRow`).
 */
export function FieldReportFlags({ operation, disabled }: { operation: Operation; disabled?: boolean }) {
  const t = useTranslations("feld.kp")
  const { saveRekoArrived, saveFieldReport } = useFieldReportWrites()
  const rekoOnSite = Boolean(operation.rekoArrivedAt)
  return (
    <DetailFlags
      label={t("reportsTitle")}
      disabled={disabled}
      flags={[
        ...(operation.assignedReko || rekoOnSite
          ? [
              {
                key: "rekoArrived",
                label: t("rekoArrived"),
                icon: <Binoculars className="h-3.5 w-3.5 shrink-0" />,
                checked: rekoOnSite,
                onToggle: (checked: boolean) => void saveRekoArrived(operation.id, checked ? undefined : null),
              },
            ]
          : []),
        {
          key: "pickup",
          label: t("pickup"),
          icon: <CarTaxiFront className="h-3.5 w-3.5 shrink-0" />,
          checked: Boolean(operation.pickupNeeded),
          onToggle: (checked: boolean) =>
            void saveFieldReport(operation.id, {
              pickup_needed: checked,
              pickup_note: checked ? operation.pickupNote || null : null,
            }),
        },
      ]}
    />
  )
}
