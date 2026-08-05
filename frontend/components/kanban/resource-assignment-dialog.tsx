"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Users, Truck, Package, CheckCircle, Circle, Footprints, Layers, ChevronDown, ChevronRight, Car, Binoculars, Package2, Siren, MapPin, Undo2 } from "lucide-react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperations, type Person, type Material } from "@/lib/contexts/operations-context"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { getActiveLocale } from "@/lib/i18n-messages"
import { cn } from "@/lib/utils"

interface ResourceAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceType: 'crew' | 'vehicles' | 'materials' | null
  operationId: string | null
  /** Whether the dialog is assigning to a single incident or to an Auftrag (route).
   *  Drives the title/label wording; defaults to 'incident'. */
  assignTarget?: 'incident' | 'route'
  /** Auftrag name shown in the title when assignTarget === 'route'. */
  routeName?: string
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
  zuFuss?: boolean
  onToggleZuFuss?: () => void
  occupiedPersonnelIds?: Set<string>
  occupiedVehicleIds?: Set<string>
  occupiedMaterialIds?: Set<string>
  /** Vehicle name → «bleibt vor Ort». Shown per assigned vehicle so the choice
   *  can be made where the vehicle is assigned, not only on the incident card. */
  vehicleDriverStay?: Map<string, boolean>
  onToggleDriverStay?: (vehicleName: string) => void
}

/** Where an occupied resource currently is: `short` is length-capped for the
 *  card subtitle, `full` untruncated for the hover title and confirm copy. */
type OccupancyLabel = { short: string; full: string }

