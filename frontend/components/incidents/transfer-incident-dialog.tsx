"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { MapPin, AlertCircle, Search, Loader2 } from "lucide-react"
import type { Incident } from "@/lib/types/incidents"
import { useTranslations } from "next-intl"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"

interface TransferIncidentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceIncident: Incident
  sourceName?: string
  availableIncidents: Incident[]
  onTransfer: (targetIncidentId: string) => void
  isTransferring?: boolean
  /** What this transfer will move. Shown in the confirmation so the operator sees the
   *  size of the move before making it — «Ressourcen übertragen» takes a whole crew off
   *  one incident with no undo, and used to do so on a single click with no summary. */
  resourceSummary?: { crew: number; vehicles: number; materials: number }
}

export function TransferIncidentDialog({
  open,
  onOpenChange,
  sourceIncident,
  sourceName,
  availableIncidents,
  onTransfer,
  isTransferring = false,
  resourceSummary,
}: TransferIncidentDialogProps) {
  const t = useTranslations('incidents')
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)

  const selectedIncident = availableIncidents.find((inc) => inc.id === selectedIncidentId) ?? null

  const handleTransfer = () => {
    if (selectedIncidentId) {
      setConfirmOpen(true)
    }
  }

  const confirmTransfer = () => {
    if (selectedIncidentId) {
      onTransfer(selectedIncidentId)
    }
    setConfirmOpen(false)
  }

  const handleClose = () => {
    setSelectedIncidentId(null)
    setSearchTerm("")
    onOpenChange(false)
  }

  // Filter out the source incident and apply search filter
  const targetIncidents = availableIncidents
    .filter(inc => inc.id !== sourceIncident.id)
    .filter(inc => {
      if (!searchTerm.trim()) return true
      const search = searchTerm.toLowerCase()
      return (
        inc.title.toLowerCase().includes(search) ||
        inc.location_address?.toLowerCase().includes(search) ||
        t(`types.${inc.type}`).toLowerCase().includes(search) ||
        inc.description?.toLowerCase().includes(search)
      )
    })

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-2xl modal-h-tall flex flex-col"
        overlayClassName="backdrop-blur-none"
      >
        <DialogHeader>
          <DialogTitle>{t('transfer.title')}</DialogTitle>
          <DialogDescription>
            {t('transfer.description', { title: sourceName ?? sourceIncident.title ?? '' })}
          </DialogDescription>
        </DialogHeader>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('transfer.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 py-4">
          {targetIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <AlertCircle className="h-12 w-12 mb-3" />
              {searchTerm.trim() ? (
                <>
                  <p>{t('transfer.noResults')}</p>
                  <p className="text-sm">{t('transfer.tryDifferentSearch')}</p>
                </>
              ) : (
                <>
                  <p>{t('transfer.noOtherIncidents')}</p>
                  <p className="text-sm">{t('transfer.needTwoIncidents')}</p>
                </>
              )}
            </div>
          ) : (
            targetIncidents.map((incident) => {
              const address = incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity())
              return (
              <button
                key={incident.id}
                onClick={() => setSelectedIncidentId(incident.id)}
                className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                  selectedIncidentId === incident.id
                    ? "border-foreground/30 bg-muted"
                    : "border-border hover:border-foreground/20 hover:bg-muted/50"
                }`}
              >
                <div className="space-y-2">
                  {/* Address first (then title) to match the board/incident cards */}
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 flex-shrink-0 text-primary mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold text-sm truncate" title={address || incident.title}>
                        {address || incident.title}
                      </h4>
                      {/* title is usually a copy of the raw address — only show it when it adds information */}
                      {address && incident.title !== incident.location_address && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5" title={incident.title}>
                          {incident.title}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Incident type and priority */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs">
                      {t(`types.${incident.type}`)}
                    </Badge>
                    <Badge
                      variant={
                        incident.priority === "high"
                          ? "destructive"
                          : incident.priority === "medium"
                          ? "default"
                          : "secondary"
                      }
                      className="text-xs"
                    >
                      {t(`priority.${incident.priority}`)}
                    </Badge>
                    {incident.assigned_vehicles.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {t('transfer.vehicleCount', { count: incident.assigned_vehicles.length })}
                      </span>
                    )}
                  </div>
                </div>
              </button>
              )
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isTransferring}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={!selectedIncidentId || isTransferring}
          >
            {isTransferring && <Loader2 className="size-4 animate-spin" />}
            {t('transfer.transfer')}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* A transfer moves a whole crew off one incident and onto another, and there is no
          undo. It used to happen on the click above, with no statement of what was moving
          or where — so this names both incidents and counts the resources first. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('transfer.confirmTitle')}
        description={t('transfer.confirmDescription', {
          source: sourceName || sourceIncident.title,
          target: selectedIncident
            ? formatLocationForDisplay(selectedIncident.location_address ?? '', getGlobalHomeCity()) ||
              selectedIncident.title
            : '',
        })}
        confirmText={t('transfer.transfer')}
        onConfirm={confirmTransfer}
      >
        {resourceSummary && (
          <p className="text-sm text-muted-foreground">
            {t('transfer.confirmCounts', {
              crew: resourceSummary.crew,
              vehicles: resourceSummary.vehicles,
              materials: resourceSummary.materials,
            })}
          </p>
        )}
      </ConfirmDialog>
    </Dialog>
  )
}
