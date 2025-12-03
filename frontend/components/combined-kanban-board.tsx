"use client"

import { useState, useEffect, useRef } from "react"
import { useOperations, type Operation, type Material, type Person, type PersonRole } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { apiClient } from "@/lib/api-client"
import { columns } from "@/lib/kanban-utils"
import { DroppableColumn } from "@/components/kanban/droppable-column"
import { DraggablePerson } from "@/components/kanban/draggable-person"
import { DraggableMaterial } from "@/components/kanban/draggable-material"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import { useKanbanDragDrop } from "@/lib/hooks/use-kanban-drag-drop"
import { useResourceFiltering } from "@/lib/hooks/use-resource-filtering"

interface CombinedKanbanBoardProps {
  onCardHover: (operationId: string | null) => void
  onCardClick: (operation: Operation) => void
  highlightedOperationId: string | null
}

export default function CombinedKanbanBoard({
  onCardHover,
  onCardClick,
  highlightedOperationId
}: CombinedKanbanBoardProps) {
  const {
    operations,
    materials,
    personnel,
    formatLocation,
    removeCrew,
    removeMaterial,
    removeVehicle,
    setOperations,
    updateOperation,
    assignPersonToOperation,
    assignMaterialToOperation,
  } = useOperations()

  const { selectedEvent } = useEvent()

  const [isMounted, setIsMounted] = useState(false)
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState("")
  const [materialSearchQuery, setMaterialSearchQuery] = useState("")
  const [highlightedOperationIdLocal, setHighlightedOperationIdLocal] = useState<string | null>(null)
  const [sectionView, setSectionView] = useState<"both" | "personnel" | "materials">("both")
  const isDraggingRef = useRef(false)
  const kanbanScrollRef = useRef<HTMLDivElement>(null)
  const operationRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Scroll to highlighted operation when it changes
  useEffect(() => {
    if (highlightedOperationId) {
      const element = operationRefs.current.get(highlightedOperationId)
      if (element && kanbanScrollRef.current) {
        // Scroll the operation card into view with smooth behavior
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center'
        })
      }
    }
  }, [highlightedOperationId])

  // Use shared drag-and-drop hook
  useKanbanDragDrop({
    isMounted,
    operations,
    setOperations,
    updateOperation,
    assignPersonToOperation,
    assignMaterialToOperation,
  })

  // Use shared resource filtering hook
  const { filteredPersonnel, filteredMaterials, groupedPersonnel, groupedMaterials } = useResourceFiltering(
    personnel,
    materials,
    personnelSearchQuery,
    materialSearchQuery
  )

  const handlePersonClick = async (person: Person) => {
    if (person.status === "assigned") {
      // First try to find operation where person is directly assigned to crew
      let assignedOp = operations.find(op => op.crew.includes(person.name))

      // If not found directly assigned, check if they're a driver for a vehicle
      if (!assignedOp && selectedEvent) {
        try {
          const specialFunctions = await apiClient.getPersonnelSpecialFunctions(selectedEvent.id, person.id)
          const driverFunction = specialFunctions.find(f => f.function_type === 'driver')

          if (driverFunction && driverFunction.vehicle_name) {
            // Find operation that has this vehicle assigned
            assignedOp = operations.find(op => op.vehicles.includes(driverFunction.vehicle_name!))
          }
        } catch (error) {
          console.error('Failed to load special functions for personnel:', error)
        }
      }

      if (assignedOp) {
        setHighlightedOperationIdLocal(assignedOp.id)
        setTimeout(() => setHighlightedOperationIdLocal(null), 3000)
      }
    }
  }

  const handleMaterialClick = (material: Material) => {
    if (material.status === "assigned") {
      // Find the operation this material is assigned to
      const assignedOp = operations.find(op => op.materials.includes(material.id))
      if (assignedOp) {
        setHighlightedOperationIdLocal(assignedOp.id)
        setTimeout(() => setHighlightedOperationIdLocal(null), 3000)
      }
    }
  }

  // Don't render drag and drop until client-side to avoid hydration errors
  if (!isMounted) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950/20">
        <div className="text-muted-foreground">Laden...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Left Sidebar - Personnel and Materials */}
      <aside className="w-64 border-r border-border/50 bg-card/30 backdrop-blur-sm flex flex-col">
        {/* Sticky Section Toggle */}
        <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm p-4 pb-0">
          <div className="mb-4 pb-4 border-b border-border/50">
            <div className="flex gap-1">
              <Button
                variant={sectionView === "both" ? "default" : "outline"}
                size="sm"
                onClick={() => setSectionView("both")}
                className="flex-1 h-8 text-xs"
              >
                Beide
              </Button>
              <Button
                variant={sectionView === "personnel" ? "default" : "outline"}
                size="sm"
                onClick={() => setSectionView("personnel")}
                className="flex-1 h-8 text-xs"
              >
                Personen
              </Button>
              <Button
                variant={sectionView === "materials" ? "default" : "outline"}
                size="sm"
                onClick={() => setSectionView("materials")}
                className="flex-1 h-8 text-xs"
              >
                Material
              </Button>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 pt-0">
          {/* Personnel Section */}
          {(sectionView === "both" || sectionView === "personnel") && (
            <div className="mb-6">
              <div className="sticky top-0 z-[5] bg-card/95 backdrop-blur-sm -mx-4 px-4 pt-2 pb-0">
                <div className="mb-4">
                  <h2 className="text-base font-bold text-foreground">Verfügbare Personen</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {personnel.filter((p) => p.status === "available").length} von {personnel.length} verfügbar
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
              </div>

              <div className="space-y-4">
                {Object.keys(groupedPersonnel).map((role) => (
                  <div key={role}>
                    <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{role}</h3>
                    <div className="space-y-2">
                      {groupedPersonnel[role as PersonRole]?.map((person) => (
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
            </div>
          )}

          {/* Materials Section */}
          {(sectionView === "both" || sectionView === "materials") && (
            <div>
              <div className="sticky top-0 z-[5] bg-card/95 backdrop-blur-sm -mx-4 px-4 pt-2 pb-0">
                <div className="mb-4">
                  <h2 className="text-base font-bold text-foreground">Verfügbares Material</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {materials.filter((m) => m.status === "available").length} von {materials.length} verfügbar
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
            </div>
          )}
        </div>
      </aside>

      {/* Main Kanban Board */}
      <main className="flex-1 overflow-x-auto p-4 bg-zinc-950/20">
        <div ref={kanbanScrollRef} className="flex h-full gap-4">
          {columns.map((column) => {
            const columnOps = operations.filter((op) => column.status.includes(op.status))
            return (
              <DroppableColumn
                key={column.id}
                column={column}
                operations={columnOps}
                onRemoveCrew={removeCrew}
                onRemoveMaterial={removeMaterial}
                onRemoveVehicle={removeVehicle}
                onCardClick={onCardClick}
                onCardHover={onCardHover}
                highlightedOperationId={highlightedOperationId || highlightedOperationIdLocal}
                hoveredOperationId={null}
                isDraggingRef={isDraggingRef}
                materials={materials}
                formatLocation={formatLocation}
                setOperationRef={(id, el) => {
                  if (el) {
                    operationRefs.current.set(id, el)
                  } else {
                    operationRefs.current.delete(id)
                  }
                }}
              />
            )
          })}
        </div>
      </main>
    </div>
  )
}
