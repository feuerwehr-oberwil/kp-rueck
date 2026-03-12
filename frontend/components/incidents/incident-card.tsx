"use client"

import { useState, useRef, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MapPin, Clock, Map, Truck, Siren, ArrowRightLeft, Search, Binoculars } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import Link from "next/link"
import type { Incident } from "@/lib/types/incidents"
import { INCIDENT_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/types/incidents"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { VehicleTags } from "./vehicle-tags"
import { AssignRekoDialog } from "./assign-reko-dialog"

interface IncidentCardProps {
  incident: Incident
  columnColor?: string
  onEdit?: () => void
  isHighlighted?: boolean
  isDraggable?: boolean
  onUpdate?: () => void
  onTransfer?: () => void
  showAssignReko?: boolean
}

function getTimeSince(date: Date): { text: string; isOverOneHour: boolean } {
  const minutes = Math.floor((Date.now() - date.getTime()) / 1000 / 60)
  if (minutes < 60) return { text: `${minutes} Min`, isOverOneHour: false }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return { text: `${hours}h ${mins}m`, isOverOneHour: true }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function IncidentCard({
  incident,
  columnColor = "bg-slate-200/80 dark:bg-zinc-800/50",
  onEdit,
  isHighlighted,
  isDraggable = true,
  onUpdate,
  onTransfer,
  showAssignReko,
}: IncidentCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showRekoDialog, setShowRekoDialog] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || !isDraggable) return

    return draggable({
      element,
      getInitialData: () => ({ type: "incident", incident }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [incident, isDraggable])

  const priorityVariant = {
    low: "secondary" as const,
    medium: "default" as const,
    high: "destructive" as const,
  }[incident.priority]

  return (
    <Card
      ref={ref}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      onClick={onEdit}
      className={`w-full ${columnColor} border border-border/50 backdrop-blur-sm p-4 transition-all hover:border-border hover:shadow-lg ${
        isHighlighted ? "ring-4 ring-muted-foreground animate-pulse" : ""
      } ${isDraggable ? "cursor-move" : onEdit ? "cursor-pointer" : "cursor-default"} ${
        incident.priority === "high" ? "border-l-4 border-l-destructive" : incident.priority === "medium" ? "border-l-4 border-l-warning" : ""
      }`}
    >
      <div className="space-y-2.5">
        {/* Header with title and actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <MapPin className="h-5 w-5 flex-shrink-0 text-primary mt-0.5" />
            <div className="min-w-0">
              <h3 className="font-bold text-base text-foreground leading-tight">{incident.title}</h3>
              {incident.location_address && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {incident.location_address}
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* REKO Status Icon */}
            {(incident.has_completed_reko || incident.reko_arrived_at) && (
              <div
                className={`p-1.5 rounded-md ${
                  incident.has_completed_reko
                    ? 'bg-success/10'
                    : ''
                }`}
                title={
                  incident.has_completed_reko
                    ? 'Reko-Bericht ausgefüllt'
                    : 'Reko vor Ort'
                }
              >
                <Binoculars
                  className={`h-4 w-4 ${
                    incident.has_completed_reko
                      ? 'text-success'
                      : 'text-muted-foreground'
                  }`}
                />
              </div>
            )}
            {incident.location_lat && incident.location_lng && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={`/map?highlight=${incident.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 rounded-md hover:bg-muted transition-colors"
                  >
                    <Map className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Auf Karte anzeigen</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Incident type */}
        <div className="flex items-center gap-2">
          <Siren className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium text-foreground">
            {INCIDENT_TYPE_LABELS[incident.type]}
          </span>
        </div>

        {/* Time information */}
        {(() => {
          const timeSince = getTimeSince(incident.created_at)
          return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="font-mono">
                {formatTime(incident.created_at)} • <span className={timeSince.isOverOneHour ? "text-destructive" : ""}>{timeSince.text}</span>
              </span>
            </div>
          )
        })()}

        {/* Priority badge row */}
        <div className="flex items-center gap-2">
          <Badge variant={priorityVariant} className="text-xs">
            {PRIORITY_LABELS[incident.priority]}
          </Badge>
        </div>

        {/* Description preview if available */}
        {incident.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {incident.description}
          </p>
        )}

        {/* Assigned Vehicles */}
        {(incident.assigned_vehicles.length > 0 || onEdit) && (
          <div className="flex items-start gap-2">
            <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <VehicleTags
              incidentId={incident.id}
              assignedVehicles={incident.assigned_vehicles}
              onUpdate={onUpdate}
              readOnly={!onEdit}
            />
          </div>
        )}

        {/* Assign Reko button */}
        {showAssignReko && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setShowRekoDialog(true)
            }}
            className="w-full gap-2 mt-2"
          >
            <Search className="h-4 w-4" />
            Reko zuweisen
          </Button>
        )}

        {/* Transfer button */}
        {onTransfer && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onTransfer()
            }}
            className="w-full gap-2 mt-2"
          >
            <ArrowRightLeft className="h-4 w-4" />
            Ressourcen übertragen
          </Button>
        )}
      </div>

      {/* Assign Reko Dialog */}
      <AssignRekoDialog
        open={showRekoDialog}
        onOpenChange={setShowRekoDialog}
        incidentId={incident.id}
        incidentTitle={incident.title}
        onAssigned={onUpdate}
      />
    </Card>
  )
}
