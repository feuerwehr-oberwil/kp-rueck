"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Copy, Radio, X } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { RadioQuote } from "@/components/kanban/radio-quote"
import { useGroups } from "@/lib/contexts/groups-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { auftragRadio } from "@/lib/auftrag-radio"
import { segmentsToText } from "@/lib/radio-announcement"
import { copyToClipboard } from "@/lib/utils"
import type { IncidentGroup } from "@/lib/types/groups"

interface AuftragRadioDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: IncidentGroup | null
  funkrufname: string
}

/**
 * «Durchsage wiederholen» – shows this Auftrag's Funkdurchsage, word for word.
 *
 * Radio traffic gets lost; asking for a repeat is normal. Reopening the
 * Disponiert dialog of some stop to read the text off it is a detour, and it
 * would also re-record the announcement. This only reads: it repeats the form
 * that was actually used (`lastAnnounced.full`) rather than deciding anew, so
 * the crew hears the same sentence twice instead of two different ones.
 *
 * Before the first stop is disponiert there is nothing to repeat – but the text
 * still exists, and somebody who wants to read it out has every right to. So
 * the dialog always shows one: the recorded wording once there is one, the
 * announcement as it would read right now before that. Reading is never
 * refused; it still records nothing either way.
 */
export function AuftragRadioDialog({ open, onOpenChange, group, funkrufname }: AuftragRadioDialogProps) {
  const t = useTranslations("kanban")
  const tAuftraege = useTranslations("kanban.auftraege")
  const { getGroupResources } = useGroups()
  const { operations, materials } = useOperations()
  const [copied, setCopied] = useState(false)

  const announced = group?.lastAnnounced ?? null

  const radio = useMemo(() => {
    if (!group) return null
    // The stop it was about – or, if that one has since been removed from the
    // route, the first stop still open, so a repeat is never blank.
    const stopId = announced?.stopId && group.stopIds.includes(announced.stopId)
      ? announced.stopId
      : group.stopIds[0]
    const operation = operations.find((candidate) => candidate.id === stopId)
    if (!operation) return null
    return auftragRadio(t, {
      group,
      operation,
      resources: getGroupResources(group.id),
      operations,
      materials,
      funkrufname,
      fallbackAddress: t("disponiert.addressPlaceholder"),
      // A repeat keeps the form that was actually said. With nothing announced
      // yet there is nothing to keep, so let auftragRadio decide – which for an
      // Auftrag that has never been given out is the full Auftragsdurchsage.
      forceFull: announced?.full,
    })
  }, [group, announced, operations, materials, funkrufname, getGroupResources, t])

  const handleCopy = async () => {
    if (!radio) return
    await copyToClipboard(segmentsToText(radio.segments))
    setCopied(true)
    toast.success(tAuftraege("repeatRadioCopied"))
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {announced ? tAuftraege("repeatRadioTitle") : tAuftraege("repeatRadioTitlePreview")}
          </DialogTitle>
          <DialogDescription>
            {announced
              ? tAuftraege("repeatRadioDescription", {
                  time: announced.at.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }),
                })
              : radio
                ? tAuftraege("repeatRadioPreview")
                : tAuftraege("repeatRadioNoStop")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {radio && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Radio className="h-4 w-4 text-muted-foreground" />
                {t("disponiert.funkdurchsage")}
              </div>
              <RadioQuote segments={radio.segments} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            {radio && (
              <Button variant="outline" className="justify-start gap-2" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                {tAuftraege("repeatRadioCopy")}
              </Button>
            )}
            <Button
              variant="ghost"
              className="justify-start gap-2 text-muted-foreground"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              {t("common.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
