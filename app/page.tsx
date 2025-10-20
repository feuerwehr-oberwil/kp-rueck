"use client"

import { useState, useEffect, useCallback } from "react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, Plus, Truck, MapPin, Flame, Clock, Users, Package, X, Printer, Send, ChevronRight, ChevronLeft, HelpCircle } from 'lucide-react'
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
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { useDraggable, useDroppable } from "@dnd-kit/core"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

type PersonStatus = "available" | "assigned"
type PersonRole = "Mannschaft" | "Fahrer" | "Reko/EL/FU"

interface Person {
  id: string
  name: string
  role: PersonRole
  status: PersonStatus
}

type OperationStatus = "incoming" | "ready" | "enroute" | "active" | "returning" | "complete"
type VehicleType = "TLF" | "Pio" | "Unimog" | "Trawa" | "Mawa" | null

interface Operation {
  id: string
  location: string
  vehicle: VehicleType
  incidentType: string
  dispatchTime: Date
  crew: string[]
  priority: "high" | "medium" | "low"
  status: OperationStatus
  coordinates: [number, number]
  materials: string[]
  notes: string
  contact: string
}

interface Material {
  id: string
  name: string
  category: string
  status: "available" | "assigned"
}

const initialMaterials: Material[] = [
  { id: "m1", name: "Wasserpumpe TP 15/8", category: "Pumpen", status: "available" },
  { id: "m2", name: "Schlauchpaket B", category: "Schläuche", status: "available" },
  { id: "m3", name: "Schlauchpaket C", category: "Schläuche", status: "available" },
  { id: "m4", name: "Atemschutzgerät", category: "Atemschutz", status: "assigned" },
  { id: "m5", name: "Wärmebildkamera", category: "Spezialgerät", status: "available" },
  { id: "m6", name: "Hydraulisches Rettungsgerät", category: "Spezialgerät", status: "available" },
  { id: "m7", name: "Schaummittel 200L", category: "Löschmittel", status: "available" },
  { id: "m8", name: "Stromerzeuger 5kW", category: "Technik", status: "available" },
]

const initialPersonnel: Person[] = [
  { id: "1", name: "M. Schmidt", role: "Fahrer", status: "available" },
  { id: "2", name: "A. Müller", role: "Reko/EL/FU", status: "available" },
  { id: "3", name: "T. Weber", role: "Mannschaft", status: "available" },
  { id: "4", name: "S. Fischer", role: "Mannschaft", status: "available" },
  { id: "5", name: "K. Wagner", role: "Fahrer", status: "available" },
  { id: "6", name: "L. Becker", role: "Mannschaft", status: "available" },
  { id: "7", name: "P. Hoffmann", role: "Reko/EL/FU", status: "available" },
  { id: "8", name: "J. Schulz", role: "Mannschaft", status: "available" },
]

const initialOperations: Operation[] = [
  {
    id: "1",
    location: "Hauptstraße 45",
    vehicle: "TLF",
    incidentType: "Wohnungsbrand",
    dispatchTime: new Date(Date.now() - 1000 * 60 * 12),
    crew: ["M. Schmidt", "T. Weber"],
    priority: "high",
    status: "active",
    coordinates: [51.1657, 10.4515],
    materials: ["m1", "m4"],
    notes: "",
    contact: "",
  },
  {
    id: "2",
    location: "Industriepark Nord",
    vehicle: "Pio",
    incidentType: "Technische Hilfe",
    dispatchTime: new Date(Date.now() - 1000 * 60 * 5),
    crew: ["K. Wagner"],
    priority: "medium",
    status: "enroute",
    coordinates: [51.1757, 10.4615],
    materials: ["m6"],
    notes: "",
    contact: "",
  },
  {
    id: "3",
    location: "Bahnhofstraße 12",
    vehicle: null,
    incidentType: "Fehlalarm",
    dispatchTime: new Date(Date.now() - 1000 * 60 * 45),
    crew: [],
    priority: "low",
    status: "returning",
    coordinates: [51.1557, 10.4415],
    materials: [],
    notes: "",
    contact: "",
  },
  {
    id: "4",
    location: "Waldweg 8",
    vehicle: null,
    incidentType: "Ölspur",
    dispatchTime: new Date(Date.now() - 1000 * 60 * 2),
    crew: [],
    priority: "low",
    status: "ready",
    coordinates: [51.1857, 10.4715],
    materials: [],
    notes: "",
    contact: "",
  },
]

const columns = [
  { id: "incoming", title: "Eingegangen / Bereit", status: ["incoming", "ready"], color: "bg-zinc-800/50" },
  { id: "enroute", title: "Unterwegs", status: ["enroute"], color: "bg-blue-900/30" },
  { id: "active", title: "Erkundung / Einsatz", status: ["active"], color: "bg-orange-900/30" },
  { id: "returning", title: "AS-Raum / Rückmeldung", status: ["returning"], color: "bg-green-900/30" },
  { id: "complete", title: "Abschluss / Archiv", status: ["complete"], color: "bg-zinc-900/50" },
]

