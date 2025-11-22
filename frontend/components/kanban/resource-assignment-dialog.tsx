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

  // Reset search on close
  useEffect(() => {
    if (!open) {
      setSearchQuery("")
      setSearchFocused(false)
    }
  }, [open])

  // Get available resources based on type
  const availablePersonnel = useMemo(() => {
    return personnel.filter(p => p.status === 'available')
  }, [personnel])

  const availableVehicles = useMemo(() => {
    return vehicles.filter(v => !assignedVehicles.includes(v.name))
  }, [vehicles, assignedVehicles])

  const availableMaterials = useMemo(() => {
    return materials.filter(m => m.status === 'available')
  }, [materials])

  // Filter resources by search query
  const filteredPersonnel = useMemo(() => {
    if (!searchQuery.trim()) return availablePersonnel
    const query = searchQuery.toLowerCase()
    return availablePersonnel.filter(p => p.name.toLowerCase().includes(query))
  }, [availablePersonnel, searchQuery])

  const filteredVehicles = useMemo(() => {
    if (!searchQuery.trim()) return availableVehicles
    const query = searchQuery.toLowerCase()
    return availableVehicles.filter(v =>
      v.name.toLowerCase().includes(query) || v.type.toLowerCase().includes(query)
    )
  }, [availableVehicles, searchQuery])

  const filteredMaterials = useMemo(() => {
    if (!searchQuery.trim()) return availableMaterials
    const query = searchQuery.toLowerCase()
    return availableMaterials.filter(m =>
      m.name.toLowerCase().includes(query) || m.category.toLowerCase().includes(query)
    )
  }, [availableMaterials, searchQuery])

  // Check if a resource is assigned
  const isPersonAssigned = (personName: string) => assignedPersonnel.includes(personName)
  const isVehicleAssigned = (vehicleName: string) => assignedVehicles.includes(vehicleName)
  const isMaterialAssigned = (materialId: string) => assignedMaterials.includes(materialId)

  const handleTogglePerson = (person: Person) => {
    if (!operationId) return

    const isAssigned = isPersonAssigned(person.name)
    if (isAssigned) {
      onRemovePerson(operationId, person.name)
      toast.success(`${person.name} entfernt`)
    } else {
      onAssignPerson(person.id, person.name, operationId)
      setJustAssigned(person.id)
      setTimeout(() => setJustAssigned(null), 600)
      toast.success(`${person.name} zugewiesen`)
    }
  }

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

  const handleToggleMaterial = (material: Material) => {
    if (!operationId) return

    const isAssigned = isMaterialAssigned(material.id)
    if (isAssigned) {
      onRemoveMaterial(operationId, material.id)
      toast.success(`${material.name} entfernt`)
    } else {
      onAssignMaterial(material.id, operationId)
      setJustAssigned(material.id)
      setTimeout(() => setJustAssigned(null), 600)
      toast.success(`${material.name} zugewiesen`)
    }
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
        return `${assignedPersonnel.length} Person(en) zugewiesen, ${availablePersonnel.length} verfügbar`
      case 'vehicles':
        return `${assignedVehicles.length} Fahrzeug(e) zugewiesen, ${availableVehicles.length} verfügbar`
      case 'materials':
        return `${assignedMaterials.length} Material(ien) zugewiesen, ${availableMaterials.length} verfügbar`
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
                const isAssigned = isPersonAssigned(person.name)
                const wasJustAssigned = justAssigned === person.id
                return (
                  <button
                    key={person.id}
                    onClick={() => handleTogglePerson(person)}
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
                        <p className="font-medium text-sm">{person.name}</p>
                        {person.role && (
                          <p className="text-xs text-muted-foreground">{person.role}</p>
                        )}
                      </div>
                    </div>
                    {isAssigned && (
                      <Badge variant="secondary" className="text-xs animate-scale-in">Zugewiesen</Badge>
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
                const isAssigned = isMaterialAssigned(material.id)
                const wasJustAssigned = justAssigned === material.id
                return (
                  <button
                    key={material.id}
                    onClick={() => handleToggleMaterial(material)}
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
                        <p className="font-medium text-sm">{material.name}</p>
                        <p className="text-xs text-muted-foreground">{material.category}</p>
                      </div>
                    </div>
                    {isAssigned && (
                      <Badge variant="secondary" className="text-xs animate-scale-in">Zugewiesen</Badge>
                    )}
                  </button>
                )
              })}

              {/* Empty state with personality */}
              {resourceType === 'crew' && filteredPersonnel.length === 0 && (
                <div className="text-center py-12 animate-fade-in-up">
                  <Users className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {searchQuery ? 'Keine Personen gefunden' : 'Keine verfügbaren Personen'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchQuery ? 'Versuchen Sie einen anderen Suchbegriff' : 'Alle Personen sind bereits im Einsatz'}
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
                    {searchQuery ? 'Versuchen Sie einen anderen Suchbegriff' : 'Alle Fahrzeuge sind bereits im Einsatz'}
                  </p>
                </div>
              )}
              {resourceType === 'materials' && filteredMaterials.length === 0 && (
                <div className="text-center py-12 animate-fade-in-up">
                  <Package className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {searchQuery ? 'Keine Materialien gefunden' : 'Keine verfügbaren Materialien'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchQuery ? 'Versuchen Sie einen anderen Suchbegriff' : 'Alle Materialien sind bereits im Einsatz'}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="flex justify-end pt-2">
            <Button onClick={() => onOpenChange(false)} className="hover-delight">
              Fertig
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
