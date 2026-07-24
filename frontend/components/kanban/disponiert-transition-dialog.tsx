"use client"

import { useState } from "react"
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
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { formatWhatsAppMessage } from "@/lib/whatsapp-formatter"
import { getMessageTemplates } from "@/lib/message-template"
import { copyToClipboard } from "@/lib/utils"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import { useGroups } from "@/lib/contexts/groups-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"

// Bold highlight for the variable parts of the Funkdurchsage quote.
const highlight = (text: string) => (
  <span className="font-semibold text-foreground">{text}</span>
)

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
  const { groups, getGroupResources } = useGroups()
  const { selectedEvent } = useEvent()
  // Driver names weren't reaching the message before (the prop was never passed),
  // so the WhatsApp "Fahrer:" line was always blank — load them here.
  const liveVehicleDrivers = useVehicleDrivers(selectedEvent?.id ?? null, open)
  const [whatsappCopied, setWhatsappCopied] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)

  if (!operation) return null

  const effectiveVehicleDrivers = vehicleDrivers ?? liveVehicleDrivers

  // A grouped incident carries no resources itself — the Auftrag (route) owns
  // them. Resolve the route's resources + stop position so both the Funkdurchsage
  // and the WhatsApp message reflect what's actually assigned.
  const auftrag = operation.groupId ? groups.find((g) => g.id === operation.groupId) : undefined
  const groupRes = auftrag ? getGroupResources(auftrag.id) : null
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
      await apiClient.queueAssignmentPrint(operation.id)
      toast.success(t('common.printJobSent'))
    } catch {
      toast.error(t('common.printFailed'))
    } finally {
      setIsPrinting(false)
    }
  }

  // Effective resources = the incident's own UNION the Auftrag's (empty on a
  // grouped stop, so the union is what's really assigned).
  const effCrew = [...operation.crew, ...(groupRes?.personnel.map((p) => p.name) ?? [])]
  const effVehicles = [...operation.vehicles, ...(groupRes?.vehicles.map((v) => v.name) ?? [])]
  const effMaterials = [...operation.materials, ...(groupRes?.materials.map((m) => m.resourceId) ?? [])]
  const effStay = new Map(operation.vehicleDriverStay ?? [])
  for (const v of groupRes?.vehicles ?? []) {
    if (v.driverStay !== undefined) effStay.set(v.name, v.driverStay)
  }

  const location = operation.location || t('disponiert.addressPlaceholder')
  const crewList = effCrew.length > 0
    ? effCrew.join(", ")
    : null
  const isZuFuss = operation.zuFuss || false
  const vehicleList = !isZuFuss && effVehicles.length > 0
    ? effVehicles
        .map(name => {
          // Spell out whether each vehicle stays on scene or returns, so the
          // radio call matches what WhatsApp/Divera already announce.
          const stay = effStay.get(name)
          if (stay === undefined) return name
          return `${name} (${stay ? t('disponiert.staysOnSite') : t('disponiert.returns')})`
        })
        .join(", ")
    : null
  const materialNames = effMaterials.length > 0
    ? effMaterials
        .map(id => {
          // Include the material's origin/depot, e.g. "Tauchpumpe Gr. (Pio)".
          const m = materials.find(m => m.id === id)
          if (!m) return null
          return m.category ? `${m.name} (${m.category})` : m.name
        })
        .filter(Boolean)
        .join(", ")
    : null

  // Reko dangers + Nachbarhilfe combine into one "Besonderes:" list.
  const rekoDangers = operation.rekoSummary?.hasDangers && operation.rekoSummary.dangerTypes.length > 0
    ? operation.rekoSummary.dangerTypes.join(", ")
    : null
  const nachbarhilfeText = operation.nachbarhilfe
    ? operation.nachbarhilfeNote
      ? t('disponiert.radioNachbarhilfeWithNote', { note: operation.nachbarhilfeNote })
      : t('disponiert.radioNachbarhilfe')
    : null
  const specialList = [rekoDangers, nachbarhilfeText].filter(Boolean).join(", ") || null

  // Deployment part of the quote ("…, es rücken aus …"). Null when nothing is
  // assigned — the quote then ends after the location and a hint is shown below.
  const hasResources = Boolean(crewList || vehicleList || materialNames)
  // vehicleList is already null when zuFuss, so "und" only follows a real
  // vehicle part; materials otherwise attach with "mit".
  const materialConnector = vehicleList ? t('disponiert.radioAnd') : t('disponiert.radioWith')
  const deployment = crewList ? (
    <>
      {t('disponiert.radioDeploySuffix')} {highlight(crewList)}
      {isZuFuss ? <> {highlight(t('disponiert.radioZuFuss'))}</> : null}
      {vehicleList ? <> {t('disponiert.radioWith')} {highlight(vehicleList)}</> : null}
      {materialNames ? <> {materialConnector} {highlight(materialNames)}</> : null}
    </>
  ) : vehicleList ? (
    <>
      {t('disponiert.radioDeploySuffix')} {highlight(vehicleList)}
      {materialNames ? <> {t('disponiert.radioWith')} {highlight(materialNames)}</> : null}
    </>
  ) : materialNames ? (
    <>
      {t('disponiert.radioMaterialOnly')} {highlight(materialNames)}
    </>
  ) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('disponiert.title')}</DialogTitle>
          <DialogDescription>
            {t('disponiert.description', { location: operation.location })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Radio announcement help */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Radio className="h-4 w-4 text-muted-foreground" />
              {t('disponiert.funkdurchsage')}
            </div>
            <p className="text-sm text-muted-foreground italic leading-relaxed">
              &quot;{t('disponiert.radioIntro', { funkrufname })} {highlight(location)}{deployment}.{specialList ? <> {t('disponiert.radioSpecial')} {highlight(specialList)}.</> : null}&quot;
            </p>
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
                <Check className="h-4 w-4 text-green-500" />
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