const vehicleTypes: { key: string; name: VehicleType }[] = [
  { key: "1", name: "TLF" },
  { key: "2", name: "Pio" },
  { key: "3", name: "Unimog" },
  { key: "4", name: "Trawa" },
  { key: "5", name: "Mawa" },
]

function getTimeSince(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 1000 / 60)
  if (minutes < 60) return `${minutes} Min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

function DraggablePerson({ person }: { person: Person }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `person-${person.id}`,
    data: { type: "person", person },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-move border border-border/50 bg-card/80 backdrop-blur-sm p-3 transition-all hover:border-primary/50 hover:shadow-md hover:bg-card"
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

function DraggableMaterial({ material }: { material: Material }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `material-${material.id}`,
    data: { type: "material", material },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-move border border-border/50 bg-card/80 backdrop-blur-sm p-3 transition-all hover:border-primary/50 hover:shadow-md hover:bg-card"
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
  onClick 
}: { 
  operation: Operation
  columnColor: string
  onRemoveCrew: (crewName: string) => void
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `operation-${operation.id}`,
    data: { type: "operation", operation },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`${columnColor} cursor-pointer border border-border/50 backdrop-blur-sm p-4 transition-all hover:border-primary/50 hover:shadow-lg`}
      onClick={onClick}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <MapPin className="h-5 w-5 flex-shrink-0 text-primary mt-0.5" />
            <div className="min-w-0">
              <h3 className="font-bold text-base text-foreground leading-tight">{operation.location}</h3>
              {operation.vehicle && (
                <p className="text-xs text-muted-foreground mt-0.5">Fahrzeug: {operation.vehicle}</p>
              )}
            </div>
          </div>
          <Badge
            variant={
              operation.priority === "high" ? "destructive" : operation.priority === "medium" ? "default" : "secondary"
            }
            className="text-xs flex-shrink-0"
          >
            {operation.priority === "high" ? "Hoch" : operation.priority === "medium" ? "Mittel" : "Niedrig"}
          </Badge>
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
                    {...listeners}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {operation.materials.length > 0 && (
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">{operation.materials.length} Material(ien)</span>
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
  onCardClick,
}: {
  column: (typeof columns)[0]
  operations: Operation[]
  onRemoveCrew: (operationId: string, crewName: string) => void
  onCardClick: (operation: Operation) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column.id}`,
    data: { type: "column", columnId: column.id },
  })

  return (
    <div ref={setNodeRef} className="flex w-80 flex-shrink-0 flex-col">
      <div className={`mb-3 rounded-lg ${column.color} border border-border/50 px-4 py-3 ${isOver ? "ring-2 ring-primary" : ""}`}>
        <h2 className="text-balance text-sm font-bold uppercase tracking-wide text-foreground">{column.title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{operations.length} Einsätze</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {operations.map((operation) => (
          <DroppableOperationCard 
            key={operation.id} 
            operation={operation} 
            columnColor={column.color}
            onRemoveCrew={(crewName) => onRemoveCrew(operation.id, crewName)}
            onClick={() => onCardClick(operation)}
          />
        ))}
      </div>
    </div>
  )
}

