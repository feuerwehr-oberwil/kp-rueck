"use client"

import { useState } from "react"
import { Copy, Check, Printer, X, Radio } from "lucide-react"
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
}

export function DisponierTransitionDialog({
  open,
  onOpenChange,
  operation,
  materials,
  printerEnabled,
  vehicleDrivers,
  funkrufname = "Omega",
}: DisponiertTransitionDialogProps) {
  const [whatsappCopied, setWhatsappCopied] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)

  if (!operation) return null

  const handleCopyWhatsApp = async () => {
    const message = formatWhatsAppMessage({
      operation,
      materials,
      vehicleDrivers,
    })
    await copyToClipboard(message)
    setWhatsappCopied(true)
    toast.success("WhatsApp-Nachricht kopiert")
    setTimeout(() => setWhatsappCopied(false), 2000)
  }

  const handlePrint = async () => {
    setIsPrinting(true)
    try {
      await apiClient.queueAssignmentPrint(operation.id)
      toast.success("Druckauftrag gesendet")
    } catch {
      toast.error("Drucken fehlgeschlagen")
    } finally {
      setIsPrinting(false)
    }
  }

  const location = operation.location || "[Adresse]"
  const crewList = operation.crew.length > 0
    ? operation.crew.join(", ")
    : null
  const isZuFuss = operation.zuFuss || false
  const vehicleList = !isZuFuss && operation.vehicles.length > 0
    ? operation.vehicles.join(", ")
    : null
  const materialNames = operation.materials.length > 0
    ? operation.materials
        .map(id => materials.find(m => m.id === id)?.name)
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
          <DialogTitle>Einsatz disponiert</DialogTitle>
          <DialogDescription>
            {operation.location} → Disponiert
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Radio announcement help */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Radio className="h-4 w-4 text-muted-foreground" />
              Funkdurchsage
            </div>
            <p className="text-sm text-muted-foreground italic leading-relaxed">
              &quot;An alle {funkrufname}, neuer Einsatz: <span className="font-semibold text-foreground">{location}</span>, es rücken aus{crewList ? <> <span className="font-semibold text-foreground">{crewList}</span></> : null}{isZuFuss ? <> <span className="font-semibold text-foreground">zu Fuss</span></> : vehicleList ? <> mit <span className="font-semibold text-foreground">{vehicleList}</span></> : null}{materialNames ? <> und <span className="font-semibold text-foreground">{materialNames}</span></> : null}.{rekoDangers ? <> Besonderes: <span className="font-semibold text-foreground">{rekoDangers}</span>.</> : null}&quot;
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
              WhatsApp-Nachricht kopieren
            </Button>

            {printerEnabled && (
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={handlePrint}
                disabled={isPrinting}
              >
                <Printer className="h-4 w-4" />
                Einsatzzettel drucken
              </Button>
            )}

            <Button
              variant="ghost"
              className="justify-start gap-2 text-muted-foreground"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
              Schliessen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
