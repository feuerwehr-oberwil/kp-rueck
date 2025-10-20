"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Plus, MapPin, Flame, Clock, Users, Package, X, Printer, Send, HelpCircle, Map, Edit, Filter } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useOperations, type Person, type Operation, type Material, type PersonRole, type PersonStatus, type OperationStatus, type VehicleType, initialMaterials } from "@/lib/contexts/operations-context"

const columns = [
  { id: "incoming", title: "EINGEGANGEN", status: ["incoming"], color: "bg-zinc-800/50" },
  { id: "ready", title: "REKO", status: ["ready"], color: "bg-green-800/30" },
  { id: "enroute", title: "DISPONIERT / UNTERWEGS", status: ["enroute"], color: "bg-blue-900/30" },
  { id: "active", title: "EINSATZ", status: ["active"], color: "bg-orange-900/30" },
  { id: "returning", title: "BEENDET / RÜCKFAHRT", status: ["returning"], color: "bg-blue-800/30" },
  { id: "complete", title: "ABGESCHLOSSEN", status: ["complete"], color: "bg-zinc-900/50" },
]

const vehicleTypes: { key: string; name: VehicleType }[] = [
  { key: "1", name: "TLF" },
  { key: "2", name: "Pio" },
  { key: "3", name: "Unimog" },
  { key: "4", name: "Trawa" },
  { key: "5", name: "Mawa" },
]

const emergencyTypes = [
  "Wohnungsbrand",
  "Fahrzeugbrand",
  "Gebäudebrand",
  "Waldbrand",
  "Technische Hilfe",
  "Verkehrsunfall",
  "Ölspur",
  "Fehlalarm",
  "Wasserrettung",
  "Tierrettung",
  "Sturmschaden",
  "Gasleck",
]

