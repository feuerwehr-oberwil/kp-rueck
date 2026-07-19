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
  const [whatsappCopied, setWhatsappCopied] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)

  if (!operation) return null

  const handleCopyWhatsApp = async () => {
    const { whatsappIncident } = await getMessageTemplates()
    const message = formatWhatsAppMessage({
      operation,
      materials,
      vehicleDrivers,
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

  const location = operation.location || t('disponiert.addressPlaceholder')
  const crewList = operation.crew.length > 0
    ? operation.crew.join(", ")
    : null
  const isZuFuss = operation.zuFuss || false
  const vehicleList = !isZuFuss && operation.vehicles.length > 0
    ? operation.vehicles
        .map(name => {
          // Spell out whether each vehicle stays on scene or returns, so the
          // radio call matches what WhatsApp/Divera already announce.
          const stay = operation.vehicleDriverStay?.get(name)
          if (stay === undefined) return name
          return `${name} (${stay ? t('disponiert.staysOnSite') : t('disponiert.returns')})`
        })
        .join(", ")
    : null
  const materialNames = operation.materials.length > 0
    ? operation.materials
        .map(id => {
          // Include the material's origin/depot, e.g. "Tauchpumpe Gr. (Pio)".
          const m = materials.find(m => m.id === id)
          if (!m) return null
          return m.category ? `${m.name} (${m.category})` : m.name
        })
        .filter(Boolean)
        .join(", ")
    : null

  // Reko dangers for "besonderes" section
  const rekoDangers = operation.rekoSummary?.hasDangers && operation.rekoSummary.dangerTypes.length > 0
    ? operation.rekoSummary.dangerTypes.join(", ")
    : null

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
              &quot;{t('disponiert.radioIntro', { funkrufname })} <span className="font-semibold text-foreground">{location}</span>{t('disponiert.radioDeploySuffix')}{crewList ? <> <span className="font-semibold text-foreground">{crewList}</span></> : null}{isZuFuss ? <> <span className="font-semibold text-foreground">{t('disponiert.radioZuFuss')}</span></> : vehicleList ? <> {t('disponiert.radioWith')} <span className="font-semibold text-foreground">{vehicleList}</span></> : null}{materialNames ? <> {t('disponiert.radioAnd')} <span className="font-semibold text-foreground">{materialNames}</span></> : null}.{rekoDangers ? <> {t('disponiert.radioSpecial')} <span className="font-semibold text-foreground">{rekoDangers}</span>.</> : null}&quot;
            </p>
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
