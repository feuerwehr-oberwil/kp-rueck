"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CopyButton } from "@/components/ui/copy-button"
import { Search, Plus, Clock, Package, QrCode, Filter } from 'lucide-react'
import { Kbd } from "@/components/ui/kbd"
import { ProtectedRoute } from "@/components/protected-route"
import { PageNavigation } from "@/components/page-navigation"
import { toast } from "sonner"
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useOperations, type Person, type Operation, type Material, type PersonRole, type OperationStatus } from "@/lib/contexts/operations-context"
import { useEvent } from "@/lib/contexts/event-context"
import { apiClient } from "@/lib/api-client"
import { QRCodeSVG } from 'qrcode.react'
import { useRekoNotifications } from "@/lib/hooks/use-reko-notifications"
import { columns } from "@/lib/kanban-utils"
import { incidentTypeKeys, getIncidentTypeLabel } from "@/lib/incident-types"
import { DraggablePerson } from "@/components/kanban/draggable-person"
import { DraggableMaterial } from "@/components/kanban/draggable-material"
import { DroppableColumn } from "@/components/kanban/droppable-column"
import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { ShortcutsModal } from "@/components/kanban/shortcuts-modal"
import { NewEmergencyModal } from "@/components/kanban/new-emergency-modal"

export default function FireStationDashboard() {
  const {
    personnel,
    materials,
    operations,
    setOperations,
    formatLocation,
    refreshOperations,
    removeCrew,
    removeMaterial,
    removeVehicle,
    updateOperation,
    createOperation,
    getNextOperationId,
    assignPersonToOperation,
    assignMaterialToOperation,
    assignVehicleToOperation,
    deleteOperation
  } = useOperations()

  const { selectedEvent } = useEvent()
  const searchParams = useSearchParams()
  const highlightParam = searchParams.get("highlight")

  // Enable reko notifications for all incidents
  useRekoNotifications(operations)

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
  const [vehicleTypes, setVehicleTypes] = useState<Array<{ key: string; name: string; id: string }>>([])
  const [showLeftSidebar, setShowLeftSidebar] = useState(true)
  const [showRightSidebar, setShowRightSidebar] = useState(true)
  const [qrDialogOpen, setQrDialogOpen] = useState(false)
  const [checkInUrl, setCheckInUrl] = useState<string | null>(null)

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

  // Load vehicles from API to populate vehicle types for shortcuts
  useEffect(() => {
    const loadVehicles = async () => {
      try {
        const vehicles = await apiClient.getVehicles()
        // Create vehicle types array with keyboard shortcuts (1-5), including IDs
        const typesWithKeys = vehicles.slice(0, 5).map((vehicle, index) => ({
          key: String(index + 1),
          name: vehicle.name,
          id: vehicle.id
        }))
        setVehicleTypes(typesWithKeys)
      } catch (error) {
        console.error('Failed to load vehicles:', error)
      }
    }
    loadVehicles()
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
      // Toggle vehicle assignment: assign if not assigned, unassign if assigned
      const vehicleShortcut = vehicleTypes.find(vt => vt.key === e.key)
      if (vehicleShortcut && hoveredOperationId) {
        const operation = operations.find(op => op.id === hoveredOperationId)
        if (operation) {
          // Check if vehicle is already assigned
          const isAssigned = operation.vehicles.includes(vehicleShortcut.name)
          if (isAssigned) {
            // Unassign the vehicle
            removeVehicle(hoveredOperationId, vehicleShortcut.name)
          } else {
            // Assign the vehicle
            assignVehicleToOperation(vehicleShortcut.id, vehicleShortcut.name, hoveredOperationId)
          }
        }
        return
      }

      // Priority assignment shortcuts (Shift+1-3) - works on hovered operation
      if (e.shiftKey && hoveredOperationId) {
        if (e.key === '1' || e.key === '!') {
          e.preventDefault()
          updateOperation(hoveredOperationId, { priority: 'low' })
          return
        } else if (e.key === '2' || e.key === '@') {
          e.preventDefault()
          updateOperation(hoveredOperationId, { priority: 'medium' })
          return
        } else if (e.key === '3' || e.key === '#') {
          e.preventDefault()
          updateOperation(hoveredOperationId, { priority: 'high' })
          return
        }
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
      } else if (e.key === '[') {
        e.preventDefault()
        setShowLeftSidebar(prev => !prev)
      } else if (e.key === ']') {
        e.preventDefault()
        setShowRightSidebar(prev => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [hoveredOperationId, moveOperationLeft, moveOperationRight, operations, vehicleTypes, removeVehicle, assignVehicleToOperation, updateOperation])

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

  const handleVehicleRemove = (operationId: string, vehicleName: string) => {
    if (!selectedOperation) return
    removeVehicle(operationId, vehicleName)
    // Update selectedOperation to remove the vehicle from the UI immediately
    setSelectedOperation({
      ...selectedOperation,
      vehicles: selectedOperation.vehicles.filter(v => v !== vehicleName)
    })
  }

  const handleVehicleAssign = (vehicleId: string, vehicleName: string, operationId: string) => {
    if (!selectedOperation) return
    assignVehicleToOperation(vehicleId, vehicleName, operationId)
    // Update selectedOperation to add the vehicle to the UI immediately
    setSelectedOperation({
      ...selectedOperation,
      vehicles: [...selectedOperation.vehicles, vehicleName]
    })
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

  const generateCheckInQR = async () => {
    if (!selectedEvent) {
      toast.error('Fehler', {
        description: 'Bitte wählen Sie zuerst ein Ereignis aus.',
      })
      return
    }

    try {
      const response = await apiClient.generateCheckInLink(selectedEvent.id)
      // Build full URL for QR code
      const fullUrl = `${window.location.origin}${response.link}`
      setCheckInUrl(fullUrl)
      setQrDialogOpen(true)
    } catch (error) {
      console.error('Failed to generate check-in link:', error)
      toast.error('Fehler', {
        description: 'QR-Code konnte nicht generiert werden. Bitte versuchen Sie es erneut.',
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
            {selectedEvent ? (
              <>
                <h1 className="text-2xl font-bold tracking-tight">{selectedEvent.name}</h1>
                {selectedEvent.training_flag && (
                  <Badge variant="secondary">Übung</Badge>
                )}
              </>
            ) : (
              <h1 className="text-2xl font-bold tracking-tight text-muted-foreground">Kein Ereignis ausgewählt</h1>
            )}
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
                        {incidentTypeKeys.map((typeKey) => (
                          <SelectItem key={typeKey} value={typeKey}>
                            {getIncidentTypeLabel(typeKey)}
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

            <PageNavigation
              currentPage="kanban"
              vehicleTypes={vehicleTypes}
              onShortcutsOpen={() => setShortcutsModalOpen(true)}
            />
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {showLeftSidebar && (
            <aside className="w-64 border-r border-border/50 bg-card/30 backdrop-blur-sm p-4 overflow-y-auto">
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
            </aside>
          )}

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
                    onRemoveVehicle={removeVehicle}
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

          {showRightSidebar && (
            <aside className="w-64 border-l border-border/50 bg-card/30 backdrop-blur-sm p-4 overflow-y-auto">
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
            </aside>
          )}
        </div>

        <footer className="border-t border-border/50 bg-card/50 backdrop-blur-sm px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button size="sm" className="gap-2" onClick={() => setNewEmergencyModalOpen(true)}>
                <Plus className="h-4 w-4" />
                Neuer Einsatz
              </Button>
              <Button size="sm" variant="outline" className="gap-2" onClick={generateCheckInQR}>
                <QrCode className="h-4 w-4" />
                Check-In QR
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
                <Kbd className="h-4 text-[10px]">[</Kbd>
                <span>Personen</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <Kbd className="h-4 text-[10px]">]</Kbd>
                <span>Material</span>
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
        vehicleTypes={vehicleTypes}
        onAssignVehicle={handleVehicleAssign}
        onRemoveVehicle={handleVehicleRemove}
      />

      <ShortcutsModal
        open={shortcutsModalOpen}
        onOpenChange={setShortcutsModalOpen}
        vehicleTypes={vehicleTypes}
      />

      <NewEmergencyModal
        open={newEmergencyModalOpen}
        onOpenChange={setNewEmergencyModalOpen}
        onCreateOperation={createOperation}
        nextOperationId={getNextOperationId()}
      />

      {/* QR Code Dialog */}
      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Personal Check-In QR-Code</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {checkInUrl && (
              <>
                <QRCodeSVG
                  value={checkInUrl}
                  size={300}
                  level="H"
                  includeMargin
                />
                <p className="text-sm text-muted-foreground text-center">
                  Scannen Sie diesen QR-Code, um auf die Personal Check-In Seite zuzugreifen.
                </p>
                <div className="w-full flex items-center gap-2">
                  <div className="flex-1 p-2 bg-secondary rounded text-xs font-mono break-all">
                    {checkInUrl}
                  </div>
                  <CopyButton
                    text={checkInUrl}
                    className="flex-shrink-0"
                  />
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </ProtectedRoute>
  )
}
