"use client"

import { useState, useMemo, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, Users, Truck, Package, CheckCircle, Circle } from "lucide-react"
import { type Person, type Material } from "@/lib/contexts/operations-context"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface ResourceAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceType: 'crew' | 'vehicles' | 'materials' | null
  operationId: string | null
  personnel: Person[]
  vehicles: Array<{ id: string; name: string; type: string }>
  materials: Material[]
  assignedPersonnel: string[] // Array of personnel names
  assignedVehicles: string[] // Array of vehicle names
  assignedMaterials: string[] // Array of material IDs
  /** Personnel names assigned as Reko for this incident (should be excluded from crew assignment) */
  rekoPersonnelNames?: string[]
  onAssignPerson: (personId: string, personName: string, operationId: string) => void
  onAssignVehicle: (vehicleId: string, vehicleName: string, operationId: string) => void
  onAssignMaterial: (materialId: string, operationId: string) => void
  onRemovePerson: (operationId: string, personName: string) => void
  onRemoveVehicle: (operationId: string, vehicleName: string) => void
  onRemoveMaterial: (operationId: string, materialId: string) => void
}

export function ResourceAssignmentDialog({
  open,
  onOpenChange,
  resourceType,
  operationId,
  personnel,
  vehicles,
  materials,
  assignedPersonnel,
  assignedVehicles,
  assignedMaterials,
  rekoPersonnelNames = [],
  onAssignPerson,
  onAssignVehicle,
  onAssignMaterial,
  onRemovePerson,
  onRemoveVehicle,
  onRemoveMaterial,
}: ResourceAssignmentDialogProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [justAssigned, setJustAssigned] = useState<string | null>(null)

  // Local selection state for crew and materials (deferred assignment)
  // These track which items are SELECTED (checked) in the dialog, separate from actual assigned state
  const [selectedPersonnel, setSelectedPersonnel] = useState<Set<string>>(new Set())
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set())

  // Initialize selection state from assigned state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedPersonnel(new Set(assignedPersonnel))
      setSelectedMaterials(new Set(assignedMaterials))
    }
  }, [open, assignedPersonnel, assignedMaterials])

  // Reset search on close
  useEffect(() => {
    if (!open) {
      setSearchQuery("")
      setSearchFocused(false)
    }
  }, [open])

  // Get resources that can be shown in the dialog
  // For crew: show available personnel OR personnel already assigned to THIS operation (for deselection)
  // Exclude Reko personnel UNLESS they're already assigned to this operation's crew (for removal)
  const selectablePersonnel = useMemo(() => {
    return personnel.filter(p => {
      const isAssignedToCrew = assignedPersonnel.includes(p.name)
      const isRekoPersonnel = rekoPersonnelNames.includes(p.name)

      // Always show if already assigned to this operation's crew (allows deselection)
      if (isAssignedToCrew) return true

      // Don't show Reko personnel for new crew assignments
      if (isRekoPersonnel) return false

      // Show available personnel
      return p.status === 'available'
    })
  }, [personnel, rekoPersonnelNames, assignedPersonnel])

  const availableVehicles = useMemo(() => {
    return vehicles.filter(v => !assignedVehicles.includes(v.name))
  }, [vehicles, assignedVehicles])

  // For materials: show available materials OR materials already assigned to THIS operation (for deselection)
  const selectableMaterials = useMemo(() => {
    return materials.filter(m => m.status === 'available' || assignedMaterials.includes(m.id))
  }, [materials, assignedMaterials])

  // Filter resources by search query
  const filteredPersonnel = useMemo(() => {
    if (!searchQuery.trim()) return selectablePersonnel
    const query = searchQuery.toLowerCase()
    return selectablePersonnel.filter(p => p.name.toLowerCase().includes(query))
  }, [selectablePersonnel, searchQuery])

  const filteredVehicles = useMemo(() => {
    if (!searchQuery.trim()) return availableVehicles
    const query = searchQuery.toLowerCase()
    return availableVehicles.filter(v =>
      v.name.toLowerCase().includes(query) || v.type.toLowerCase().includes(query)
    )
  }, [availableVehicles, searchQuery])

  const filteredMaterials = useMemo(() => {
    if (!searchQuery.trim()) return selectableMaterials
    const query = searchQuery.toLowerCase()
    return selectableMaterials.filter(m =>
      m.name.toLowerCase().includes(query) || m.category.toLowerCase().includes(query)
    )
  }, [selectableMaterials, searchQuery])

  // Check if a resource is selected (for crew/materials) or assigned (for vehicles)
  const isPersonSelected = (personName: string) => selectedPersonnel.has(personName)
  const isVehicleAssigned = (vehicleName: string) => assignedVehicles.includes(vehicleName)
  const isMaterialSelected = (materialId: string) => selectedMaterials.has(materialId)

  // Toggle selection for crew (local state only, doesn't call API)
  const handleTogglePersonSelection = (person: Person) => {
    setSelectedPersonnel(prev => {
      const next = new Set(prev)
      if (next.has(person.name)) {
        next.delete(person.name)
      } else {
        next.add(person.name)
        setJustAssigned(person.id)
        setTimeout(() => setJustAssigned(null), 600)
      }
      return next
    })
  }

  // Vehicles still use instant assignment
  const handleToggleVehicle = (vehicle: { id: string; name: string }) => {
    if (!operationId) return

    const isAssigned = isVehicleAssigned(vehicle.name)
    if (isAssigned) {
      onRemoveVehicle(operationId, vehicle.name)
      toast.success(`${vehicle.name} entfernt`)
    } else {
      onAssignVehicle(vehicle.id, vehicle.name, operationId)
      setJustAssigned(vehicle.id)
      setTimeout(() => setJustAssigned(null), 600)
      toast.success(`${vehicle.name} zugewiesen`)
    }
  }

  // Toggle selection for materials (local state only, doesn't call API)
  const handleToggleMaterialSelection = (material: Material) => {
    setSelectedMaterials(prev => {
      const next = new Set(prev)
      if (next.has(material.id)) {
        next.delete(material.id)
      } else {
        next.add(material.id)
        setJustAssigned(material.id)
        setTimeout(() => setJustAssigned(null), 600)
      }
      return next
    })
  }

  // Commit changes when "Fertig" is clicked (for crew and materials)
  const handleConfirm = () => {
    if (!operationId) {
      onOpenChange(false)
      return
    }

    // Process crew changes
    if (resourceType === 'crew') {
      const currentAssigned = new Set(assignedPersonnel)
      const toAdd = [...selectedPersonnel].filter(name => !currentAssigned.has(name))
      const toRemove = [...currentAssigned].filter(name => !selectedPersonnel.has(name))

      // Add new assignments
      for (const name of toAdd) {
        const person = personnel.find(p => p.name === name)
        if (person) {
          onAssignPerson(person.id, person.name, operationId)
        }
      }

      // Remove unselected
      for (const name of toRemove) {
        onRemovePerson(operationId, name)
      }

      if (toAdd.length > 0 || toRemove.length > 0) {
        toast.success(`Mannschaft aktualisiert`)
      }
    }

    // Process material changes
    if (resourceType === 'materials') {
      const currentAssigned = new Set(assignedMaterials)
      const toAdd = [...selectedMaterials].filter(id => !currentAssigned.has(id))
      const toRemove = [...currentAssigned].filter(id => !selectedMaterials.has(id))

      // Add new assignments
      for (const id of toAdd) {
        onAssignMaterial(id, operationId)
      }

      // Remove unselected
      for (const id of toRemove) {
        onRemoveMaterial(operationId, id)
      }

      if (toAdd.length > 0 || toRemove.length > 0) {
        toast.success(`Material aktualisiert`)
      }
    }

    onOpenChange(false)
  }

  const getDialogTitle = () => {
    switch (resourceType) {
      case 'crew':
        return 'Mannschaft zuweisen'
      case 'vehicles':
        return 'Fahrzeuge zuweisen'
      case 'materials':
        return 'Material zuweisen'
      default:
        return 'Ressourcen zuweisen'
    }
  }

  const getDialogDescription = () => {
    switch (resourceType) {
      case 'crew':
        return `${selectedPersonnel.size} ausgewählt, ${selectablePersonnel.length} verfügbar`
      case 'vehicles':
        return `${assignedVehicles.length} Fahrzeug(e) zugewiesen, ${availableVehicles.length} verfügbar`
      case 'materials':
        return `${selectedMaterials.size} ausgewählt, ${selectableMaterials.length} verfügbar`
      default:
        return ''
    }
  }

  const getIcon = () => {
    switch (resourceType) {
      case 'crew':
        return Users
      case 'vehicles':
        return Truck
      case 'materials':
        return Package
      default:
        return Circle
    }
  }

  const Icon = getIcon()

  // Check if there are pending changes
  const hasPendingChanges = useMemo(() => {
    if (resourceType === 'crew') {
      const currentSet = new Set(assignedPersonnel)
      if (selectedPersonnel.size !== currentSet.size) return true
      for (const name of selectedPersonnel) {
        if (!currentSet.has(name)) return true
      }
      return false
    }
    if (resourceType === 'materials') {
      const currentSet = new Set(assignedMaterials)
      if (selectedMaterials.size !== currentSet.size) return true
      for (const id of selectedMaterials) {
        if (!currentSet.has(id)) return true
      }
      return false
    }
    return false
  }, [resourceType, selectedPersonnel, selectedMaterials, assignedPersonnel, assignedMaterials])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md animate-modal-entrance">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {getDialogTitle()}
          </DialogTitle>
          <DialogDescription>{getDialogDescription()}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              className={cn(
                "pl-9 transition-all",
                searchFocused && "ring-2 ring-primary/50 animate-search-focus"
              )}
            />
          </div>

          {/* Resource List */}
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">
              {resourceType === 'crew' && filteredPersonnel.map((person, index) => {
                const isSelected = isPersonSelected(person.name)
                const wasJustAssigned = justAssigned === person.id
                return (
                  <button
                    key={person.id}
                    onClick={() => handleTogglePersonSelection(person)}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-secondary/30 transition-all text-left hover-delight",
                      "animate-stagger-fade-in",
                      `stagger-delay-${Math.min(index + 1, 5)}`,
                      isSelected && "border-primary/30 bg-primary/5"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {isSelected ? (
                        <CheckCircle className={cn(
                          "h-5 w-5 text-emerald-500 flex-shrink-0",
                          wasJustAssigned && "animate-checkmark-spring"
                        )} />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div>
                        <p className="font-medium text-sm">{person.name}</p>
                        {person.role && (
                          <p className="text-xs text-muted-foreground">{person.role}</p>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <Badge variant="secondary" className="text-xs animate-scale-in">Ausgewählt</Badge>
                    )}
                  </button>
                )
              })}

              {resourceType === 'vehicles' && filteredVehicles.map((vehicle, index) => {
                const isAssigned = isVehicleAssigned(vehicle.name)
                const wasJustAssigned = justAssigned === vehicle.id
                return (
                  <button
                    key={vehicle.id}
                    onClick={() => handleToggleVehicle(vehicle)}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-secondary/30 transition-all text-left hover-delight",
                      "animate-stagger-fade-in",
                      `stagger-delay-${Math.min(index + 1, 5)}`
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {isAssigned ? (
                        <CheckCircle className={cn(
                          "h-5 w-5 text-emerald-500 flex-shrink-0",
                          wasJustAssigned && "animate-checkmark-spring"
                        )} />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div>
                        <p className="font-medium text-sm">{vehicle.name}</p>
                        <p className="text-xs text-muted-foreground">{vehicle.type}</p>
                      </div>
                    </div>
                    {isAssigned && (
                      <Badge variant="secondary" className="text-xs animate-scale-in">Zugewiesen</Badge>
                    )}
                  </button>
                )
              })}

              {resourceType === 'materials' && filteredMaterials.map((material, index) => {
                const isSelected = isMaterialSelected(material.id)
                const wasJustAssigned = justAssigned === material.id
                return (
                  <button
                    key={material.id}
                    onClick={() => handleToggleMaterialSelection(material)}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-secondary/30 transition-all text-left hover-delight",
                      "animate-stagger-fade-in",
                      `stagger-delay-${Math.min(index + 1, 5)}`,
                      isSelected && "border-primary/30 bg-primary/5"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {isSelected ? (
                        <CheckCircle className={cn(
                          "h-5 w-5 text-emerald-500 flex-shrink-0",
                          wasJustAssigned && "animate-checkmark-spring"
                        )} />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div>
                        <p className="font-medium text-sm">{material.name}</p>
                        <p className="text-xs text-muted-foreground">{material.category}</p>
                      </div>
                    </div>
                    {isSelected && (
                      <Badge variant="secondary" className="text-xs animate-scale-in">Ausgewählt</Badge>
                    )}
                  </button>
                )
              })}

              {/* Empty state with personality */}
              {resourceType === 'crew' && filteredPersonnel.length === 0 && (
                <div className="text-center py-12 animate-fade-in-up">
                  <Users className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {searchQuery ? 'Keine Personen gefunden' : 'Keine auswählbaren Personen'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchQuery ? 'Versuchen Sie einen anderen Suchbegriff' : 'Alle Personen sind anderen Einsätzen zugewiesen'}
                  </p>
                </div>
              )}
              {resourceType === 'vehicles' && filteredVehicles.length === 0 && (
                <div className="text-center py-12 animate-fade-in-up">
                  <Truck className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {searchQuery ? 'Keine Fahrzeuge gefunden' : 'Keine verfügbaren Fahrzeuge'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchQuery ? 'Versuchen Sie einen anderen Suchbegriff' : 'Alle Fahrzeuge sind bereits zugewiesen'}
                  </p>
                </div>
              )}
              {resourceType === 'materials' && filteredMaterials.length === 0 && (
                <div className="text-center py-12 animate-fade-in-up">
                  <Package className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {searchQuery ? 'Keine Materialien gefunden' : 'Keine auswählbaren Materialien'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchQuery ? 'Versuchen Sie einen anderen Suchbegriff' : 'Alle Materialien sind anderen Einsätzen zugewiesen'}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            {(resourceType === 'crew' || resourceType === 'materials') && (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Abbrechen
              </Button>
            )}
            <Button
              onClick={resourceType === 'vehicles' ? () => onOpenChange(false) : handleConfirm}
              className="hover-delight"
            >
              Fertig
              {hasPendingChanges && (resourceType === 'crew' || resourceType === 'materials') && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-primary-foreground/20 rounded">
                  Änderungen
                </span>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