export function ResourceAssignmentDialog({
  open,
  onOpenChange,
  resourceType,
  operationId,
  assignTarget = 'incident',
  routeName,
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
  zuFuss = false,
  onToggleZuFuss,
  occupiedPersonnelIds = new Set(),
  occupiedVehicleIds = new Set(),
  occupiedMaterialIds = new Set(),
  vehicleDriverStay,
  onToggleDriverStay,
}: ResourceAssignmentDialogProps) {
  const t = useTranslations('kanban')
  const { materialGroups } = useMaterials()
  const { operations } = useOperations()
  const { groups, getGroupResources } = useGroups()
  const [searchQuery, setSearchQuery] = useState("")
  const [searchFocused, setSearchFocused] = useState(false)
  const [justAssigned, setJustAssigned] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // Quick category filter (null = all): rank for crew, depot/location for
  // material, type for vehicles. Sits as chips below the search.
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  // Vehicles-only quick filter: when on, show only vehicles already assigned to
  // this incident.
  const [showOnlyAssignedVehicles, setShowOnlyAssignedVehicles] = useState(false)
  // Materials-only quick filter: functional type (e.g. "Wasser") — narrows the
  // visible list like the depot chips, never pre-selects anything.
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  // Crew-only quick filter: when on, also show people already assigned to
  // another incident/Auftrag (amber-flagged, confirm-guarded).
  const [showOccupiedPersonnel, setShowOccupiedPersonnel] = useState(false)

  // Local selection state for crew and materials (deferred assignment)
  // These track which items are SELECTED (checked) in the dialog, separate from actual assigned state
  const [selectedPersonnel, setSelectedPersonnel] = useState<Set<string>>(new Set())
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set())
  // A special-function person pending a double-booking confirmation before they
  // get ticked into the crew selection.
  const [confirmPerson, setConfirmPerson] = useState<Person | null>(null)
  // A material bound to another incident/Auftrag pending a "trotzdem zuweisen?"
  // confirmation before it gets ticked into the selection.
  const [confirmMaterial, setConfirmMaterial] = useState<Material | null>(null)
  // A person bound to another incident/Auftrag pending the same confirmation
  // (takes precedence over the special-function confirm — one confirm is enough).
  const [confirmOccupiedPerson, setConfirmOccupiedPerson] = useState<Person | null>(null)

  // Snapshot the assigned state into the local selection ONLY on the open
  // transition. Re-snapshotting whenever assignedPersonnel/assignedMaterials
  // change (a background poll, WS push, or optimistic revert that lands while the
  // dialog is open) was wiping the user's in-progress ticks — boxes appeared to
  // untick themselves. Guarding on the false→true edge keeps selections stable.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSelectedPersonnel(new Set(assignedPersonnel))
      setSelectedMaterials(new Set(assignedMaterials))
    }
    wasOpenRef.current = open
  }, [open, assignedPersonnel, assignedMaterials])

  // Reset search + category filter on close, and clear the category filter
  // whenever the resource type changes (its categories no longer apply).
  useEffect(() => {
    if (!open) {
      setSearchQuery("")
      setSearchFocused(false)
      setCategoryFilter(null)
      setTypeFilter(null)
      setShowOnlyAssignedVehicles(false)
      setShowOccupiedPersonnel(false)
    }
  }, [open])
  useEffect(() => {
    setCategoryFilter(null)
    setTypeFilter(null)
    setShowOnlyAssignedVehicles(false)
    setShowOccupiedPersonnel(false)
  }, [resourceType])

  // Get resources that can be shown in the dialog
  // For crew: show available personnel OR personnel already assigned to THIS operation (for deselection)
  // Exclude Reko personnel UNLESS they're already assigned to this operation's crew (for removal)
  const selectablePersonnel = useMemo(() => {
    return personnel.filter(p => {
      const isAssignedToCrew = assignedPersonnel.includes(p.name)

      // Always show if already assigned to this operation's crew (allows deselection)
      if (isAssignedToCrew) return true
      // Quick filter ON: show everyone — people bound elsewhere appear
      // amber-flagged and need a confirm before selection.
      if (showOccupiedPersonnel) return true
      if (occupiedPersonnelIds.has(p.id)) return false

      // People with a special function (Reko / driver / magazin) used to be hidden
      // outright. Show them now — flagged with a badge — so they can be assigned
      // after an explicit "double-booking?" confirm instead of silently vanishing.
      const hasSpecialFunction = p.isReko || p.isDriver || p.isMagazin || rekoPersonnelNames.includes(p.name)
      if (hasSpecialFunction) return true

      // Show available personnel
      return p.status === 'available'
    })
  }, [personnel, rekoPersonnelNames, assignedPersonnel, occupiedPersonnelIds, showOccupiedPersonnel])

  // Describe a person's special function for the badge + confirm copy, or null.
  const specialFunctionOf = (p: Person): { label: string; Icon: typeof Car } | null => {
    if (p.isDriver) return { label: p.driverVehicleName || t('assignmentDialog.driverBadge'), Icon: Car }
    if (p.isReko || rekoPersonnelNames.includes(p.name)) return { label: t('common.reko'), Icon: Binoculars }
    if (p.isMagazin) return { label: t('common.magazin'), Icon: Package2 }
    return null
  }

  const availableVehicles = useMemo(() => {
    // Show all vehicles — assigned ones appear checked and can be toggled off
    // Keep occupied vehicles visible: selecting one invokes the standard
    // move/keep conflict prompt instead of silently hiding it.
    return vehicles
  }, [vehicles])

  // For materials: show EVERYTHING — items bound to another incident/Auftrag stay
  // visible (amber-flagged) and need an explicit confirm instead of vanishing.
  const selectableMaterials = materials

  // Where an occupied vehicle/material/person currently is, resolved from the
  // operations + Auftrag contexts (no prop threading): vehicle name → label,
  // material id → label, person name → label (crew arrays hold names). Labels
  // carry a truncated `short` for the card plus an untruncated `full` for the
  // hover title / confirm copy. The current assign target never counts as
  // "elsewhere" — note operationId holds the GROUP id when assignTarget === 'route'.
  const { vehicleOccupancy, materialOccupancy, personOccupancy } = useMemo(() => {
    const vehicleMap = new Map<string, OccupancyLabel>()
    const materialMap = new Map<string, OccupancyLabel>()
    const personMap = new Map<string, OccupancyLabel>()
    for (const op of operations) {
      if (assignTarget === 'incident' && op.id === operationId) continue
      const label = { short: getIncidentRefLabel(op, 40), full: getIncidentRefLabel(op, 1000) }
      for (const name of op.vehicles) if (!vehicleMap.has(name)) vehicleMap.set(name, label)
      for (const id of op.materials) if (!materialMap.has(id)) materialMap.set(id, label)
      for (const name of op.crew) if (!personMap.has(name)) personMap.set(name, label)
    }
    for (const group of groups) {
      if (assignTarget === 'route' && group.id === operationId) continue
      const res = getGroupResources(group.id)
      const label = { short: group.name, full: group.name }
      for (const v of res.vehicles) if (!vehicleMap.has(v.name)) vehicleMap.set(v.name, label)
      for (const m of res.materials) if (!materialMap.has(m.resourceId)) materialMap.set(m.resourceId, label)
      for (const p of res.personnel) if (!personMap.has(p.name)) personMap.set(p.name, label)
    }
    return { vehicleOccupancy: vehicleMap, materialOccupancy: materialMap, personOccupancy: personMap }
  }, [operations, groups, getGroupResources, assignTarget, operationId])

  // Materials bound to ANOTHER incident/Auftrag (never the current target —
  // anything in assignedMaterials is "here"). Status doubles as a fallback flag
  // for occupancy we can't resolve to a concrete incident/route.
  const occupiedElsewhereMaterialIds = useMemo(() => {
    const set = new Set<string>()
    for (const m of materials) {
      // Verbrauchsmaterial has no stock limit – being on another incident says
      // nothing about this one, so no amber flag and no double-booking confirm.
      if (m.consumable) continue
      if (assignedMaterials.includes(m.id)) continue
      if (materialOccupancy.has(m.id) || occupiedMaterialIds.has(m.id) || m.status === 'assigned') set.add(m.id)
    }
    return set
  }, [materials, assignedMaterials, materialOccupancy, occupiedMaterialIds])

  // Where a vehicle/material/person is bound elsewhere ("Im Einsatz" when the
  // exact spot can't be resolved), or null when it's free or already on this
  // target.
  const genericElsewhereLabel = (): OccupancyLabel => {
    const generic = t('assignmentDialog.occupiedElsewhere')
    return { short: generic, full: generic }
  }
  const vehicleElsewhereLabel = (vehicle: { id: string; name: string }): OccupancyLabel | null => {
    if (assignedVehicles.includes(vehicle.name)) return null
    if (vehicleOccupancy.has(vehicle.name)) return vehicleOccupancy.get(vehicle.name)!
    if (occupiedVehicleIds.has(vehicle.id)) return genericElsewhereLabel()
    return null
  }
  const materialElsewhereLabel = (material: Material): OccupancyLabel | null => {
    if (!occupiedElsewhereMaterialIds.has(material.id)) return null
    return materialOccupancy.get(material.id) ?? genericElsewhereLabel()
  }
  const personElsewhereLabel = (person: Person): OccupancyLabel | null => {
    if (assignedPersonnel.includes(person.name)) return null
    if (personOccupancy.has(person.name)) return personOccupancy.get(person.name)!
    if (occupiedPersonnelIds.has(person.id) || person.status === 'assigned') return genericElsewhereLabel()
    return null
  }

  // Quick-filter categories for the active resource type (rank / location / type).
  const categories = useMemo(() => {
    const source =
      resourceType === 'crew'
        ? selectablePersonnel.map(p => p.role).filter((r): r is string => Boolean(r))
        : resourceType === 'vehicles'
          ? availableVehicles.map(v => v.type)
          : resourceType === 'materials'
            ? selectableMaterials.map(m => m.category)
            : []
    return [...new Set(source)].sort((a, b) => a.localeCompare(b))
  }, [resourceType, selectablePersonnel, availableVehicles, selectableMaterials])

  // Second chip row for materials: functional type (e.g. "Wasser") as a quick
  // FILTER across depots — narrows the visible list like the depot chips,
  // selects nothing. Counts ALL listed materials of the type, occupied or not.
  const materialTypeGroups = useMemo(() => {
    if (resourceType !== 'materials') return [] as { type: string; count: number }[]
    const byType = new Map<string, number>()
    for (const m of selectableMaterials) {
      if (!m.type) continue
      byType.set(m.type, (byType.get(m.type) ?? 0) + 1)
    }
    return [...byType.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type))
  }, [resourceType, selectableMaterials])

  // Filter resources by search query + quick category filter
  const filteredPersonnel = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return selectablePersonnel.filter(p =>
      (!query || p.name.toLowerCase().includes(query)) &&
      (!categoryFilter || p.role === categoryFilter)
    )
  }, [selectablePersonnel, searchQuery, categoryFilter])

  // Sort the final crew list by role sort order, then assigned-first, then name.
  const sortedFilteredPersonnel = useMemo(() => {
    return [...filteredPersonnel].sort((a, b) => {
      if (a.role !== b.role) {
        if (a.roleSortOrder !== b.roleSortOrder) return (a.roleSortOrder ?? 0) - (b.roleSortOrder ?? 0)
        return (a.role ?? "").localeCompare(b.role ?? "", getActiveLocale())
      }
      if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
      return (a.name ?? "").localeCompare(b.name ?? "", getActiveLocale())
    })
  }, [filteredPersonnel])

  const filteredVehicles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return availableVehicles.filter(v =>
      (!query || v.name.toLowerCase().includes(query) || v.type.toLowerCase().includes(query)) &&
      (!categoryFilter || v.type === categoryFilter) &&
      (!showOnlyAssignedVehicles || assignedVehicles.includes(v.name))
    )
  }, [availableVehicles, searchQuery, categoryFilter, showOnlyAssignedVehicles, assignedVehicles])

  const filteredMaterials = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return selectableMaterials.filter(m => {
      if (categoryFilter && m.category !== categoryFilter) return false
      if (typeFilter && m.type !== typeFilter) return false
      if (!query) return true
      // Match material name or category
      if (m.name.toLowerCase().includes(query) || m.category.toLowerCase().includes(query)) return true
      // Match group name
      if (m.groupId) {
        const group = materialGroups.find(g => g.id === m.groupId)
        if (group?.name.toLowerCase().includes(query)) return true
      }
      return false
    })
  }, [selectableMaterials, searchQuery, materialGroups, categoryFilter, typeFilter])

  // Sort the material list by category sort order, then assigned-first, then
  // name — feeds the group split so order within each group respects the setting.
  const sortedFilteredMaterials = useMemo(() => {
    return [...filteredMaterials].sort((a, b) => {
      if (a.category !== b.category) {
        if (a.categorySortOrder !== b.categorySortOrder) return (a.categorySortOrder ?? 0) - (b.categorySortOrder ?? 0)
        return (a.category ?? "").localeCompare(b.category ?? "", getActiveLocale())
      }
      if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
      return (a.name ?? "").localeCompare(b.name ?? "", getActiveLocale())
    })
  }, [filteredMaterials])

  // Check if a resource is selected (for crew/materials) or assigned (for vehicles)
  const isPersonSelected = (personName: string) => selectedPersonnel.has(personName)
  const isVehicleAssigned = (vehicleName: string) => assignedVehicles.includes(vehicleName)
  const isMaterialSelected = (materialId: string) => selectedMaterials.has(materialId)

  // Toggle selection for crew (local state only, doesn't call API)
  const addPersonToSelection = (person: Person) => {
    setSelectedPersonnel(prev => {
      const next = new Set(prev)
      next.add(person.name)
      return next
    })
    setJustAssigned(person.id)
    setTimeout(() => setJustAssigned(null), 600)
  }

  const handleTogglePersonSelection = (person: Person) => {
    // Deselecting is always immediate.
    if (selectedPersonnel.has(person.name)) {
      setSelectedPersonnel(prev => {
        const next = new Set(prev)
        next.delete(person.name)
        return next
      })
      return
    }
    // Selecting someone bound to another incident/Auftrag → confirm first,
    // mirroring the material double-booking guard. Takes precedence over the
    // special-function confirm — one confirm is enough.
    if (personElsewhereLabel(person)) {
      setConfirmOccupiedPerson(person)
      return
    }
    // Selecting someone already busy in a special function → confirm first, so a
    // driver/reko/magazin isn't double-booked by a stray tap.
    if (specialFunctionOf(person)) {
      setConfirmPerson(person)
      return
    }
    addPersonToSelection(person)
  }

  // Vehicles still use instant assignment
  const handleToggleVehicle = (vehicle: { id: string; name: string }) => {
    if (!operationId) return

    const isAssigned = isVehicleAssigned(vehicle.name)
    if (isAssigned) {
      onRemoveVehicle(operationId, vehicle.name)
    } else {
      onAssignVehicle(vehicle.id, vehicle.name, operationId)
      setJustAssigned(vehicle.id)
      setTimeout(() => setJustAssigned(null), 600)
    }
  }

  // Add a material to the local selection (free path or after the confirm).
  const addMaterialToSelection = (materialId: string) => {
    setSelectedMaterials(prev => {
      const next = new Set(prev)
      next.add(materialId)
      return next
    })
    setJustAssigned(materialId)
    setTimeout(() => setJustAssigned(null), 600)
  }

  // Toggle selection for materials (local state only, doesn't call API)
  const handleToggleMaterialSelection = (material: Material) => {
    // Deselecting is always immediate.
    if (selectedMaterials.has(material.id)) {
      setSelectedMaterials(prev => {
        const next = new Set(prev)
        next.delete(material.id)
        return next
      })
      return
    }
    // Selecting a material bound to another incident/Auftrag → confirm first,
    // mirroring the crew double-booking guard.
    if (occupiedElsewhereMaterialIds.has(material.id)) {
      setConfirmMaterial(material)
      return
    }
    addMaterialToSelection(material.id)
  }

  // Toggle all materials in a group at once (group headers pass FREE ids only —
  // occupied-elsewhere items are excluded and stay individual-confirm-only)
  const handleToggleGroupSelection = (groupMaterialIds: string[]) => {
    if (groupMaterialIds.length === 0) return
    setSelectedMaterials(prev => {
      const next = new Set(prev)
      const allSelected = groupMaterialIds.every(id => next.has(id))
      if (allSelected) {
        for (const id of groupMaterialIds) next.delete(id)
      } else {
        for (const id of groupMaterialIds) {
          next.add(id)
        }
        setJustAssigned(`group-${groupMaterialIds[0]}`)
        setTimeout(() => setJustAssigned(null), 600)
      }
      return next
    })
  }

  // Build grouped + ungrouped structure for material display
  const groupedFilteredMaterials = useMemo(() => {
    const groups: { groupId: string; groupName: string; materials: Material[] }[] = []
    const ungrouped: Material[] = []

    // Collect materials by group
    const groupMap = new Map<string, Material[]>()
    for (const m of sortedFilteredMaterials) {
      const groupId = m.groupId
      const group = groupId ? materialGroups.find(g => g.id === groupId) : null
      if (group) {
        if (!groupMap.has(group.id)) groupMap.set(group.id, [])
        groupMap.get(group.id)!.push(m)
      } else {
        ungrouped.push(m)
      }
    }

    for (const [groupId, mats] of groupMap) {
      const group = materialGroups.find(g => g.id === groupId)!
      groups.push({ groupId, groupName: group.name, materials: mats })
    }

    return { groups, ungrouped }
  }, [sortedFilteredMaterials, materialGroups])

  // Quick number-key assignment (1..9): toggle the Nth visible item of the active
  // resource type — the same action as clicking it. The onAssign*/onRemove*
  // callbacks are wired by the parent, so in route-assign mode this assigns to the
  // Auftrag (via assignResource) exactly like clicking, not to a single incident.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (e.key.length !== 1 || e.key < "1" || e.key > "9") return
      const idx = Number(e.key) - 1
      if (resourceType === "vehicles") {
        const v = filteredVehicles[idx]
        if (v) {
          e.preventDefault()
          handleToggleVehicle(v)
        }
      } else if (resourceType === "crew") {
        const p = sortedFilteredPersonnel[idx]
        if (p) {
          e.preventDefault()
          handleTogglePersonSelection(p)
        }
      } else if (resourceType === "materials") {
        const flat = [
          ...groupedFilteredMaterials.groups.flatMap((g) => g.materials),
          ...groupedFilteredMaterials.ungrouped,
        ]
        const m = flat[idx]
        if (m) {
          e.preventDefault()
          handleToggleMaterialSelection(m)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // Handlers are stable enough within an open session; lists gate the indexing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resourceType, filteredVehicles, sortedFilteredPersonnel, groupedFilteredMaterials])

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

    }

    onOpenChange(false)
  }

  const getDialogTitle = () => {
    // Make the assignment target explicit: an Auftrag (route) names the route in
    // «…»; a plain incident reads "… zu Einsatz zuweisen".
    const route = assignTarget === 'route'
    const name = routeName ?? ''
    switch (resourceType) {
      case 'crew':
        return route
          ? name
            ? t('assignmentDialog.titleCrewRoute', { name })
            : t('assignmentDialog.titleCrewRouteGeneric')
          : t('assignmentDialog.titleCrewIncident')
      case 'vehicles':
        return route
          ? name
            ? t('assignmentDialog.titleVehiclesRoute', { name })
            : t('assignmentDialog.titleVehiclesRouteGeneric')
          : t('assignmentDialog.titleVehiclesIncident')
      case 'materials':
        return route
          ? name
            ? t('assignmentDialog.titleMaterialsRoute', { name })
            : t('assignmentDialog.titleMaterialsRouteGeneric')
          : t('assignmentDialog.titleMaterialsIncident')
      default:
        return t('assignmentDialog.titleDefault')
    }
  }

  const getDialogDescription = () => {
    switch (resourceType) {
      case 'crew':
        return t('assignmentDialog.selectedCount', { selected: selectedPersonnel.size, available: selectablePersonnel.length })
      case 'vehicles':
        return t('assignmentDialog.vehiclesAssigned', { count: assignedVehicles.length }) + (zuFuss ? t('assignmentDialog.zuFussSuffix') : '')
      case 'materials':
        return t('assignmentDialog.selectedCount', { selected: selectedMaterials.size, available: selectableMaterials.length })
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
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed (definite) height: gives flex-1 a real basis so the list scrolls
          internally instead of overflowing, and keeps the dialog the same size as
          you switch quick filters so the top doesn't jump. overflow-hidden clips. */}
      {/* sm:max-w-6xl is required — the DialogContent base sets sm:max-w-lg (512px),
          a responsive variant that an unprefixed max-w-* does NOT override. */}
      <DialogContent className="max-w-6xl sm:max-w-6xl w-[calc(100vw-2rem)] h-[80dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {getDialogTitle()}
          </DialogTitle>
          <DialogDescription>{getDialogDescription()}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col min-h-0 flex-1 gap-4">
          {/* Search */}
          <SearchInput
            placeholder={t('common.search')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className={cn(
              "transition-all",
              searchFocused && "ring-2 ring-primary/50 animate-search-focus"
            )}
          />

          {/* Quick category filter — rank (crew), depot (material), type (vehicles) */}
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCategoryFilter(null)}
                className={cn(
                  "cursor-pointer px-2.5 py-1 rounded-full text-xs border transition-colors",
                  categoryFilter === null
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {t('assignmentDialog.all')}
              </button>
              {categories.map((cat) => {
                // A material depot/location that matches an already-assigned
                // vehicle (e.g. "MoWa") — flag it so the operator sees at a glance
                // which stock is already on scene. Materials only; matched by name.
                const vehiclePresent = resourceType === 'materials' && assignedVehicles.includes(cat)
                const isActive = categoryFilter === cat
                return (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(isActive ? null : cat)}
                    title={vehiclePresent ? t('assignmentDialog.vehicleOnSceneHint', { name: cat }) : undefined}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground border-primary"
                        : vehiclePresent
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/20"
                          : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                    )}
                  >
                    {vehiclePresent && <Truck className="h-3 w-3 flex-shrink-0" />}
                    {cat}
                  </button>
                )
              })}
            </div>
          )}

          {/* Materials: second chip row — FILTER the list to one functional type
              (e.g. "Wasser") across all depots. Filters only, selects nothing. */}
          {resourceType === 'materials' && materialTypeGroups.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-0.5 text-xs text-muted-foreground">{t('assignmentDialog.quickSelectByType')}</span>
              {materialTypeGroups.map(({ type, count }) => {
                const isActive = typeFilter === type
                return (
                  <button
                    key={type}
                    onClick={() => setTypeFilter(isActive ? null : type)}
                    className={cn(
                      "cursor-pointer px-2.5 py-1 rounded-full text-xs border transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                    )}
                  >
                    {type} ({count})
                  </button>
                )
              })}
            </div>
          )}

          {/* Crew-only quick filter: also show people already assigned to
              another incident/Auftrag (default hides them). */}
          {resourceType === 'crew' && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setShowOccupiedPersonnel((v) => !v)}
                className={cn(
                  "cursor-pointer px-2.5 py-1 rounded-full text-xs border transition-colors",
                  showOccupiedPersonnel
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {t('assignmentDialog.showAllPersonnel')}
              </button>
            </div>
          )}

          {/* Vehicles-only quick filter: show only vehicles already assigned. */}
          {resourceType === 'vehicles' && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setShowOnlyAssignedVehicles((v) => !v)}
                className={cn(
                  "cursor-pointer px-2.5 py-1 rounded-full text-xs border transition-colors",
                  showOnlyAssignedVehicles
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {t('common.onlyAssignedVehicles')}
              </button>
            </div>
          )}

          {/* Resource List — flexes to fill the space between chips and footer,
              so the list scrolls internally and the dialog never exceeds 85dvh. */}
          <ScrollArea className="flex-1 min-h-0 pr-2">
            <div className="space-y-2">
              {resourceType === 'crew' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {sortedFilteredPersonnel.map((person) => {
                    const isSelected = isPersonSelected(person.name)
                    const wasJustAssigned = justAssigned === person.id
                    const special = specialFunctionOf(person)
                    // Already on another incident/Auftrag → amber flag with the
                    // reference, taking precedence over the special-function badge.
                    const elsewhere = personElsewhereLabel(person)
                    return (
                      <button
                        key={person.id}
                        onClick={() => handleTogglePersonSelection(person)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 p-2.5 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-secondary/30 transition-all text-left hover-delight",
                          isSelected && "border-primary/30 bg-primary/5",
                          (elsewhere || special) && !isSelected && "border-amber-500/40 bg-amber-500/5"
                        )}
                      >
                        {isSelected ? (
                          <CheckCircle className={cn(
                            "h-5 w-5 text-emerald-500 flex-shrink-0",
                            wasJustAssigned && "animate-checkmark-spring"
                          )} />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate" title={person.name}>{person.name}</p>
                          {elsewhere ? (
                            <span
                              title={elsewhere.full}
                              className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-2xs font-medium text-amber-600 dark:text-amber-400"
                            >
                              <Siren className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">{elsewhere.short}</span>
                            </span>
                          ) : special ? (
                            <span
                              title={special.label}
                              className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-2xs font-medium text-amber-600 dark:text-amber-400"
                            >
                              <special.Icon className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">{special.label}</span>
                            </span>
                          ) : person.role ? (
                            <p className="text-xs text-muted-foreground truncate">{person.role}</p>
                          ) : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {resourceType === 'vehicles' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {onToggleZuFuss && (
                    <button
                      onClick={onToggleZuFuss}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 p-2.5 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-secondary/30 transition-all text-left hover-delight",
                        zuFuss && "border-primary/30 bg-primary/5"
                      )}
                    >
                      {zuFuss ? (
                        <CheckCircle className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                      ) : (
                        <Footprints className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{t('common.zuFuss')}</p>
                        <p className="text-xs text-muted-foreground truncate">{t('assignmentDialog.noVehicle')}</p>
                      </div>
                    </button>
                  )}
                  {filteredVehicles.map((vehicle) => {
                    const isAssigned = isVehicleAssigned(vehicle.name)
                    const wasJustAssigned = justAssigned === vehicle.id
                    // Already on another incident/Auftrag → amber flag with the
                    // reference, matching the crew special-function treatment.
                    const elsewhere = vehicleElsewhereLabel(vehicle)
                    // «bleibt vor Ort» vs «kehrt zurück». Assigning here used to
                    // drop that decision on the floor: the flag exists from the
                    // moment the vehicle is assigned (defaulting to «zurück»),
                    // it is read out on the radio and printed on the slip, but
                    // it could only be set from the incident card — so a whole
                    // dispatch done through this dialog announced the wrong thing.
                    const stays = vehicleDriverStay?.get(vehicle.name) ?? false
                    const canSetStay = isAssigned && !!onToggleDriverStay
                    return (
                      <div
                        key={vehicle.id}
                        className={cn(
                          "flex items-center gap-2 p-2.5 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-secondary/30 transition-all hover-delight",
                          isAssigned && "border-primary/30 bg-primary/5",
                          elsewhere && !isAssigned && "border-amber-500/40 bg-amber-500/5"
                        )}
                      >
                        <button
                          onClick={() => handleToggleVehicle(vehicle)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                        >
                          {isAssigned ? (
                            <CheckCircle className={cn(
                              "h-5 w-5 text-emerald-500 flex-shrink-0",
                              wasJustAssigned && "animate-checkmark-spring"
                            )} />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate" title={vehicle.name}>{vehicle.name}</p>
                            {elsewhere ? (
                              <span
                                title={elsewhere.full}
                                className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-2xs font-medium text-amber-600 dark:text-amber-400"
                              >
                                <Siren className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{elsewhere.short}</span>
                              </span>
                            ) : (
                              <p className="text-xs text-muted-foreground truncate">{vehicle.type}</p>
                            )}
                          </div>
                        </button>
                        {canSetStay && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleDriverStay!(vehicle.name)
                            }}
                            className={cn(
                              "flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-1.5 py-1 text-2xs font-medium transition-colors",
                              stays
                                ? "bg-primary/15 text-foreground hover:bg-primary/25"
                                : "bg-muted text-muted-foreground hover:bg-muted/70",
                            )}
                            title={stays ? t('common.driverStayTooltip') : t('common.driverReturnTooltip')}
                            aria-pressed={stays}
                          >
                            {stays ? <MapPin className="h-3 w-3" /> : <Undo2 className="h-3 w-3" />}
                            {stays ? t('common.driverStays') : t('common.driverReturns')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {resourceType === 'materials' && (
                <>
                  {/* Material groups */}
                  {groupedFilteredMaterials.groups.map(({ groupId, groupName, materials: groupMats }) => {
                    // Only FREE items count towards select-all / "Alle" — a module
                    // reads complete without its occupied-elsewhere items, which
                    // must be picked individually (with confirm).
                    const freeGroupMatIds = groupMats.filter(m => !occupiedElsewhereMaterialIds.has(m.id)).map(m => m.id)
                    const allSelected = freeGroupMatIds.length > 0 && freeGroupMatIds.every(id => selectedMaterials.has(id))
                    const selectedCount = groupMats.filter(m => selectedMaterials.has(m.id)).length
                    const someSelected = selectedCount > 0
                    const isExpanded = expandedGroups.has(groupId)
                    const wasJustAssigned = justAssigned === `group-${freeGroupMatIds[0]}`
                    // Origin(s) of the module's items — distinct depots/locations.
                    const groupOrigins = [...new Set(groupMats.map(m => m.category).filter(Boolean))].join(", ")
                    return (
                      <div key={`group-${groupId}`} className="space-y-1">
                        {/* Group header row */}
                        <div className={cn(
                          "flex items-center rounded-lg border border-border/50 transition-all hover:border-primary/50 hover:bg-secondary/30",
                          allSelected && "border-primary/30 bg-primary/5"
                        )}>
                          {/* Expand/collapse toggle */}
                          <button
                            onClick={() => setExpandedGroups(prev => {
                              const next = new Set(prev)
                              if (next.has(groupId)) next.delete(groupId)
                              else next.add(groupId)
                              return next
                            })}
                            className="cursor-pointer px-2 py-3"
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            }
                          </button>
                          {/* Select all toggle */}
                          <button
                            onClick={() => handleToggleGroupSelection(freeGroupMatIds)}
                            className="flex-1 flex cursor-pointer items-center justify-between py-3 pr-3 text-left"
                          >
                            <div className="flex items-center gap-3">
                              {allSelected ? (
                                <CheckCircle className={cn(
                                  "h-5 w-5 text-emerald-500 flex-shrink-0",
                                  wasJustAssigned && "animate-checkmark-spring"
                                )} />
                              ) : someSelected ? (
                                <CheckCircle className="h-5 w-5 text-emerald-500/50 flex-shrink-0" />
                              ) : (
                                <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                              )}
                              <div>
                                <p className="font-medium text-sm flex items-center gap-1.5">
                                  <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                                  {groupName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {groupOrigins && <span>{groupOrigins} · </span>}
                                  {t('assignmentDialog.groupSelected', { selected: selectedCount, total: groupMats.length })}
                                </p>
                              </div>
                            </div>
                            {allSelected && (
                              <Badge variant="secondary" className="text-xs animate-scale-in">{t('assignmentDialog.all')}</Badge>
                            )}
                            {someSelected && !allSelected && (
                              <Badge variant="secondary" className="text-xs animate-scale-in">{t('assignmentDialog.partial')}</Badge>
                            )}
                          </button>
                        </div>
                        {/* Expanded individual materials — same 3-col card grid as
                            ungrouped items, slightly inset so they read as the
                            module's contents. */}
                        {isExpanded && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-4 border-l-2 border-border/40 ml-3">
                            {groupMats.map((material) => {
                              const isSelected = isMaterialSelected(material.id)
                              const matJustAssigned = justAssigned === material.id
                              const elsewhere = materialElsewhereLabel(material)
                              return (
                                <button
                                  key={material.id}
                                  onClick={() => handleToggleMaterialSelection(material)}
                                  className={cn(
                                    "flex cursor-pointer items-center gap-2.5 p-2.5 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-secondary/30 transition-all text-left hover-delight",
                                    isSelected && "border-primary/30 bg-primary/5",
                                    elsewhere && !isSelected && "border-amber-500/40 bg-amber-500/5"
                                  )}
                                >
                                  {isSelected ? (
                                    <CheckCircle className={cn(
                                      "h-5 w-5 text-emerald-500 flex-shrink-0",
                                      matJustAssigned && "animate-checkmark-spring"
                                    )} />
                                  ) : (
                                    <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                  )}
                                  <div className="min-w-0">
                                    <p className="font-medium text-sm truncate" title={material.name}>{material.name}</p>
                                    {elsewhere ? (
                                      <span
                                        title={elsewhere.full}
                                        className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-2xs font-medium text-amber-600 dark:text-amber-400"
                                      >
                                        <Siren className="h-3 w-3 flex-shrink-0" />
                                        <span className="truncate">{elsewhere.short}</span>
                                      </span>
                                    ) : (
                                      <p className="text-xs text-muted-foreground truncate">{material.category}</p>
                                    )}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {/* Ungrouped materials */}
                  {groupedFilteredMaterials.ungrouped.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {groupedFilteredMaterials.ungrouped.map((material) => {
                        const isSelected = isMaterialSelected(material.id)
                        const wasJustAssigned = justAssigned === material.id
                        const elsewhere = materialElsewhereLabel(material)
                        return (
                          <button
                            key={material.id}
                            onClick={() => handleToggleMaterialSelection(material)}
                            className={cn(
                              "flex cursor-pointer items-center gap-2.5 p-2.5 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-secondary/30 transition-all text-left hover-delight",
                              isSelected && "border-primary/30 bg-primary/5",
                              elsewhere && !isSelected && "border-amber-500/40 bg-amber-500/5"
                            )}
                          >
                            {isSelected ? (
                              <CheckCircle className={cn(
                                "h-5 w-5 text-emerald-500 flex-shrink-0",
                                wasJustAssigned && "animate-checkmark-spring"
                              )} />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate" title={material.name}>{material.name}</p>
                              {elsewhere ? (
                                <span
                                  title={elsewhere.full}
                                  className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-2xs font-medium text-amber-600 dark:text-amber-400"
                                >
                                  <Siren className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">{elsewhere.short}</span>
                                </span>
                              ) : (
                                <p className="text-xs text-muted-foreground truncate">{material.category}</p>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Empty state with personality */}
              {resourceType === 'crew' && filteredPersonnel.length === 0 && (
                <div className="text-center py-12 animate-fade-in-up">
                  <Users className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {searchQuery ? t('assignmentDialog.noPersonsFound') : t('assignmentDialog.noSelectablePersons')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchQuery ? t('assignmentDialog.tryOtherSearch') : t('assignmentDialog.allPersonsAssigned')}
                  </p>
                </div>
              )}
              {resourceType === 'vehicles' && filteredVehicles.length === 0 && (
                <div className="text-center py-12 animate-fade-in-up">
                  <Truck className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {searchQuery ? t('assignmentDialog.noVehiclesFound') : t('assignmentDialog.noAvailableVehicles')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchQuery ? t('assignmentDialog.tryOtherSearch') : t('assignmentDialog.allVehiclesAssigned')}
                  </p>
                </div>
              )}
              {resourceType === 'materials' && filteredMaterials.length === 0 && (
                <div className="text-center py-12 animate-fade-in-up">
                  <Package className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {searchQuery ? t('assignmentDialog.noMaterialsFound') : t('assignmentDialog.noSelectableMaterials')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {searchQuery ? t('assignmentDialog.tryOtherSearch') : t('assignmentDialog.allMaterialsAssigned')}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            {(resourceType === 'crew' || resourceType === 'materials') && (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
            )}
            <Button
              onClick={resourceType === 'vehicles' ? () => onOpenChange(false) : handleConfirm}
              className="hover-delight"
            >
              {t('common.done')}
              {hasPendingChanges && (resourceType === 'crew' || resourceType === 'materials') && (
                <span className="ml-1.5 px-1.5 py-0.5 text-2xs bg-primary-foreground/20 rounded">
                  {t('assignmentDialog.changes')}
                </span>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    {/* Double-booking guard: assigning a driver/reko/magazin to crew asks first. */}
    <ConfirmDialog
      open={!!confirmPerson}
      onOpenChange={(o) => !o && setConfirmPerson(null)}
      title={t('assignmentDialog.specialFnConfirmTitle')}
      description={
        confirmPerson
          ? t('assignmentDialog.specialFnConfirmBody', {
              name: confirmPerson.name,
              func: specialFunctionOf(confirmPerson)?.label ?? '',
            })
          : ''
      }
      cancelText={t('common.cancel')}
      confirmText={t('assignmentDialog.specialFnConfirmAction')}
      onConfirm={() => {
        if (confirmPerson) addPersonToSelection(confirmPerson)
      }}
    />

    {/* Double-booking guard: selecting a material that is already on another
        incident/Auftrag asks first. Deselecting stays immediate. */}
    <ConfirmDialog
      open={!!confirmMaterial}
      onOpenChange={(o) => !o && setConfirmMaterial(null)}
      title={t('assignmentDialog.occupiedConfirmTitle')}
      description={
        confirmMaterial
          ? t('assignmentDialog.occupiedConfirmBody', {
              name: confirmMaterial.name,
              label: materialElsewhereLabel(confirmMaterial)?.full ?? t('assignmentDialog.occupiedElsewhere'),
            })
          : ''
      }
      cancelText={t('common.cancel')}
      confirmText={t('assignmentDialog.occupiedConfirmAction')}
      onConfirm={() => {
        if (confirmMaterial) addMaterialToSelection(confirmMaterial.id)
      }}
    />

    {/* Double-booking guard: selecting a person already on another
        incident/Auftrag asks first. Deselecting stays immediate. */}
    <ConfirmDialog
      open={!!confirmOccupiedPerson}
      onOpenChange={(o) => !o && setConfirmOccupiedPerson(null)}
      title={t('assignmentDialog.occupiedConfirmTitle')}
      description={
        confirmOccupiedPerson
          ? t('assignmentDialog.occupiedConfirmBody', {
              name: confirmOccupiedPerson.name,
              label: personElsewhereLabel(confirmOccupiedPerson)?.full ?? t('assignmentDialog.occupiedElsewhere'),
            })
          : ''
      }
      cancelText={t('common.cancel')}
      confirmText={t('assignmentDialog.occupiedConfirmAction')}
      onConfirm={() => {
        if (confirmOccupiedPerson) addPersonToSelection(confirmOccupiedPerson)
      }}
    />
    </>
  )
}
