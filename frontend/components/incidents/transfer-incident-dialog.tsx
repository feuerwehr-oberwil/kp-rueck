"use client"

import { EmptyState, SearchEmptyState } from "@/components/ui/empty-state"
import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MapPin, Waypoints } from "lucide-react"
import type { Incident } from "@/lib/types/incidents"
import type { IncidentGroup } from "@/lib/types/groups"
import { takesAssignments } from "@/lib/assignable"
import { useTranslations } from "next-intl"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { STATUS_ACCENT } from "@/lib/kanban-utils"
import { getOperationStatusLabel } from "@/lib/status-labels"
import { ShellLoader } from "@/components/ui/shell-loader"

const ROW = "w-full text-left p-4 rounded-lg border-2 transition-all"
const ROW_SELECTED = "border-foreground/30 bg-muted"
const ROW_IDLE = "border-border hover:border-foreground/20 hover:bg-muted/50"
const HEADING = "text-2xs font-medium uppercase tracking-wide text-muted-foreground"

/** Where «Übertragen» sends the resources: another Einsatz, or an Auftrag – then the source
 *  becomes its last stop and the resources go to the Auftrag (owner pick 23.11.2026, #9). */
export type TransferTarget = { kind: "incident"; id: string } | { kind: "auftrag"; id: string }

interface TransferIncidentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Only its id (kept out of the targets) and a fallback name are read – an
   *  `Operation` or an `Incident` both fit. */
  sourceIncident: { id: string; title?: string | null }
  sourceName?: string
  availableIncidents: Incident[]
  /** The Ereignis's Aufträge. The source must be in none of them (a stop is not transferred). */
  availableAuftraege: Pick<IncidentGroup, "id" | "name" | "color" | "stopIds">[]
  onTransfer: (target: TransferTarget) => void
  isTransferring?: boolean
  /** What this transfer will move. Said above the buttons once a target is chosen, so the
   *  operator sees the size of the move before making it — «Ressourcen übertragen» takes a
   *  whole crew off one incident. */
  resourceSummary?: { crew: number; vehicles: number; materials: number }
}

export function TransferIncidentDialog({
  open,
  onOpenChange,
  sourceIncident,
  sourceName,
  availableIncidents,
  availableAuftraege,
  onTransfer,
  isTransferring = false,
  resourceSummary,
}: TransferIncidentDialogProps) {
  const t = useTranslations('incidents')
  const [selected, setSelected] = useState<TransferTarget | null>(null)
  const [searchTerm, setSearchTerm] = useState("")

  const isSelected = (kind: TransferTarget["kind"], id: string) => selected?.kind === kind && selected.id === id
  const selectedAuftrag = selected?.kind === "auftrag" ? availableAuftraege.find((group) => group.id === selected.id) : undefined

  // No second question: the dialog says what moves (below), and the toast offers «Rückgängig».
  const handleTransfer = () => {
    if (selected) onTransfer(selected)
  }

  const handleClose = () => {
    setSelected(null)
    setSearchTerm("")
    onOpenChange(false)
  }

  const search = searchTerm.trim().toLowerCase()
  // A closed Einsatz takes no new assignment (lib/assignable.ts), so it is no target.
  const targetIncidents = availableIncidents
    .filter((inc) => inc.id !== sourceIncident.id && takesAssignments(inc))
    .filter((inc) =>
      !search ||
      inc.title.toLowerCase().includes(search) ||
      inc.location_address?.toLowerCase().includes(search) ||
      t(`types.${inc.type}`).toLowerCase().includes(search) ||
      inc.description?.toLowerCase().includes(search),
    )
  const targetAuftraege = availableAuftraege.filter((group) => !search || group.name.toLowerCase().includes(search))
  const nothing = targetIncidents.length === 0 && targetAuftraege.length === 0

  // One selectable row. The status dot + label say where the target currently
  // stands — the same colours the board columns carry (STATUS_ACCENT).
  const renderIncident = (incident: Incident) => {
    const address = incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity())
    const accent = STATUS_ACCENT[incident.status]
    return (
      <button
        key={incident.id}
        onClick={() => setSelected({ kind: "incident", id: incident.id })}
        className={`${ROW} ${isSelected("incident", incident.id) ? ROW_SELECTED : ROW_IDLE}`}
      >
        <div className="space-y-2">
          {/* Address first (then title) to match the board/incident cards */}
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 flex-shrink-0 text-muted-foreground mt-0.5" />
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

          {/* Current state, incident type and priority */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${accent?.text ?? "text-muted-foreground"}`}>
              <span className={`h-2 w-2 rounded-full ${accent?.dot ?? "bg-muted-foreground"}`} aria-hidden />
              {getOperationStatusLabel(incident.status)}
            </span>
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
  }

  // One Auftrag row: name, its colour, how many stops it has – the source joins as the last.
  const renderAuftrag = (group: TransferIncidentDialogProps["availableAuftraege"][number]) => (
    <button
      key={group.id}
      onClick={() => setSelected({ kind: "auftrag", id: group.id })}
      className={`${ROW} ${isSelected("auftrag", group.id) ? ROW_SELECTED : ROW_IDLE}`}
    >
      <div className="flex items-start gap-2">
        <Waypoints className="h-4 w-4 flex-shrink-0 text-muted-foreground mt-0.5" style={group.color ? { color: group.color } : undefined} />
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-sm truncate" title={group.name}>{group.name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{t("transfer.stopCount", { count: group.stopIds.length })}</p>
        </div>
      </div>
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      {/* No overlay override: every modal shares the one restrained-blur
          treatment (components/ui/overlay.ts). */}
      <DialogContent className="modal-h-tall flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('transfer.title')}</DialogTitle>
          <DialogDescription>
            {t('transfer.description', { title: sourceName ?? sourceIncident.title ?? '' })}
          </DialogDescription>
        </DialogHeader>

        {/* Search Bar */}
        <SearchInput
          placeholder={t('transfer.searchPlaceholder')}
          value={searchTerm}
          onValueChange={setSearchTerm}
        />

        <div className="flex-1 overflow-y-auto space-y-3 py-4">
          {nothing && search ? (
            <SearchEmptyState query={searchTerm} onClear={() => setSearchTerm("")} />
          ) : nothing ? (
            <EmptyState compact title={t('transfer.noOtherIncidents')} description={t('transfer.needTwoIncidents')} />
          ) : (
            <>
              {targetIncidents.length > 0 && targetAuftraege.length > 0 && (
                <p className={HEADING}>{t("transfer.incidentsHeading")}</p>
              )}
              {targetIncidents.map(renderIncident)}
              {targetAuftraege.length > 0 && (
                <>
                  <p className={`${HEADING} ${targetIncidents.length > 0 ? "pt-2" : ""}`}>{t("transfer.auftraegeHeading")}</p>
                  {targetAuftraege.map(renderAuftrag)}
                </>
              )}
            </>
          )}
        </div>

        {selectedAuftrag && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("transfer.confirmAuftrag", { title: sourceName ?? sourceIncident.title ?? "", auftrag: selectedAuftrag.name })}
          </p>
        )}
        {resourceSummary && selected && (
          <p role={selectedAuftrag ? undefined : "status"} className="text-sm text-muted-foreground">
            {t('transfer.confirmCounts', {
              crew: resourceSummary.crew,
              vehicles: resourceSummary.vehicles,
              materials: resourceSummary.materials,
            })}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isTransferring}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={!selected || isTransferring}
          >
            {isTransferring && <ShellLoader className="size-4" />}
            {t('transfer.transfer')}
          </Button>
        </DialogFooter>
      </DialogContent>

    </Dialog>
  )
}
