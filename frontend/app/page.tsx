"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Plus, MapPin, Flame, Clock, Users, Package, X, Printer, Send, HelpCircle, Map, Edit, Filter, Trash2, Check } from 'lucide-react'
import { Kbd } from "@/components/ui/kbd"
import { ProtectedRoute } from "@/components/protected-route"
import { UserMenu } from "@/components/user-menu"
import { toast } from "sonner"
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { attachClosestEdge, extractClosestEdge, type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useOperations, type Person, type Operation, type Material, type PersonRole, type PersonStatus, type OperationStatus, type VehicleType } from "@/lib/contexts/operations-context"
import { ConnectionStatus } from "@/components/connection-status"

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

// Helper function to format incident types to German labels
function getIncidentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    brandbekaempfung: 'Brandbekämpfung',
    elementarereignis: 'Elementarereignis',
    strassenrettung: 'Strassenrettung',
    technische_hilfeleistung: 'Technische Hilfeleistung',
    oelwehr: 'Ölwehr',
    chemiewehr: 'Chemiewehr',
    strahlenwehr: 'Strahlenwehr',
    einsatz_bahnanlagen: 'Einsatz Bahnanlagen',
    bma_unechte_alarme: 'BMA / Unechte Alarme',
    dienstleistungen: 'Dienstleistungen',
    diverse_einsaetze: 'Diverse Einsätze',
    gerettete_menschen: 'Gerettete Menschen',
    gerettete_tiere: 'Gerettete Tiere',
  }
  return labels[type] || type
}

function getTimeSince(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 1000 / 60)
  if (minutes < 60) return `${minutes}'`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}'`
}

