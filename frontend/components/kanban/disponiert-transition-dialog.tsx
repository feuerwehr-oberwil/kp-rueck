"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Copy, Check, Printer, X, Radio, Siren } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useOperations, type Operation, type Material } from "@/lib/contexts/operations-context"
import { formatWhatsAppMessage } from "@/lib/whatsapp-formatter"
import { getMessageTemplates } from "@/lib/message-template"
import { copyToClipboard } from "@/lib/utils"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import { usePrintJobToast } from "@/lib/hooks/use-print-job-toast"
import { useGroups } from "@/lib/contexts/groups-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { auftragRadio, routeDeployment, stopAddress } from "@/lib/auftrag-radio"
import { deploymentSegments, incidentAnnouncement, stopSpecial } from "@/lib/radio-announcement"
import { findAuftragForStop } from "@/lib/kanban-utils"
import { RadioQuote } from "@/components/kanban/radio-quote"
import type { GroupResources } from "@/lib/types/groups"

const NO_ROUTE_RESOURCES: GroupResources = { vehicles: [], personnel: [], materials: [] }

interface DisponiertTransitionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  operation: Operation | null
  materials: Material[]
  printerEnabled?: boolean
  vehicleDrivers?: Map<string, string>
  funkrufname?: string
  diveraEnabled?: boolean
  onSendDivera?: (operation: Operation) => void
}