function getTimeSince(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 1000 / 60)
  if (minutes < 60) return `${minutes} Min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

function DraggablePerson({ person, onClick, disabled }: { person: Person; onClick?: () => void; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `person-${person.id}`,
    data: { type: "person", person },
    disabled: disabled || person.status === "assigned",
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  const canDrag = !disabled && person.status === "available"

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      onClick={onClick}
      className={`border border-border/50 bg-card/80 backdrop-blur-sm p-3 transition-all hover:border-primary/50 hover:shadow-md hover:bg-card ${canDrag ? "cursor-move" : "cursor-pointer"} ${person.status === "assigned" ? "opacity-60" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-2 w-2 rounded-full flex-shrink-0 ${
              person.status === "available" ? "bg-emerald-500" : "bg-zinc-500"
            }`}
          />
          <span className="font-medium text-sm text-foreground truncate">{person.name}</span>
        </div>
        <Badge variant="outline" className="text-xs flex-shrink-0 font-normal">
          {person.role}
        </Badge>
      </div>
    </Card>
  )
}

function DraggableMaterial({ material, onClick, disabled }: { material: Material; onClick?: () => void; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `material-${material.id}`,
    data: { type: "material", material },
    disabled: disabled || material.status === "assigned",
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  const canDrag = !disabled && material.status === "available"

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...(canDrag ? listeners : {})}
      {...(canDrag ? attributes : {})}
      onClick={onClick}
      className={`border border-border/50 bg-card/80 backdrop-blur-sm p-3 transition-all hover:border-primary/50 hover:shadow-md hover:bg-card ${canDrag ? "cursor-move" : "cursor-pointer"} ${material.status === "assigned" ? "opacity-60" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-2 w-2 rounded-full flex-shrink-0 ${
              material.status === "available" ? "bg-emerald-500" : "bg-zinc-500"
            }`}
          />
          <span className="font-medium text-sm text-foreground truncate">{material.name}</span>
        </div>
      </div>
    </Card>
  )
}

function DraggableOperation({
  operation,
  columnColor,
  onRemoveCrew,
  onRemoveMaterial,
  onClick,
  onHover,
  isHighlighted,
  isDraggingRef,
}: {
  operation: Operation
  columnColor: string
  onRemoveCrew: (crewName: string) => void
  onRemoveMaterial: (materialId: string) => void
  onClick: () => void
  onHover: (opId: string | null) => void
  isHighlighted?: boolean
  isDraggingRef: React.MutableRefObject<boolean>
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `operation-${operation.id}`,
    data: { type: "operation", operation },
  })

  // Also allow drops for people/materials
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `operation-drop-${operation.id}`,
    data: { type: "operation-drop", operationId: operation.id },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Combine both refs
  const setRefs = (element: HTMLDivElement | null) => {
    setNodeRef(element)
    setDroppableRef(element)
  }

  return (
    <Card
      ref={setRefs}
      style={style}
      className={`${columnColor} border border-border/50 backdrop-blur-sm p-4 transition-all hover:border-primary/50 hover:shadow-lg ${isOver ? "ring-2 ring-primary" : ""} ${isHighlighted ? "ring-4 ring-accent animate-pulse" : ""}`}
      onMouseEnter={() => onHover(operation.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          {/* Draggable area */}
          <div
            className="flex items-start gap-2 min-w-0 flex-1 cursor-move"
            {...listeners}
            {...attributes}
          >
            <MapPin className="h-5 w-5 flex-shrink-0 text-primary mt-0.5" />
            <div className="min-w-0">
              <h3 className="font-bold text-base text-foreground leading-tight">{operation.location}</h3>
              {operation.vehicle && (
                <p className="text-xs text-muted-foreground mt-0.5">Fahrzeug: {operation.vehicle}</p>
              )}
            </div>
          </div>
          {/* Non-draggable icons area */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation()
                // Don't trigger if currently dragging
                if (!isDraggingRef.current) {
                  onClick()
                }
              }}
              className="p-1.5 rounded-md hover:bg-primary/20 transition-colors cursor-pointer"
              title="Bearbeiten"
            >
              <Edit className="h-4 w-4 text-primary" />
            </button>
            <Link
              href={`/map?highlight=${operation.id}`}
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded-md hover:bg-primary/20 transition-colors"
              title="Auf Karte anzeigen"
            >
              <Map className="h-4 w-4 text-primary" />
            </Link>
            <Badge
              variant={
                operation.priority === "high" ? "destructive" : operation.priority === "medium" ? "default" : "secondary"
              }
              className="text-xs"
            >
              {operation.priority === "high" ? "Hoch" : operation.priority === "medium" ? "Mittel" : "Niedrig"}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-500 flex-shrink-0" />
          <span className="text-sm font-medium text-foreground">{operation.incidentType}</span>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-sm text-muted-foreground">{getTimeSince(operation.dispatchTime)}</span>
        </div>

        {operation.crew.length > 0 && (
          <div className="flex items-start gap-2">
            <Users className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex flex-wrap gap-1.5">
              {operation.crew.map((member, idx) => (
                <Badge 
                  key={idx} 
                  variant="secondary" 
                  className="text-xs gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                >
                  {member.split(" ")[0][0]}.{member.split(" ")[1][0]}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveCrew(member)
                    }}
                    className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {operation.materials.length > 0 && (
          <div className="flex items-start gap-2">
            <Package className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex flex-wrap gap-1.5">
              {operation.materials.map((matId, idx) => {
                const mat = initialMaterials.find(m => m.id === matId)
                return (
                  <Badge
                    key={idx}
                    variant="outline"
                    className="text-xs gap-1 pr-1 group hover:bg-destructive/20 transition-colors"
                  >
                    {mat?.name.substring(0, 15) || matId}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveMaterial(matId)
                      }}
                      className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function DroppableColumn({
  column,
  operations,
  onRemoveCrew,
  onRemoveMaterial,
  onCardClick,
  onCardHover,
  highlightedOperationId,
  isDraggingRef,
  activeId,
  overId,
}: {
  column: (typeof columns)[0]
  operations: Operation[]
  onRemoveCrew: (operationId: string, crewName: string) => void
  onRemoveMaterial: (operationId: string, materialId: string) => void
  onCardClick: (operation: Operation) => void
  onCardHover: (opId: string | null) => void
  highlightedOperationId: string | null
  isDraggingRef: React.MutableRefObject<boolean>
  activeId: string | null
  overId: string | null
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column.id}`,
    data: { type: "column", columnId: column.id },
  })

  const operationIds = operations.map(op => `operation-${op.id}`)

  // Check if we're dragging an operation (not a person or material)
  const isDraggingOperation = activeId?.startsWith('operation-') || false

  // Check if the dragged operation is already in this column
  const draggedOperationId = activeId?.replace('operation-', '')
  const isDraggedOperationInThisColumn = operations.some(op => op.id === draggedOperationId)

  // Check if we're hovering over this column or any operation card in this column
  const isOverColumn = overId === `column-${column.id}`
  const isOverOperationInColumn = operations.some(op => overId === `operation-drop-${op.id}` || overId === `operation-${op.id}`)

  // Only show indicator if: hovering over this column (or any card in it) AND not the column it's currently in
  const shouldShowDropIndicator = isDraggingOperation && (isOverColumn || isOverOperationInColumn) && !isDraggedOperationInThisColumn

  return (
    <div ref={setNodeRef} className={`flex w-80 flex-shrink-0 flex-col transition-all ${shouldShowDropIndicator ? "ring-2 ring-primary rounded-lg scale-[1.02]" : ""}`}>
      <div className={`mb-3 rounded-lg ${column.color} border ${shouldShowDropIndicator ? "border-primary border-2" : "border-border/50"} px-4 py-3 transition-all`}>
        <h2 className="text-balance text-sm font-bold uppercase tracking-wide text-foreground">{column.title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{operations.length} Einsätze</p>
      </div>

      <div className={`flex-1 space-y-3 overflow-y-auto p-2 rounded-lg transition-all min-h-[200px] relative ${shouldShowDropIndicator ? "bg-primary/20 border-2 border-dashed border-primary" : ""}`}>
        {shouldShowDropIndicator && (
          <>
            {/* Full overlay for extra visibility */}
            <div className="absolute inset-0 bg-primary/10 pointer-events-none z-10 rounded-lg" />
          </>
        )}
        <SortableContext items={operationIds} strategy={verticalListSortingStrategy}>
          <div className={`${shouldShowDropIndicator ? "opacity-40 blur-[2px] pointer-events-none" : ""} transition-all duration-200 space-y-3 relative z-0`}>
            {operations.map((operation) => (
              <div key={operation.id} className={shouldShowDropIndicator ? "pointer-events-auto" : ""}>
                <DraggableOperation
                  operation={operation}
                  columnColor={column.color}
                  onRemoveCrew={(crewName) => onRemoveCrew(operation.id, crewName)}
                  onRemoveMaterial={(materialId) => onRemoveMaterial(operation.id, materialId)}
                  onClick={() => onCardClick(operation)}
                  onHover={onCardHover}
                  isHighlighted={highlightedOperationId === operation.id}
                  isDraggingRef={isDraggingRef}
                />
              </div>
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  )
}

function OperationDetailModal({
  operation,
  open,
  onOpenChange,
  onUpdate
}: {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (updates: Partial<Operation>) => void
}) {
  const [locationSearchResults, setLocationSearchResults] = useState<Array<{
    display_name: string
    lat: string
    lon: string
  }>>([])
  const [showLocationResults, setShowLocationResults] = useState(false)
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)

  const searchLocation = async (query: string) => {
    if (query.length < 3) {
      setLocationSearchResults([])
      setShowLocationResults(false)
      return
    }

    setIsSearchingLocation(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(query)}&` +
        `format=json&` +
        `addressdetails=1&` +
        `limit=5&` +
        `countrycodes=ch&` +
        `viewbox=7.53,47.49,7.59,47.54&` +
        `bounded=1`,
        {
          headers: {
            'User-Agent': 'KP-Rueck-Dashboard/1.0'
          }
        }
      )
      const data = await response.json()
      setLocationSearchResults(data)
      setShowLocationResults(true)
    } catch (error) {
      console.error('Error searching location:', error)
    } finally {
      setIsSearchingLocation(false)
    }
  }

  const handleLocationSelect = (result: typeof locationSearchResults[0]) => {
    onUpdate({
      location: result.display_name,
      coordinates: [parseFloat(result.lat), parseFloat(result.lon)]
    })
    setShowLocationResults(false)
    setLocationSearchResults([])
  }

  // Debounced search
  useEffect(() => {
    if (!operation) return

    const timer = setTimeout(() => {
      if (operation.location) {
        searchLocation(operation.location)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [operation?.location])

  if (!operation) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-3">
            <MapPin className="h-6 w-6 text-primary" />
            Einsatz-Details
          </DialogTitle>
          <DialogDescription className="text-base">
            Einsatz-ID: {operation.id} • {getTimeSince(operation.dispatchTime)} seit Alarmierung
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <Label htmlFor="edit-location" className="text-sm font-semibold text-muted-foreground">
                Einsatzort
              </Label>
              <div className="relative">
                <Input
                  id="edit-location"
                  value={operation.location}
                  onChange={(e) => onUpdate({ location: e.target.value })}
                  onFocus={() => {
                    if (locationSearchResults.length > 0) {
                      setShowLocationResults(true)
                    }
                  }}
                  className="mt-2"
                />
                {isSearchingLocation && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 mt-1">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                )}
              </div>
              {showLocationResults && locationSearchResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-auto">
                  {locationSearchResults.map((result, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleLocationSelect(result)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors border-b border-border/50 last:border-b-0"
                    >
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" />
                        <span className="text-xs leading-relaxed">{result.display_name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="edit-incidentType" className="text-sm font-semibold text-muted-foreground">
                Einsatzart
              </Label>
              <Select
                value={operation.incidentType}
                onValueChange={(value) => onUpdate({ incidentType: value })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Einsatzart auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {emergencyTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-vehicle" className="text-sm font-semibold text-muted-foreground">
                Fahrzeug
              </Label>
              <Select
                value={operation.vehicle || "none"}
                onValueChange={(value) => onUpdate({ vehicle: (value === "none" ? null : value) as VehicleType })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Nicht zugewiesen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nicht zugewiesen</SelectItem>
                  {vehicleTypes.map((vt) => (
                    <SelectItem key={vt.name} value={vt.name || ""}>
                      {vt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="edit-priority" className="text-sm font-semibold text-muted-foreground">
                Priorität
              </Label>
              <Select
                value={operation.priority}
                onValueChange={(value) => onUpdate({ priority: value as "high" | "medium" | "low" })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Niedrig</SelectItem>
                  <SelectItem value="medium">Mittel</SelectItem>
                  <SelectItem value="high">Hoch</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Crew */}
          <div>
            <Label className="text-sm font-semibold text-muted-foreground">Mannschaft ({operation.crew.length})</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {operation.crew.length > 0 ? (
                operation.crew.map((member, idx) => (
                  <Badge key={idx} variant="secondary" className="text-sm px-3 py-1">
                    {member}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Keine Mannschaft zugewiesen</p>
              )}
            </div>
          </div>

          {/* Materials */}
          <div>
            <Label className="text-sm font-semibold text-muted-foreground">Material ({operation.materials.length})</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {operation.materials.length > 0 ? (
                operation.materials.map((matId, idx) => (
                  <Badge key={idx} variant="outline" className="text-sm px-3 py-1">
                    {initialMaterials.find(m => m.id === matId)?.name || matId}
                  </Badge>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Kein Material zugewiesen</p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="notes" className="text-sm font-semibold text-muted-foreground">Zusätzliche Informationen</Label>
            <Textarea
              id="notes"
              placeholder="Notizen, Besonderheiten, Gefahren..."
              value={operation.notes}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              className="mt-2 min-h-[100px]"
            />
          </div>

          {/* Contact */}
          <div>
            <Label htmlFor="contact" className="text-sm font-semibold text-muted-foreground">Kontakt / Melder</Label>
            <Input
              id="contact"
              placeholder="Name, Telefonnummer..."
              value={operation.contact}
              onChange={(e) => onUpdate({ contact: e.target.value })}
              className="mt-2"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button className="gap-2">
              <Printer className="h-4 w-4" />
              Drucken
            </Button>
            <Button variant="secondary" className="gap-2">
              <Send className="h-4 w-4" />
              Senden
            </Button>
            <Button variant="outline" className="ml-auto bg-transparent" onClick={() => onOpenChange(false)}>
              Schließen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ShortcutsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Tastaturkürzel</DialogTitle>
          <DialogDescription>Schnelle Navigation und Fahrzeugzuweisung</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div>
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Fahrzeugzuweisung</h3>
            <div className="space-y-2">
              {vehicleTypes.map((vt) => (
                <div key={vt.key} className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                  <span className="text-sm font-medium">{vt.name}</span>
                  <Badge variant="outline" className="font-mono">{vt.key}</Badge>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Navigation</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Karte nach rechts bewegen</span>
                <Badge variant="outline" className="font-mono">&gt;</Badge>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Karte nach links bewegen</span>
                <Badge variant="outline" className="font-mono">&lt;</Badge>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Suche fokussieren</span>
                <Badge variant="outline" className="font-mono">/</Badge>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Suche verlassen</span>
                <Badge variant="outline" className="font-mono">Esc</Badge>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Neuer Einsatz</span>
                <Badge variant="outline" className="font-mono">N</Badge>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Diese Hilfe anzeigen</span>
                <Badge variant="outline" className="font-mono">?</Badge>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewEmergencyModal({
  open,
  onOpenChange,
  onCreateOperation,
  nextOperationId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  nextOperationId: string
}) {
  const [formData, setFormData] = useState({
    location: "",
    incidentType: "",
    priority: "medium" as "high" | "medium" | "low",
    vehicle: null as VehicleType,
    coordinates: [47.51637699933488, 7.561800450458299] as [number, number],
    status: "incoming" as OperationStatus,
    crew: [] as string[],
    materials: [] as string[],
    notes: "",
    contact: "",
  })

  const [locationSearchResults, setLocationSearchResults] = useState<Array<{
    display_name: string
    lat: string
    lon: string
  }>>([])
  const [showLocationResults, setShowLocationResults] = useState(false)
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)

  const searchLocation = async (query: string) => {
    if (query.length < 3) {
      setLocationSearchResults([])
      setShowLocationResults(false)
      return
    }

    setIsSearchingLocation(true)
    try {
      // Search within Oberwil and surrounding areas (viewbox: Oberwil, Basel-Landschaft)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent(query)}&` +
        `format=json&` +
        `addressdetails=1&` +
        `limit=5&` +
        `countrycodes=ch&` +
        `viewbox=7.53,47.49,7.59,47.54&` +
        `bounded=1`,
        {
          headers: {
            'User-Agent': 'KP-Rueck-Dashboard/1.0'
          }
        }
      )
      const data = await response.json()
      setLocationSearchResults(data)
      setShowLocationResults(true)
    } catch (error) {
      console.error('Error searching location:', error)
    } finally {
      setIsSearchingLocation(false)
    }
  }

  const handleLocationSelect = (result: typeof locationSearchResults[0]) => {
    setFormData({
      ...formData,
      location: result.display_name,
      coordinates: [parseFloat(result.lat), parseFloat(result.lon)]
    })
    setShowLocationResults(false)
    setLocationSearchResults([])
  }

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (formData.location) {
        searchLocation(formData.location)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [formData.location])

  const handleSubmit = () => {
    if (!formData.location || !formData.incidentType) {
      return
    }

    onCreateOperation(formData)

    // Reset form
    setFormData({
      location: "",
      incidentType: "",
      priority: "medium",
      vehicle: null,
      coordinates: [47.51637699933488, 7.561800450458299],
      status: "incoming",
      crew: [],
      materials: [],
      notes: "",
      contact: "",
    })

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-3">
            <Plus className="h-6 w-6 text-primary" />
            Neuer Einsatz
          </DialogTitle>
          <DialogDescription className="text-base">
            Einsatz-ID: {nextOperationId} (wird automatisch vergeben)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <Label htmlFor="location" className="text-sm font-semibold text-muted-foreground">
                Einsatzort *
              </Label>
              <div className="relative">
                <Input
                  id="location"
                  placeholder="z.B. Hauptstraße 45"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  onFocus={() => {
                    if (locationSearchResults.length > 0) {
                      setShowLocationResults(true)
                    }
                  }}
                  className="mt-2"
                  autoFocus
                />
                {isSearchingLocation && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 mt-1">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                )}
              </div>
              {showLocationResults && locationSearchResults.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-auto">
                  {locationSearchResults.map((result, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleLocationSelect(result)}
                      className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors border-b border-border/50 last:border-b-0"
                    >
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" />
                        <span className="text-xs leading-relaxed">{result.display_name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="incidentType" className="text-sm font-semibold text-muted-foreground">
                Einsatzart *
              </Label>
              <Select
                value={formData.incidentType}
                onValueChange={(value) => setFormData({ ...formData, incidentType: value })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Einsatzart auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {emergencyTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="priority" className="text-sm font-semibold text-muted-foreground">
                Priorität
              </Label>
              <Select
                value={formData.priority}
                onValueChange={(value) => setFormData({ ...formData, priority: value as "high" | "medium" | "low" })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Niedrig</SelectItem>
                  <SelectItem value="medium">Mittel</SelectItem>
                  <SelectItem value="high">Hoch</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="vehicle" className="text-sm font-semibold text-muted-foreground">
                Fahrzeug
              </Label>
              <Select
                value={formData.vehicle || "none"}
                onValueChange={(value) =>
                  setFormData({ ...formData, vehicle: (value === "none" ? null : value) as VehicleType })
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Nicht zugewiesen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nicht zugewiesen</SelectItem>
                  {vehicleTypes.map((vt) => (
                    <SelectItem key={vt.name} value={vt.name || ""}>
                      {vt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Contact */}
          <div>
            <Label htmlFor="contact" className="text-sm font-semibold text-muted-foreground">
              Kontakt / Melder
            </Label>
            <Input
              id="contact"
              placeholder="Name, Telefonnummer..."
              value={formData.contact}
              onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
              className="mt-2"
            />
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="notes" className="text-sm font-semibold text-muted-foreground">
              Zusätzliche Informationen
            </Label>
            <Textarea
              id="notes"
              placeholder="Notizen, Besonderheiten, Gefahren..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="mt-2 min-h-[100px]"
            />
          </div>

          {/* Info */}
          <div className="bg-secondary/30 p-3 rounded-lg">
            <p className="text-sm text-muted-foreground">
              Mannschaft und Material können nach dem Erstellen des Einsatzes per Drag & Drop zugewiesen werden.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <Button onClick={handleSubmit} disabled={!formData.location || !formData.incidentType} className="gap-2">
              <Plus className="h-4 w-4" />
              Einsatz erstellen
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function FireStationDashboard() {
  const { personnel, setPersonnel, materials, setMaterials, operations, setOperations, removeCrew, removeMaterial, updateOperation, createOperation, getNextOperationId } = useOperations()
  const searchParams = useSearchParams()
  const highlightParam = searchParams.get("highlight")

  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState("")
  const [materialSearchQuery, setMaterialSearchQuery] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false)
  const [newEmergencyModalOpen, setNewEmergencyModalOpen] = useState(false)
  const [hoveredOperationId, setHoveredOperationId] = useState<string | null>(null)
  const [highlightedOperationId, setHighlightedOperationId] = useState<string | null>(null)
  const [filterVehicle, setFilterVehicle] = useState<string>("all")
  const [filterPriority, setFilterPriority] = useState<string>("all")
  const [filterIncidentType, setFilterIncidentType] = useState<string>("all")

  // Use ref to track drag state more reliably
  const isDraggingOperationRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor),
  )

  const moveOperationRight = useCallback((operationId: string) => {
    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const currentColumnIndex = columns.findIndex((col) => col.status.includes(op.status))
          if (currentColumnIndex < columns.length - 1) {
            const nextColumn = columns[currentColumnIndex + 1]
            return { ...op, status: nextColumn.status[0] as OperationStatus }
          }
        }

        return op
      }),
    )
  }, [setOperations])

  const moveOperationLeft = useCallback((operationId: string) => {
    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          const currentColumnIndex = columns.findIndex((col) => col.status.includes(op.status))
          if (currentColumnIndex > 0) {
            const prevColumn = columns[currentColumnIndex - 1]
            return { ...op, status: prevColumn.status[0] as OperationStatus }
          }
        }

        return op
      }),
    )
  }, [setOperations])

  useEffect(() => {
    setIsMounted(true)
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Just highlight the operation from the map, don't auto-open modal
  useEffect(() => {
    if (highlightParam) {
      setHighlightedOperationId(highlightParam)
      // Clear highlight after 3 seconds
      const timer = setTimeout(() => setHighlightedOperationId(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [highlightParam])

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Esc to blur search input
      if (e.key === 'Escape') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          (e.target as HTMLElement).blur()
          return
        }
      }

      // Ignore other shortcuts if typing in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Vehicle assignment shortcuts (1-5) - works on hovered operation
      const vehicleShortcut = vehicleTypes.find(vt => vt.key === e.key)
      if (vehicleShortcut && hoveredOperationId) {
        setOperations(ops => ops.map(op =>
          op.id === hoveredOperationId ? { ...op, vehicle: vehicleShortcut.name } : op
        ))
        return
      }

      // Navigation shortcuts - works on hovered operation
      if (e.key === '>' || e.key === '.') {
        e.preventDefault()
        if (hoveredOperationId) {
          moveOperationRight(hoveredOperationId)
        }
      } else if (e.key === '<' || e.key === ',') {
        e.preventDefault()
        if (hoveredOperationId) {
          moveOperationLeft(hoveredOperationId)
        }
      } else if (e.key === '/') {
        e.preventDefault()
        document.getElementById('search-input')?.focus()
      } else if (e.key === '?') {
        e.preventDefault()
        setShortcutsModalOpen(true)
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        setNewEmergencyModalOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [hoveredOperationId, moveOperationLeft, moveOperationRight, setOperations])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
    const activeData = event.active.data.current
    if (activeData?.type === "operation") {
      isDraggingOperationRef.current = true
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    setOverId(event.over?.id as string | null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    setOverId(null)

    // Reset dragging state after a delay to prevent click from firing
    if (isDraggingOperationRef.current) {
      setTimeout(() => {
        isDraggingOperationRef.current = false
      }, 200)
    }

    if (!over) return

    const activeData = active.data.current
    const overData = over.data.current

    // Person dropped on operation
    if (activeData?.type === "person" && overData?.type === "operation-drop") {
      const person = activeData.person as Person
      const operationId = overData.operationId as string

      // Only allow assignment if person is available (not already assigned)
      if (person.status === "available") {
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id === operationId && !op.crew.includes(person.name)) {
              return {
                ...op,
                crew: [...op.crew, person.name],
              }
            }
            return op
          }),
        )

        setPersonnel((people) =>
          people.map((p) => (p.id === person.id ? { ...p, status: "assigned" as PersonStatus } : p)),
        )
      }
    }

    if (activeData?.type === "material" && overData?.type === "operation-drop") {
      const material = activeData.material as Material
      const operationId = overData.operationId as string

      // Only allow assignment if material is available (not already assigned)
      if (material.status === "available") {
        setOperations((ops) =>
          ops.map((op) => {
            if (op.id === operationId && !op.materials.includes(material.id)) {
              return {
                ...op,
                materials: [...op.materials, material.id],
              }
            }
            return op
          }),
        )

        setMaterials((mats) =>
          mats.map((m) => (m.id === material.id ? { ...m, status: "assigned" as Material["status"] } : m)),
        )
      }
    }

    // Operation reordering within same column
    if (activeData?.type === "operation" && overData?.type === "operation") {
      const activeOp = activeData.operation as Operation
      const overOp = overData.operation as Operation

      // Only reorder if in the same column
      if (activeOp.status === overOp.status && active.id !== over.id) {
        setOperations((ops) => {
          const activeIndex = ops.findIndex((op) => op.id === activeOp.id)
          const overIndex = ops.findIndex((op) => op.id === overOp.id)

          return arrayMove(ops, activeIndex, overIndex)
        })
      } else if (activeOp.status !== overOp.status) {
        // If different columns, move the dragged operation to the target's column
        const newStatus = overOp.status
        setOperations((ops) => ops.map((op) => (op.id === activeOp.id ? { ...op, status: newStatus } : op)))
      }
    }

    // Operation dropped on column
    if (activeData?.type === "operation" && overData?.type === "column") {
      const operation = activeData.operation as Operation
      const columnId = overData.columnId as string
      const targetColumn = columns.find((col) => col.id === columnId)

      if (targetColumn) {
        const newStatus = targetColumn.status[0] as OperationStatus

        setOperations((ops) => ops.map((op) => (op.id === operation.id ? { ...op, status: newStatus } : op)))
      }
    }

    // Operation dropped on another operation card (when dragging operations)
    // In this case, find the column containing the operation we're over and move to that column
    if (activeData?.type === "operation" && overData?.type === "operation-drop") {
      const draggedOperation = activeData.operation as Operation
      const targetOperationId = overData.operationId as string

      // Find which column contains the target operation
      const targetOperation = operations.find(op => op.id === targetOperationId)
      if (targetOperation) {
        const newStatus = targetOperation.status
        setOperations((ops) => ops.map((op) => (op.id === draggedOperation.id ? { ...op, status: newStatus } : op)))
      }
    }
  }

  const filteredPersonnel = personnel.filter((p) =>
    p.name.toLowerCase().includes(personnelSearchQuery.toLowerCase()) ||
    p.role.toLowerCase().includes(personnelSearchQuery.toLowerCase())
  )

  const filteredMaterials = materials.filter((m) =>
    m.name.toLowerCase().includes(materialSearchQuery.toLowerCase()) ||
    m.category.toLowerCase().includes(materialSearchQuery.toLowerCase())
  )

  const groupedPersonnel = filteredPersonnel.reduce(
    (acc, person) => {
      if (!acc[person.role]) acc[person.role] = []
      acc[person.role].push(person)
      return acc
    },
    {} as Record<PersonRole, Person[]>,
  )

  const groupedMaterials = filteredMaterials.reduce(
    (acc, material) => {
      if (!acc[material.category]) acc[material.category] = []
      acc[material.category].push(material)
      return acc
    },
    {} as Record<string, Material[]>,
  )

  const filteredOperations = operations.filter((op) => {
    // Text search filter
    const matchesSearch =
      op.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
      op.incidentType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (op.vehicle && op.vehicle.toLowerCase().includes(searchQuery.toLowerCase()))

    // Vehicle filter
    const matchesVehicle =
      filterVehicle === "all" ||
      (filterVehicle === "none" && !op.vehicle) ||
      op.vehicle === filterVehicle

    // Priority filter
    const matchesPriority = filterPriority === "all" || op.priority === filterPriority

    // Incident type filter
    const matchesIncidentType = filterIncidentType === "all" || op.incidentType === filterIncidentType

    return matchesSearch && matchesVehicle && matchesPriority && matchesIncidentType
  })

  const handlePersonClick = (person: Person) => {
    if (person.status === "assigned") {
      // Find the operation this person is assigned to
      const assignedOp = operations.find(op => op.crew.includes(person.name))
      if (assignedOp) {
        setHighlightedOperationId(assignedOp.id)
        setTimeout(() => setHighlightedOperationId(null), 3000)
      }
    }
  }

  const handleMaterialClick = (material: Material) => {
    if (material.status === "assigned") {
      // Find the operation this material is assigned to
      const assignedOp = operations.find(op => op.materials.includes(material.id))
      if (assignedOp) {
        setHighlightedOperationId(assignedOp.id)
        setTimeout(() => setHighlightedOperationId(null), 3000)
      }
    }
  }

  const activeDragItem = activeId
    ? personnel.find((p) => `person-${p.id}` === activeId) || 
      materials.find((m) => `material-${m.id}` === activeId) ||
      operations.find((op) => `operation-${op.id}` === activeId)
    : null

  const handleCardClick = (operation: Operation) => {
    // Don't open modal if we just finished dragging
    if (isDraggingOperationRef.current) {
      return
    }
    setSelectedOperation(operation)
    setDetailModalOpen(true)
  }

  const handleOperationUpdate = (updates: Partial<Operation>) => {
    if (!selectedOperation) return
    updateOperation(selectedOperation.id, updates)
    setSelectedOperation({ ...selectedOperation, ...updates })
  }

  // Don't render drag and drop until client-side to avoid hydration errors
  if (!isMounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-red-600 to-orange-600 text-2xl shadow-lg">
              🚒
            </div>
            <h1 className="text-2xl font-bold tracking-tight">KP Rück Dashboard</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search-input"
                type="text"
                placeholder="Suchen... (Taste /)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-72 pl-9"
              />
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Filter className="h-4 w-4" />
                  Filter
                  {(filterVehicle !== "all" || filterPriority !== "all" || filterIncidentType !== "all") && (
                    <Badge variant="secondary" className="ml-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                      {[filterVehicle !== "all", filterPriority !== "all", filterIncidentType !== "all"].filter(Boolean).length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Filter</h4>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Fahrzeug</Label>
                    <Select value={filterVehicle} onValueChange={setFilterVehicle}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Alle</SelectItem>
                        <SelectItem value="none">Keine</SelectItem>
                        {vehicleTypes.map((vt) => (
                          <SelectItem key={vt.name} value={vt.name || ""}>
                            {vt.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Priorität</Label>
                    <Select value={filterPriority} onValueChange={setFilterPriority}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Alle</SelectItem>
                        <SelectItem value="high">Hoch</SelectItem>
                        <SelectItem value="medium">Mittel</SelectItem>
                        <SelectItem value="low">Niedrig</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Einsatzart</Label>
                    <Select value={filterIncidentType} onValueChange={setFilterIncidentType}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Alle</SelectItem>
                        {emergencyTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(filterVehicle !== "all" || filterPriority !== "all" || filterIncidentType !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setFilterVehicle("all")
                        setFilterPriority("all")
                        setFilterIncidentType("all")
                      }}
                    >
                      Filter zurücksetzen
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-4 py-2.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-lg font-semibold tabular-nums">
                {isMounted && currentTime ? currentTime.toLocaleTimeString("de-DE") : "--:--:--"}
              </span>
            </div>

            <Link href="/map">
              <Button variant="outline" className="gap-2">
                <Map className="h-4 w-4" />
                Lagekarte
              </Button>
            </Link>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShortcutsModalOpen(true)}
              className="rounded-lg"
            >
              <HelpCircle className="h-5 w-5" />
            </Button>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside className="w-64 border-r border-border/50 bg-card/30 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="mb-4">
              <h2 className="text-base font-bold text-foreground">Verfügbare Personen</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {personnel.filter((p) => p.status === "available").length} verfügbar
              </p>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Suchen..."
                value={personnelSearchQuery}
                onChange={(e) => setPersonnelSearchQuery(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>

            <div className="space-y-4">
              {(["Fahrer", "Reko/EL/FU", "Mannschaft"] as PersonRole[]).map((role) => (
                <div key={role}>
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{role}</h3>
                  <div className="space-y-2">
                    {groupedPersonnel[role]?.map((person) => (
                      <DraggablePerson
                        key={person.id}
                        person={person}
                        onClick={() => handlePersonClick(person)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Main Kanban Board */}
          <main className="flex-1 overflow-x-auto p-4 bg-zinc-950/20">
            <div className="flex h-full gap-4">
              {columns.map((column) => {
                const columnOps = filteredOperations.filter((op) => column.status.includes(op.status))
                return (
                  <DroppableColumn
                    key={column.id}
                    column={column}
                    operations={columnOps}
                    onRemoveCrew={removeCrew}
                    onRemoveMaterial={removeMaterial}
                    onCardClick={handleCardClick}
                    onCardHover={setHoveredOperationId}
                    highlightedOperationId={highlightedOperationId}
                    isDraggingRef={isDraggingOperationRef}
                    activeId={activeId}
                    overId={overId}
                  />
                )
              })}
            </div>
          </main>

          <aside className="w-64 border-l border-border/50 bg-card/30 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="mb-4">
              <h2 className="text-base font-bold text-foreground">Verfügbares Material</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {materials.filter((m) => m.status === "available").length} verfügbar
              </p>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Suchen..."
                value={materialSearchQuery}
                onChange={(e) => setMaterialSearchQuery(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>

            <div className="space-y-4">
              {Object.entries(groupedMaterials).map(([category, items]) => (
                <div key={category}>
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{category}</h3>
                  <div className="space-y-2">
                    {items.map((material) => (
                      <DraggableMaterial
                        key={material.id}
                        material={material}
                        onClick={() => handleMaterialClick(material)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <footer className="border-t border-border/50 bg-card/50 backdrop-blur-sm px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button size="sm" className="gap-2" onClick={() => setNewEmergencyModalOpen(true)}>
                <Plus className="h-4 w-4" />
                Neuer Einsatz
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              Tastaturkürzel: 1-5 für Fahrzeuge • &lt; &gt; für Navigation • N für neuen Einsatz • / für Suche • Esc zum Verlassen • ? für Hilfe
            </div>
          </div>
        </footer>

        <DragOverlay>
          {activeId && activeDragItem ? (
            "role" in activeDragItem ? (
              <Card className="cursor-move border border-primary bg-card p-3 shadow-2xl">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="font-medium text-sm text-foreground">{activeDragItem.name}</span>
                </div>
              </Card>
            ) : "category" in activeDragItem ? (
              <Card className="cursor-move border border-primary bg-card p-3 shadow-2xl">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm text-foreground">{activeDragItem.name}</span>
                </div>
              </Card>
            ) : (
              <Card className="cursor-move border-2 border-primary p-4 shadow-2xl bg-zinc-800/90 backdrop-blur">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  <span className="font-bold text-foreground">{activeDragItem.location}</span>
                </div>
              </Card>
            )
          ) : null}
        </DragOverlay>

        <OperationDetailModal
          operation={selectedOperation}
          open={detailModalOpen}
          onOpenChange={setDetailModalOpen}
          onUpdate={handleOperationUpdate}
        />

        <ShortcutsModal
          open={shortcutsModalOpen}
          onOpenChange={setShortcutsModalOpen}
        />

        <NewEmergencyModal
          open={newEmergencyModalOpen}
          onOpenChange={setNewEmergencyModalOpen}
          onCreateOperation={createOperation}
          nextOperationId={getNextOperationId()}
        />
      </div>
    </DndContext>
  )
}