function DroppableOperationCard({ 
  operation, 
  columnColor,
  onRemoveCrew,
  onClick
}: { 
  operation: Operation
  columnColor: string
  onRemoveCrew: (crewName: string) => void
  onClick: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `operation-drop-${operation.id}`,
    data: { type: "operation-drop", operationId: operation.id },
  })

  return (
    <div ref={setNodeRef} className={isOver ? "ring-2 ring-primary rounded-lg" : ""}>
      <DraggableOperation 
        operation={operation} 
        columnColor={columnColor}
        onRemoveCrew={onRemoveCrew}
        onClick={onClick}
      />
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
  if (!operation) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-3">
            <MapPin className="h-6 w-6 text-primary" />
            {operation.location}
          </DialogTitle>
          <DialogDescription className="text-base">
            Einsatz-ID: {operation.id} • {getTimeSince(operation.dispatchTime)} seit Alarmierung
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold text-muted-foreground">Einsatzart</Label>
              <div className="flex items-center gap-2 mt-1">
                <Flame className="h-4 w-4 text-orange-500" />
                <span className="text-base font-medium">{operation.incidentType}</span>
              </div>
            </div>
            <div>
              <Label className="text-sm font-semibold text-muted-foreground">Fahrzeug</Label>
              <div className="flex items-center gap-2 mt-1">
                <Truck className="h-4 w-4 text-primary" />
                <span className="text-base font-medium">{operation.vehicle || "Nicht zugewiesen"}</span>
              </div>
            </div>
            <div>
              <Label className="text-sm font-semibold text-muted-foreground">Priorität</Label>
              <Badge
                variant={
                  operation.priority === "high" ? "destructive" : operation.priority === "medium" ? "default" : "secondary"
                }
                className="mt-1"
              >
                {operation.priority === "high" ? "Hoch" : operation.priority === "medium" ? "Mittel" : "Niedrig"}
              </Badge>
            </div>
            <div>
              <Label className="text-sm font-semibold text-muted-foreground">Status</Label>
              <p className="text-base font-medium mt-1 capitalize">{operation.status}</p>
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

export default function FireStationDashboard() {
  const [currentTime, setCurrentTime] = useState(new Date())
  const [searchQuery, setSearchQuery] = useState("")
  const [personnel, setPersonnel] = useState<Person[]>(initialPersonnel)
  const [materials, setMaterials] = useState<Material[]>(initialMaterials)
  const [operations, setOperations] = useState<Operation[]>(initialOperations)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false)
  const [focusedOperationId, setFocusedOperationId] = useState<string | null>(null)

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
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Vehicle assignment shortcuts (1-5)
      const vehicleShortcut = vehicleTypes.find(vt => vt.key === e.key)
      if (vehicleShortcut && focusedOperationId) {
        setOperations(ops => ops.map(op => 
          op.id === focusedOperationId ? { ...op, vehicle: vehicleShortcut.name } : op
        ))
        return
      }

      // Navigation shortcuts
      if (e.key === '>' || e.key === '.') {
        e.preventDefault()
        if (focusedOperationId) {
          moveOperationRight(focusedOperationId)
        }
      } else if (e.key === '<' || e.key === ',') {
        e.preventDefault()
        if (focusedOperationId) {
          moveOperationLeft(focusedOperationId)
        }
      } else if (e.key === '/') {
        e.preventDefault()
        document.getElementById('search-input')?.focus()
      } else if (e.key === '?') {
        e.preventDefault()
        setShortcutsModalOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [focusedOperationId, moveOperationLeft, moveOperationRight])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over) return

    const activeData = active.data.current
    const overData = over.data.current

    // Person dropped on operation
    if (activeData?.type === "person" && overData?.type === "operation-drop") {
      const person = activeData.person as Person
      const operationId = overData.operationId as string

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

    if (activeData?.type === "material" && overData?.type === "operation-drop") {
      const material = activeData.material as Material
      const operationId = overData.operationId as string

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
  }

  const groupedPersonnel = personnel.reduce(
    (acc, person) => {
      if (!acc[person.role]) acc[person.role] = []
      acc[person.role].push(person)
      return acc
    },
    {} as Record<PersonRole, Person[]>,
  )

  const groupedMaterials = materials.reduce(
    (acc, material) => {
      if (!acc[material.category]) acc[material.category] = []
      acc[material.category].push(material)
      return acc
    },
    {} as Record<string, Material[]>,
  )

  const filteredOperations = operations.filter(
    (op) =>
      op.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
      op.incidentType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (op.vehicle && op.vehicle.toLowerCase().includes(searchQuery.toLowerCase())),
  )

  const activeDragItem = activeId
    ? personnel.find((p) => `person-${p.id}` === activeId) || 
      materials.find((m) => `material-${m.id}` === activeId) ||
      operations.find((op) => `operation-${op.id}` === activeId)
    : null

  const handleRemoveCrew = (operationId: string, crewName: string) => {
    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          return {
            ...op,
            crew: op.crew.filter((name) => name !== crewName),
          }
        }
        return op
      }),
    )

    const person = personnel.find((p) => p.name === crewName)
    if (person) {
      const stillAssigned = operations.some(op => op.id !== operationId && op.crew.includes(crewName))
      if (!stillAssigned) {
        setPersonnel((people) =>
          people.map((p) => (p.id === person.id ? { ...p, status: "available" as PersonStatus } : p)),
        )
      }
    }
  }

  const handleCardClick = (operation: Operation) => {
    setSelectedOperation(operation)
    setDetailModalOpen(true)
    setFocusedOperationId(operation.id)
  }

  const handleOperationUpdate = (updates: Partial<Operation>) => {
    if (!selectedOperation) return
    
    setOperations(ops => ops.map(op => 
      op.id === selectedOperation.id ? { ...op, ...updates } : op
    ))
    setSelectedOperation({ ...selectedOperation, ...updates })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
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

            <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-4 py-2.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-lg font-semibold tabular-nums">{currentTime.toLocaleTimeString("de-DE")}</span>
            </div>

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

            <div className="space-y-4">
              {(["Fahrer", "Reko/EL/FU", "Mannschaft"] as PersonRole[]).map((role) => (
                <div key={role}>
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{role}</h3>
                  <div className="space-y-2">
                    {groupedPersonnel[role]?.map((person) => (
                      <DraggablePerson key={person.id} person={person} />
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
                    onRemoveCrew={handleRemoveCrew}
                    onCardClick={handleCardClick}
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

            <div className="space-y-4">
              {Object.entries(groupedMaterials).map(([category, items]) => (
                <div key={category}>
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{category}</h3>
                  <div className="space-y-2">
                    {items.map((material) => (
                      <DraggableMaterial key={material.id} material={material} />
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
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                Neuer Einsatz
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              Tastaturkürzel: 1-5 für Fahrzeuge • &lt; &gt; für Navigation • / für Suche • ? für Hilfe
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
      </div>
    </DndContext>
  )
}