export function DisponierTransitionDialog({
  open,
  onOpenChange,
  operation,
  materials,
  printerEnabled,
  vehicleDrivers,
  funkrufname = "Omega",
  diveraEnabled,
  onSendDivera,
}: DisponiertTransitionDialogProps) {
  const t = useTranslations('kanban')
  const tPrint = useTranslations('print.toasts')
  const trackPrint = usePrintJobToast()
  const { groups, getGroupResources, recordAnnouncement } = useGroups()
  const { operations } = useOperations()
  const { selectedEvent } = useEvent()
  // Driver names weren't reaching the message before (the prop was never passed),
  // so the WhatsApp "Fahrer:" line was always blank — load them here.
  const liveVehicleDrivers = useVehicleDrivers(selectedEvent?.id ?? null, open)
  const [whatsappCopied, setWhatsappCopied] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  // The full-vs-short decision is frozen when the dialog opens, because opening
  // it IS the announcement: it gets recorded on the server right away, and a
  // re-render must not turn a full Auftragsdurchsage into the short form while
  // the Einsatzleiter is still reading it out.
  const [frozenFull, setFrozenFull] = useState<boolean | null>(null)
  const announcedKeyRef = useRef<string | null>(null)

  // A grouped incident carries no resources itself — the Auftrag (route) owns
  // them. Resolve the route's resources + stop position so both the Funkdurchsage
  // and the WhatsApp message reflect what's actually assigned.
  const auftrag = findAuftragForStop(groups, operation)
  const groupRes = auftrag ? getGroupResources(auftrag.id) : null
  const addressPlaceholder = t('disponiert.addressPlaceholder')

  const radio = useMemo(() => {
    if (!operation || !auftrag || !groupRes) return null
    return auftragRadio(t, {
      group: auftrag,
      operation,
      resources: groupRes,
      operations,
      materials,
      funkrufname,
      fallbackAddress: addressPlaceholder,
      forceFull: frozenFull ?? undefined,
    })
  }, [operation, auftrag, groupRes, operations, materials, funkrufname, addressPlaceholder, frozenFull, t])

  // Record what was just read out, once per (Auftrag, stop) the dialog opens for.
  // The ref keeps this to one write even though `radio` and `recordAnnouncement`
  // get fresh identities on every group refresh.
  useEffect(() => {
    if (!open) {
      announcedKeyRef.current = null
      setFrozenFull(null)
      return
    }
    if (!radio || !auftrag || !operation) return
    const key = `${auftrag.id}:${operation.id}`
    if (announcedKeyRef.current === key) return
    announcedKeyRef.current = key
    setFrozenFull(radio.full)
    void recordAnnouncement(auftrag.id, {
      fingerprint: radio.fingerprint,
      stopId: operation.id,
      full: radio.full,
    })
  }, [open, radio, auftrag, operation, recordAnnouncement])

  if (!operation) return null

  const effectiveVehicleDrivers = vehicleDrivers ?? liveVehicleDrivers

  const stopIndex = auftrag ? auftrag.stopIds.indexOf(operation.id) : -1
  const auftragCtx = auftrag
    ? {
        name: auftrag.name,
        stopPos: stopIndex >= 0 ? stopIndex + 1 : operation.groupPosition + 1,
        stopTotal: auftrag.stopIds.length,
      }
    : null

  const handleCopyWhatsApp = async () => {
    const { whatsappIncident } = await getMessageTemplates()
    const message = formatWhatsAppMessage({
      operation,
      materials,
      vehicleDrivers: effectiveVehicleDrivers,
      groupResources: groupRes,
      auftrag: auftragCtx,
      template: whatsappIncident,
    })
    await copyToClipboard(message)
    setWhatsappCopied(true)
    toast.success(t('disponiert.whatsappCopied'))
    setTimeout(() => setWhatsappCopied(false), 2000)
  }

  const handlePrint = async () => {
    setIsPrinting(true)
    try {
      const job = await apiClient.queueAssignmentPrint(operation.id)
      trackPrint(job.id, { sentTitle: t('common.printJobSent'), subject: tPrint('subjectSlip') })
    } catch {
      toast.error(t('common.printFailed'))
    } finally {
      setIsPrinting(false)
    }
  }

  // Effective resources = the incident's own UNION the Auftrag's (empty on a
  // grouped stop, so the union is what's really assigned).
  const deployment = routeDeployment(operation, groupRes ?? NO_ROUTE_RESOURCES, materials)
  const hasResources = deploymentSegments(t, deployment).length > 0

  // Home-town-free address for the dialog text and Funkdurchsage quote.
  const location = stopAddress(operation, addressPlaceholder)

  // A stop in an Auftrag announces the whole route the first time and only
  // itself afterwards; a lone incident always announces itself.
  const segments = radio
    ? radio.segments
    : incidentAnnouncement(t, {
        funkrufname,
        address: location,
        deployment,
        special: stopSpecial(t, {
          dangerTypes: operation.rekoSummary?.hasDangers ? operation.rekoSummary.dangerTypes : [],
          nachbarhilfe: operation.nachbarhilfe,
          nachbarhilfeNote: operation.nachbarhilfeNote,
        }),
      })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('disponiert.title')}</DialogTitle>
          <DialogDescription>
            {t('disponiert.description', { location })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Radio announcement help */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Radio className="h-4 w-4 text-muted-foreground" />
              {t('disponiert.funkdurchsage')}
            </div>
            <RadioQuote segments={segments} />
            {!hasResources && (
              <p className="text-xs text-muted-foreground">
                {t('disponiert.noResourcesHint')}
              </p>
            )}
            {auftragCtx && (
              <p className="text-xs text-muted-foreground">
                {t('disponiert.auftragContext', { name: auftragCtx.name, pos: auftragCtx.stopPos, total: auftragCtx.stopTotal })}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={handleCopyWhatsApp}
            >
              {whatsappCopied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {t('disponiert.copyWhatsapp')}
            </Button>

            {printerEnabled && (
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={handlePrint}
                disabled={isPrinting}
              >
                <Printer className="h-4 w-4" />
                {t('common.printSlip')}
              </Button>
            )}

            {diveraEnabled && onSendDivera && (
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={() => onSendDivera(operation)}
              >
                <Siren className="h-4 w-4" />
                {t('disponiert.sendDivera')}
              </Button>
            )}

            <Button
              variant="ghost"
              className="justify-start gap-2 text-muted-foreground"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              {t('common.close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
