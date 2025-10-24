"use client"

import { useState, useRef, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MapPin, Clock, Edit, Map } from 'lucide-react'
import Link from "next/link"
import type { Incident } from "@/lib/types/incidents"
import { INCIDENT_TYPE_LABELS, PRIORITY_LABELS } from "@/lib/types/incidents"
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'

interface IncidentCardProps {
  incident: Incident
  columnColor?: string
  onEdit?: () => void
  isHighlighted?: boolean
  isDraggable?: boolean
}

function getTimeSince(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 1000 / 60)
  if (minutes < 60) return `${minutes} Min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function IncidentCard({
  incident,
  columnColor = "bg-zinc-800/50",
  onEdit,
  isHighlighted,
  isDraggable = true,
}: IncidentCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

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
    high: "default" as const,
    critical: "destructive" as const,
  }[incident.priority]

  return (
    <Card
      ref={ref}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      className={`w-full ${columnColor} border border-border/50 backdrop-blur-sm p-4 transition-all hover:border-primary/50 hover:shadow-lg ${
        isHighlighted ? "ring-4 ring-accent animate-pulse" : ""
      } ${isDraggable ? "cursor-move" : "cursor-default"}`}
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
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit()
                }}
                className="p-1.5 rounded-md hover:bg-primary/20 transition-colors cursor-pointer"
                title="Bearbeiten"
              >
                <Edit className="h-4 w-4 text-primary" />
              </button>
            )}
            {incident.location_lat && incident.location_lng && (
              <Link
                href={`/map?highlight=${incident.id}`}
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-md hover:bg-primary/20 transition-colors"
                title="Auf Karte anzeigen"
              >
                <Map className="h-4 w-4 text-primary" />
              </Link>
            )}
          </div>
        </div>

        {/* Incident type */}
        <div className="text-sm font-medium text-foreground">
          {INCIDENT_TYPE_LABELS[incident.type]}
        </div>

        {/* Time information */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="font-mono">
            {formatTime(incident.created_at)} • {getTimeSince(incident.created_at)}
          </span>
        </div>

        {/* Priority badge row */}
        <div className="flex items-center gap-2">
          <Badge variant={priorityVariant} className="text-xs">
            {PRIORITY_LABELS[incident.priority]}
          </Badge>
          {incident.training_flag && (
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/20">
              Übungsmodus
            </Badge>
          )}
        </div>

        {/* Description preview if available */}
        {incident.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {incident.description}
          </p>
        )}
      </div>
    </Card>
  )
}