function DraggablePerson({ person, onClick, disabled }: { person: Person; onClick?: () => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const canDrag = !disabled && person.status === "available"

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return

    return draggable({
      element,
      getInitialData: () => ({ type: "person", person }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [person, canDrag])

  return (
    <Card
      ref={ref}
      onClick={onClick}
      style={{ opacity: isDragging ? 0.5 : 1 }}
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
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const canDrag = !disabled && material.status === "available"

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return

    return draggable({
      element,
      getInitialData: () => ({ type: "material", material }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    })
  }, [material, canDrag])

  return (
    <Card
      ref={ref}
      onClick={onClick}
      style={{ opacity: isDragging ? 0.5 : 1 }}
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
  materials,
  index,
  columnOperations,
  formatLocation,
}: {
  operation: Operation
  columnColor: string
  onRemoveCrew: (crewName: string) => void
  onRemoveMaterial: (materialId: string) => void
  onClick: () => void
  onHover: (opId: string | null) => void
  isHighlighted?: boolean
  isDraggingRef: React.MutableRefObject<boolean>
  materials: Material[]
  index: number
  columnOperations: Operation[]
  formatLocation: (address: string) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isOver, setIsOver] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    return combine(
      draggable({
        element,
        getInitialData: () => ({ type: "operation", operation, index }),
        onDragStart: () => {
          setIsDragging(true)
          isDraggingRef.current = true
        },
        onDrop: () => {
          setIsDragging(false)
          // Delay to prevent click from firing
          setTimeout(() => {
            isDraggingRef.current = false
          }, 200)
        },
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          // Can drop anything on operation cards
          return true
        },
        getData: ({ input }) => {
          return attachClosestEdge(
            { type: "operation-drop", operationId: operation.id, index },
            { element, input, allowedEdges: ['top', 'bottom'] }
          )
        },
        onDragEnter: ({ self }) => {
          setIsOver(true)
          const edge = extractClosestEdge(self.data)
          setClosestEdge(edge)
        },
        onDrag: ({ self }) => {
          const edge = extractClosestEdge(self.data)
          setClosestEdge(edge)
        },
        onDragLeave: () => {
          setIsOver(false)
          setClosestEdge(null)
        },
        onDrop: () => {
          setIsOver(false)
          setClosestEdge(null)
        },
      })
    )
  }, [operation, index, isDraggingRef])

  return (
    <div className="relative w-full">
      {closestEdge === 'top' && <DropIndicator edge="top" gap="4px" />}
      <Card
        ref={ref}
        style={{ opacity: isDragging ? 0.5 : 1 }}
        className={`${columnColor} border border-border/50 backdrop-blur-sm p-4 transition-all hover:border-primary/50 hover:shadow-lg ${isOver ? "ring-2 ring-primary" : ""} ${isHighlighted ? "ring-4 ring-accent animate-pulse" : ""}`}
        onMouseEnter={() => onHover(operation.id)}
        onMouseLeave={() => onHover(null)}
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            {/* Draggable area */}
            <div className="flex items-start gap-2 min-w-0 flex-1 cursor-move">
              <div
                className={`h-2.5 w-2.5 rounded-full flex-shrink-0 mt-1 ${
                  operation.priority === "high" ? "bg-red-500" : operation.priority === "medium" ? "bg-yellow-500" : "bg-green-500"
                }`}
                title={operation.priority === "high" ? "Hohe Priorität" : operation.priority === "medium" ? "Mittlere Priorität" : "Niedrige Priorität"}
              />
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-base text-foreground leading-tight break-words">{formatLocation(operation.location)}</h3>
                {operation.vehicle && (
                  <p className="text-xs text-muted-foreground mt-0.5 break-words">Fahrzeug: {operation.vehicle}</p>
                )}
              </div>
            </div>
            {/* Non-draggable icons area */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation()
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
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground break-words">{getIncidentTypeLabel(operation.incidentType)}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="font-mono text-sm text-muted-foreground">
                {operation.dispatchTime.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {getTimeSince(operation.statusChangedAt || operation.dispatchTime)}
            </span>
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
                  const mat = materials.find(m => m.id === matId)
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
      {closestEdge === 'bottom' && <DropIndicator edge="bottom" gap="4px" />}
    </div>
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
  materials,
  formatLocation,
}: {
  column: (typeof columns)[0]
  operations: Operation[]
  onRemoveCrew: (operationId: string, crewName: string) => void
  onRemoveMaterial: (operationId: string, materialId: string) => void
  onCardClick: (operation: Operation) => void
  onCardHover: (opId: string | null) => void
  highlightedOperationId: string | null
  isDraggingRef: React.MutableRefObject<boolean>
  materials: Material[]
  formatLocation: (address: string) => string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        // Only allow operations to be dropped on empty columns
        return source.data.type === "operation"
      },
      getData: () => ({ type: "column", columnId: column.id }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [column.id])

  return (
    <div className={`flex w-80 flex-shrink-0 flex-col transition-all ${isOver ? "ring-2 ring-primary rounded-lg scale-[1.02]" : ""}`}>
      <div className={`mb-3 rounded-lg ${column.color} border ${isOver ? "border-primary border-2" : "border-border/50"} px-4 py-3 transition-all`}>
        <h2 className="text-balance text-sm font-bold uppercase tracking-wide text-foreground">{column.title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{operations.length} Einsätze</p>
      </div>

      <div ref={ref} className={`flex-1 space-y-3 overflow-y-auto p-2 rounded-lg transition-all min-h-[200px] relative ${isOver && operations.length === 0 ? "bg-primary/20 border-2 border-dashed border-primary" : ""}`}>
        {isOver && operations.length === 0 && (
          <div className="absolute inset-0 bg-primary/10 pointer-events-none z-10 rounded-lg" />
        )}
        <div className="space-y-3">
          {operations.map((operation, index) => (
            <DraggableOperation
              key={operation.id}
              operation={operation}
              columnColor={column.color}
              onRemoveCrew={(crewName) => onRemoveCrew(operation.id, crewName)}
              onRemoveMaterial={(materialId) => onRemoveMaterial(operation.id, materialId)}
              onClick={() => onCardClick(operation)}
              onHover={onCardHover}
              isHighlighted={highlightedOperationId === operation.id}
              isDraggingRef={isDraggingRef}
              materials={materials}
              index={index}
              columnOperations={operations}
              formatLocation={formatLocation}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function OperationDetailModal({
  operation,
  open,
  onOpenChange,
  onUpdate,
  onDelete,
  materials,
}: {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (updates: Partial<Operation>) => void
  onDelete: (operationId: string) => void
  materials: Material[]
}) {
  const { formatLocation } = useOperations()
  const [locationSearchResults, setLocationSearchResults] = useState<Array<{
    display_name: string
    lat: string
    lon: string
  }>>([])
  const [showLocationResults, setShowLocationResults] = useState(false)
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [editingLocation, setEditingLocation] = useState("")

  // Sync editingLocation with operation.location when modal opens
  useEffect(() => {
    if (operation) {
      setEditingLocation(operation.location)
    }
  }, [operation?.id])

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
    // Store the full address from Nominatim for geocoding purposes
    setEditingLocation(result.display_name)
    onUpdate({
      location: result.display_name,
      coordinates: [parseFloat(result.lat), parseFloat(result.lon)]
    })
    setShowLocationResults(false)
    setLocationSearchResults([])
  }

  // Debounced search
  useEffect(() => {
    if (!editingLocation) return

    const timer = setTimeout(() => {
      searchLocation(editingLocation)
    }, 500)

    return () => clearTimeout(timer)
  }, [editingLocation])

  if (!operation) return null

  // Check if coordinates are valid
  const hasValidCoordinates =
    operation.coordinates &&
    operation.coordinates.length === 2 &&
    typeof operation.coordinates[0] === 'number' &&
    typeof operation.coordinates[1] === 'number' &&
    !isNaN(operation.coordinates[0]) &&
    !isNaN(operation.coordinates[1]) &&
    operation.coordinates[0] >= -90 &&
    operation.coordinates[0] <= 90 &&
    operation.coordinates[1] >= -180 &&
    operation.coordinates[1] <= 180

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-3">
            <MapPin className="h-6 w-6 text-primary" />
            {operation.location ? formatLocation(operation.location) : "Einsatz-Details"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            Einsatz-ID: {operation.id} • {getTimeSince(operation.dispatchTime)} seit Alarmierung
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Location - Full Width */}
          <div className="relative col-span-full">
            <Label htmlFor="edit-location" className="text-sm font-semibold text-muted-foreground">
              Einsatzort
            </Label>
            <div className="relative">
              <Input
                id="edit-location"
                value={editingLocation}
                onChange={(e) => {
                  setEditingLocation(e.target.value)
                  onUpdate({ location: e.target.value })
                }}
                onFocus={() => {
                  if (locationSearchResults.length > 0) {
                    setShowLocationResults(true)
                  }
                }}
                onBlur={() => {
                  // Close dropdown after a short delay to allow click on dropdown item
                  setTimeout(() => setShowLocationResults(false), 200)
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
                    onMouseDown={(e) => {
                      // Use onMouseDown instead of onClick to fire before onBlur
                      e.preventDefault()
                      handleLocationSelect(result)
                    }}
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

          {/* Coordinates */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-muted-foreground">
                Koordinaten
              </Label>
              {hasValidCoordinates && (
                <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                  <MapPin className="h-3.5 w-3.5" />
                  <Check className="h-3.5 w-3.5" />
                  <span className="font-medium">Gültige Koordinaten</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Latitude */}
              <div>
                <Label htmlFor="edit-location-lat" className="text-xs text-muted-foreground">
                  Breitengrad (Lat)
                </Label>
                <Input
                  id="edit-location-lat"
                  type="number"
                  step="any"
                  value={operation.coordinates?.[0] ?? ''}
                  onChange={(e) =>
                    onUpdate({
                      coordinates: [
                        e.target.value ? parseFloat(e.target.value) : 0,
                        operation.coordinates?.[1] ?? 0
                      ]
                    })
                  }
                  placeholder="47.5164"
                  className="mt-1"
                />
              </div>

              {/* Longitude */}
              <div>
                <Label htmlFor="edit-location-lng" className="text-xs text-muted-foreground">
                  Längengrad (Lng)
                </Label>
                <Input
                  id="edit-location-lng"
                  type="number"
                  step="any"
                  value={operation.coordinates?.[1] ?? ''}
                  onChange={(e) =>
                    onUpdate({
                      coordinates: [
                        operation.coordinates?.[0] ?? 0,
                        e.target.value ? parseFloat(e.target.value) : 0
                      ]
                    })
                  }
                  placeholder="7.5618"
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* Other fields - Grid */}
          <div className="grid grid-cols-2 gap-4">
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
                    {materials.find(m => m.id === matId)?.name || matId}
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
            {operation.status === "complete" && (
              <Button
                variant="destructive"
                className="gap-2"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-4 w-4" />
                Löschen
              </Button>
            )}
            <Button variant="outline" className="ml-auto bg-transparent" onClick={() => onOpenChange(false)}>
              Schliessen
            </Button>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Einsatz wirklich löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dieser Vorgang kann nicht rückgängig gemacht werden. Der Einsatz "{operation.location}" wird permanent gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDelete(operation.id)
                setShowDeleteConfirm(false)
                onOpenChange(false)
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
                  <Kbd>{vt.key}</Kbd>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Navigation</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Karte nach rechts bewegen</span>
                <Kbd>&gt;</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Karte nach links bewegen</span>
                <Kbd>&lt;</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Suche fokussieren</span>
                <Kbd>/</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Suche verlassen</span>
                <Kbd>Esc</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Neuer Einsatz</span>
                <Kbd>N</Kbd>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                <span className="text-sm font-medium">Diese Hilfe anzeigen</span>
                <Kbd>?</Kbd>
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
    priority: "low" as "high" | "medium" | "low",
    vehicle: null as VehicleType,
    coordinates: [47.51637699933488, 7.561800450458299] as [number, number],
    status: "incoming" as OperationStatus,
    crew: [] as string[],
    materials: [] as string[],
    notes: "",
    contact: "",
    statusChangedAt: null as Date | null,
  })

  const [availableVehicles, setAvailableVehicles] = useState<Array<{ name: string; type: string }>>([])
  const [homeCity, setHomeCity] = useState<string>("")
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)

  const [locationSearchResults, setLocationSearchResults] = useState<Array<{
    display_name: string
    lat: string
    lon: string
  }>>([])
  const [showLocationResults, setShowLocationResults] = useState(false)
  const [isSearchingLocation, setIsSearchingLocation] = useState(false)

  // Load vehicles and settings when modal opens
  useEffect(() => {
    const loadModalData = async () => {
      if (!open) return

      setIsLoadingSettings(true)
      try {
        // Fetch vehicles and settings in parallel
        const [vehiclesResponse, settingsResponse] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/vehicles/`),
          fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/settings/`)
        ])

        if (vehiclesResponse.ok) {
          const vehicles = await vehiclesResponse.json()
          setAvailableVehicles(vehicles.map((v: any) => ({ name: v.name, type: v.type })))
        }

        if (settingsResponse.ok) {
          const settings = await settingsResponse.json()
          if (settings.home_city) {
            setHomeCity(settings.home_city)
          }
        }
      } catch (error) {
        console.error('Failed to load modal data:', error)
      } finally {
        setIsLoadingSettings(false)
      }
    }

    loadModalData()
  }, [open])

  // Smart location formatting based on home city
  const formatLocationForDisplay = (fullAddress: string): string => {
    if (!homeCity) return fullAddress

    // Parse the full address to extract components
    const parts = fullAddress.split(',').map(s => s.trim())

    // Check if the address contains the home city
    const homeCityParts = homeCity.split(',').map(s => s.trim())
    const addressContainsHomeCity = homeCityParts.some(part =>
      parts.some(addressPart => addressPart.includes(part))
    )

    if (addressContainsHomeCity) {
      // Return only the street name (first part)
      return parts[0] || fullAddress
    } else {
      // Address is outside home city, include street and city
      // Typically: "Street, Town, Region, Country" -> "Street, Town"
      return parts.slice(0, 2).join(', ')
    }
  }

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
    // Store the FULL address for geocoding, not the formatted one
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
      priority: "low",
      vehicle: null,
      coordinates: [47.51637699933488, 7.561800450458299],
      status: "incoming",
      crew: [],
      materials: [],
      notes: "",
      contact: "",
      statusChangedAt: null,
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
          {/* Location - Full Width */}
          <div className="relative">
            <Label htmlFor="location" className="text-sm font-semibold text-muted-foreground">
              Einsatzort *
            </Label>
            <div className="relative">
              <Input
                id="location"
                placeholder="z.B. Hauptstrasse 45"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                onFocus={() => {
                  if (locationSearchResults.length > 0) {
                    setShowLocationResults(true)
                  }
                }}
                onBlur={() => {
                  // Close dropdown after a short delay to allow click on dropdown item
                  setTimeout(() => setShowLocationResults(false), 200)
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
                    onMouseDown={(e) => {
                      // Use onMouseDown instead of onClick to fire before onBlur
                      e.preventDefault()
                      handleLocationSelect(result)
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors border-b border-border/50 last:border-b-0"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 flex-shrink-0 text-primary" />
                        <span className="text-sm font-medium">{formatLocationForDisplay(result.display_name)}</span>
                      </div>
                      <span className="text-xs text-muted-foreground pl-6">{result.display_name}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Other fields - Grid */}
          <div className="grid grid-cols-2 gap-4">
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
                disabled={isLoadingSettings}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder={isLoadingSettings ? "Laden..." : "Nicht zugewiesen"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nicht zugewiesen</SelectItem>
                  {availableVehicles.map((vehicle) => (
                    <SelectItem key={vehicle.name} value={vehicle.name}>
                      {vehicle.name}
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
  const { personnel, setPersonnel, materials, setMaterials, operations, setOperations, homeCity, formatLocation, refreshOperations, removeCrew, removeMaterial, updateOperation, createOperation, getNextOperationId, assignPersonToOperation, assignMaterialToOperation, deleteOperation } = useOperations()
  const searchParams = useSearchParams()
  const highlightParam = searchParams.get("highlight")

  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState("")
  const [materialSearchQuery, setMaterialSearchQuery] = useState("")
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false)
  const [newEmergencyModalOpen, setNewEmergencyModalOpen] = useState(false)
  const [hoveredOperationId, setHoveredOperationId] = useState<string | null>(null)
  const [highlightedOperationId, setHighlightedOperationId] = useState<string | null>(null)
  const [filterVehicle, setFilterVehicle] = useState<string>("all")
  const [filterPriority, setFilterPriority] = useState<string>("all")
  const [filterIncidentType, setFilterIncidentType] = useState<string>("all")
  const [draggingItem, setDraggingItem] = useState<Person | Material | Operation | null>(null)

  // Use ref to track drag state more reliably
  const isDraggingOperationRef = useRef(false)

  const moveOperationRight = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex < columns.length - 1) {
      const nextColumn = columns[currentColumnIndex + 1]
      const newStatus = nextColumn.status[0] as OperationStatus
      updateOperation(operationId, { status: newStatus })
    }
  }, [operations, updateOperation])

  const moveOperationLeft = useCallback((operationId: string) => {
    const operation = operations.find(op => op.id === operationId)
    if (!operation) return

    const currentColumnIndex = columns.findIndex((col) => col.status.includes(operation.status))
    if (currentColumnIndex > 0) {
      const prevColumn = columns[currentColumnIndex - 1]
      const newStatus = prevColumn.status[0] as OperationStatus
      updateOperation(operationId, { status: newStatus })
    }
  }, [operations, updateOperation])

  useEffect(() => {
    setIsMounted(true)
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Refresh operations immediately when Kanban page loads
  useEffect(() => {
    refreshOperations()
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
        updateOperation(hoveredOperationId, { vehicle: vehicleShortcut.name })
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
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        document.getElementById('personnel-search-input')?.focus()
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        document.getElementById('material-search-input')?.focus()
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

  // Monitor drag events globally
  useEffect(() => {
    if (!isMounted) return

    const { monitorForElements } = require('@atlaskit/pragmatic-drag-and-drop/element/adapter')

    return monitorForElements({
      onDragStart({ source }: any) {
        const data = source.data
        if (data.type === "person") {
          setDraggingItem(data.person as Person)
        } else if (data.type === "material") {
          setDraggingItem(data.material as Material)
        } else if (data.type === "operation") {
          setDraggingItem(data.operation as Operation)
        }
      },
      onDrop({ source, location }: any) {
        setDraggingItem(null)

        const destination = location.current.dropTargets[0]
        if (!destination) return

        const sourceData = source.data
        const destData = destination.data

        // Person dropped on operation
        if (sourceData.type === "person" && destData.type === "operation-drop") {
          const person = sourceData.person as Person
          const operationId = destData.operationId as string

          if (person.status === "available") {
            assignPersonToOperation(person.id, person.name, operationId)
          }
        }

        // Material dropped on operation
        if (sourceData.type === "material" && destData.type === "operation-drop") {
          const material = sourceData.material as Material
          const operationId = destData.operationId as string

          if (material.status === "available") {
            assignMaterialToOperation(material.id, operationId)
          }
        }

        // Operation reordering/moving
        if (sourceData.type === "operation") {
          const draggedOp = sourceData.operation as Operation
          const sourceIndex = sourceData.index as number

          // Dropped on another operation
          if (destData.type === "operation-drop") {
            const targetOpId = destData.operationId as string
            const targetIndex = destData.index as number
            const edge = extractClosestEdge(destData)

            // Find the target operation to determine its column
            const targetOp = operations.find(op => op.id === targetOpId)
            if (!targetOp) return

            // Same column - reorder
            if (draggedOp.status === targetOp.status) {
              setOperations((ops) => {
                const sameColumnOps = ops.filter(op => op.status === draggedOp.status)
                const otherOps = ops.filter(op => op.status !== draggedOp.status)

                // Remove dragged operation
                const filtered = sameColumnOps.filter(op => op.id !== draggedOp.id)

                // Calculate new index based on edge
                let newIndex = targetIndex
                if (edge === 'bottom') {
                  newIndex = targetIndex + 1
                }

                // Adjust index if we're moving down in the same list
                if (sourceIndex < targetIndex) {
                  newIndex = newIndex - 1
                }

                // Insert at new position
                const reordered = [
                  ...filtered.slice(0, newIndex),
                  draggedOp,
                  ...filtered.slice(newIndex)
                ]

                return [...otherOps, ...reordered]
              })
            } else {
              // Different column - move to new column with position
              const targetColumnOps = operations.filter(op => op.status === targetOp.status)

              setOperations((ops) => {
                // Update status
                const updatedOp = { ...draggedOp, status: targetOp.status }

                // Remove from old position
                const withoutDragged = ops.filter(op => op.id !== draggedOp.id)

                // Get operations in target column
                const targetColOps = withoutDragged.filter(op => op.status === targetOp.status)
                const otherOps = withoutDragged.filter(op => op.status !== targetOp.status)

                // Calculate insert index
                let insertIndex = targetIndex
                if (edge === 'bottom') {
                  insertIndex = targetIndex + 1
                }

                // Insert at position
                const reordered = [
                  ...targetColOps.slice(0, insertIndex),
                  updatedOp,
                  ...targetColOps.slice(insertIndex)
                ]

                return [...otherOps, ...reordered]
              })
            }
          }
          // Dropped on empty column area
          else if (destData.type === "column") {
            const targetColumnId = destData.columnId as string
            const targetColumn = columns.find(col => col.id === targetColumnId)

            if (targetColumn && draggedOp.status !== targetColumn.status[0]) {
              updateOperation(draggedOp.id, { status: targetColumn.status[0] as OperationStatus })
            }
          }
        }
      },
    })
  }, [isMounted, operations, assignPersonToOperation, assignMaterialToOperation, setOperations, updateOperation])

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

  const handleOperationDelete = async (operationId: string) => {
    try {
      await deleteOperation(operationId)
      toast.success("Einsatz gelöscht", {
        description: "Der Einsatz wurde erfolgreich aus der Datenbank entfernt.",
      })
    } catch (error) {
      console.error('Failed to delete operation:', error)
      toast.error("Fehler beim Löschen", {
        description: "Der Einsatz konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.",
      })
    }
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
    <ProtectedRoute>
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
                placeholder="Suchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-72 pl-9"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Kbd>/</Kbd>
              </div>
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

            <ConnectionStatus />

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

            <UserMenu />
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
                id="personnel-search-input"
                type="text"
                placeholder="Suchen..."
                value={personnelSearchQuery}
                onChange={(e) => setPersonnelSearchQuery(e.target.value)}
                className="h-8 pl-7 pr-8 text-xs"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                <Kbd className="h-4 text-[10px]">P</Kbd>
              </div>
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
                    materials={materials}
                    formatLocation={formatLocation}
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
                id="material-search-input"
                type="text"
                placeholder="Suchen..."
                value={materialSearchQuery}
                onChange={(e) => setMaterialSearchQuery(e.target.value)}
                className="h-8 pl-7 pr-8 text-xs"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                <Kbd className="h-4 text-[10px]">M</Kbd>
              </div>
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

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Tastaturkürzel:</span>
              <div className="flex items-center gap-1">
                <Kbd className="h-4 text-[10px]">1-5</Kbd>
                <span>Fahrzeuge</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <Kbd className="h-4 text-[10px]">&lt;</Kbd>
                <Kbd className="h-4 text-[10px]">&gt;</Kbd>
                <span>Navigation</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <Kbd className="h-4 text-[10px]">N</Kbd>
                <span>Neuer Einsatz</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <Kbd className="h-4 text-[10px]">/</Kbd>
                <span>Suche</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <Kbd className="h-4 text-[10px]">Esc</Kbd>
                <span>Verlassen</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <Kbd className="h-4 text-[10px]">?</Kbd>
                <span>Hilfe</span>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* Drag Preview Overlay */}
      {draggingItem && (
        <div
          style={{
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: 9999,
            left: 0,
            top: 0,
          }}
        >
          {"role" in draggingItem ? (
            <Card className="cursor-move border border-primary bg-card p-3 shadow-2xl opacity-80">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-medium text-sm text-foreground">{draggingItem.name}</span>
              </div>
            </Card>
          ) : "category" in draggingItem ? (
            <Card className="cursor-move border border-primary bg-card p-3 shadow-2xl opacity-80">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm text-foreground">{draggingItem.name}</span>
              </div>
            </Card>
          ) : (
            <Card className="cursor-move border-2 border-primary p-4 shadow-2xl bg-zinc-800/90 backdrop-blur opacity-80">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                <span className="font-bold text-foreground">{draggingItem.location}</span>
              </div>
            </Card>
          )}
        </div>
      )}

      <OperationDetailModal
        operation={selectedOperation}
        open={detailModalOpen}
        onOpenChange={setDetailModalOpen}
        onUpdate={handleOperationUpdate}
        onDelete={handleOperationDelete}
        materials={materials}
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
    </ProtectedRoute>
  )
}
