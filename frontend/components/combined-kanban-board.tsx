"use client"

import { useState, useEffect, useRef } from "react"
import { useOperations, type Operation, type Material, type Person, type PersonRole } from "@/lib/contexts/operations-context"
import { columns } from "@/lib/kanban-utils"
import { DroppableColumn } from "@/components/kanban/droppable-column"
import { DraggablePerson } from "@/components/kanban/draggable-person"
import { DraggableMaterial } from "@/components/kanban/draggable-material"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"

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

  // Monitor drag events globally for drag-and-drop functionality
  useEffect(() => {
    if (!isMounted) return

    const { monitorForElements } = require('@atlaskit/pragmatic-drag-and-drop/element/adapter')
    const { extractClosestEdge } = require('@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge')

    return monitorForElements({
      onDragStart({ source }: any) {
        const data = source.data
        if (data.type === "person") {
          // Handle person dragging if needed
        } else if (data.type === "material") {
          // Handle material dragging if needed
        } else if (data.type === "operation") {
          // Operation is being dragged
        }
      },
      onDrop({ source, location }: any) {
        const destination = location.current.dropTargets[0]
        if (!destination) return

        const sourceData = source.data
        const destData = destination.data

        // Person dropped on operation
        if (sourceData.type === "person" && destData.type === "operation-drop") {
          const person = sourceData.person
          const operationId = destData.operationId as string

          if (person.status === "available") {
            assignPersonToOperation(person.id, person.name, operationId)
          }
        }

        // Material dropped on operation
        if (sourceData.type === "material" && destData.type === "operation-drop") {
          const material = sourceData.material
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
              updateOperation(draggedOp.id, { status: targetColumn.status[0] as any })
            }
          }
        }
      },
    })
  }, [isMounted, operations, assignPersonToOperation, assignMaterialToOperation, setOperations, updateOperation])

  // Filter personnel and materials
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
    {} as Record<PersonRole, Person[]>
  )

  const groupedMaterials = filteredMaterials.reduce(
    (acc, material) => {
      if (!acc[material.category]) acc[material.category] = []
      acc[material.category].push(material)
      return acc
    },
    {} as Record<string, Material[]>
  )

  const handlePersonClick = (person: Person) => {
    if (person.status === "assigned") {
      // Find the operation this person is assigned to
      const assignedOp = operations.find(op => op.crew.includes(person.name))
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
      <aside className="w-64 border-r border-border/50 bg-card/30 backdrop-blur-sm p-4 overflow-y-auto">
        {/* Section Toggle */}
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

        {/* Personnel Section */}
        {(sectionView === "both" || sectionView === "personnel") && (
          <div className="mb-6">
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
                isDraggingRef={isDraggingRef}
                materials={materials}
                formatLocation={formatLocation}
              />
            )
          })}
        </div>
      </main>
    </div>
  )
}
