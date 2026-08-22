"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Users, Truck, Package, CheckCircle, Circle, Footprints, Layers, ChevronDown, ChevronRight, Car, Binoculars, Package2, Phone, MonitorCog, Siren, MapPin, Undo2, Ban } from "lucide-react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperations, type Person, type Material } from "@/lib/contexts/operations-context"
import { materialResourceState, personMatchesQuery } from "@/lib/resource-status"
import { useMaterials } from "@/lib/contexts/materials-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { getActiveLocale } from "@/lib/i18n-messages"
import { compareByName, compareByRankThenName } from "@/lib/roster-order"
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
  /** «Nicht einsatzbereit» (readiness, which beats deployment) is resolved
   *  INSIDE the dialog from the operations context — every caller gets it
   *  without threading a flag through, and the context refreshes with every
   *  poll. `outOfService` remains as an optional caller-side override and is
   *  OR-ed with the context. A flagged vehicle stays visible and is not
   *  selectable; hiding it would leave the operator wondering where it went. */
  vehicles: Array<{ id: string; name: string; type: string; outOfService?: boolean }>
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

/**
 * One place a resource is currently held, with enough to RELEASE it again.
 *
 * The dialog used to keep only a display label per resource, which is why its
 * own «Doppelbelegung?» could not offer «Verschieben» — it had no idea which
 * incident to take the person off. `id` is an incident id for `kind: 'incident'`
 * and an Auftrag id for `kind: 'route'`; a route release additionally needs the
 * group-assignment id.
 */
type Binding = OccupancyLabel & {
  kind: 'incident' | 'route'
  id: string
  assignmentId?: string
}

/**
 * The rule above one of the two blocks the lists are split into.
 *
 * Deliberately a rule and not a `<Separator/>` with a label beside it: the
 * heading has to be readable as "everything below this is spoken for" while the
 * eye is moving, which is why the busy one is amber and the free one is not.
 */
function ListSection({ label, tone, children }: { label: string; tone: 'free' | 'busy'; children: React.ReactNode }) {
  return (
    <section>
      <h3
        className={cn(
          "mb-2 flex items-center gap-2.5 text-2xs font-semibold uppercase tracking-wide",
          tone === 'busy' ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
      >
        {label}
        <span
          className={cn(
            "h-px flex-1",
            tone === 'busy' ? "bg-amber-500/30" : "bg-border/60",
          )}
        />
      </h3>
      {children}
    </section>
  )
}

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
  const { operations, requestResourceConflict, removeCrew, removeMaterial, outOfServiceVehicleIds } = useOperations()
  const { groups, getGroupResources, unassignResource } = useGroups()
  const { selectedEvent } = useEvent()
  // Who drives what, live. Assigning a vehicle without knowing whether anybody
  // is driving it is how a Fahrzeug reaches a Schadenplatz on the board and
  // nowhere else — the driver is the half of "TLF 1 is available" that the
  // fleet list does not carry. Loaded only while the dialog is open.
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id ?? null, open)
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
    }
  }, [open])
  useEffect(() => {
    setCategoryFilter(null)
    setTypeFilter(null)
    setShowOnlyAssignedVehicles(false)
  }, [resourceType])

  // Everyone checked in is selectable. People bound to another incident/Auftrag
  // or holding a special function sink into the «Bereits im Einsatz» block below
  // (amber-flagged, confirm-guarded) instead of being hidden — the old
  // «Alle anzeigen» toggle predated that split and is gone with it.
  const selectablePersonnel = personnel

  /**
   * Every role this person holds in the Ereignis — not just the first one.
   *
   * It used to return one, and the row then hid even that behind «Im Einsatz»
   * when the person was busy elsewhere. Both cost the operator the answer they
   * opened the dialog for: a Magaziner who also drives the TLF 1 read as
   * «Reko», and somebody on a Schadenplatz read as «Im Einsatz» with no hint
   * that taking them also takes the fleet's only driver. The driver's label
   * names the VEHICLE, because «Fahrer» alone raises the question it answers.
   */
  const specialFunctionsOf = (p: Person): { label: string; Icon: typeof Car }[] => {
    const functions: { label: string; Icon: typeof Car }[] = []
    if (p.isDriver) functions.push({ label: p.driverVehicleName || t('assignmentDialog.driverBadge'), Icon: Car })
    if (p.isReko || rekoPersonnelNames.includes(p.name)) functions.push({ label: t('common.reko'), Icon: Binoculars })
    if (p.isMagazin) functions.push({ label: t('common.magazin'), Icon: Package2 })
    if (p.isTelefondienst) functions.push({ label: t('common.telefondienst'), Icon: Phone })
    if (p.isKommandoposten) functions.push({ label: t('common.kommandoposten'), Icon: MonitorCog })
    return functions
  }

  const availableVehicles = useMemo(() => {
    // Show all vehicles — assigned ones appear checked and can be toggled off.
    // Keep occupied vehicles visible: selecting one invokes the standard
    // move/keep conflict prompt instead of silently hiding it.
    // «Nicht einsatzbereit» joins here from the operations context rather than
    // from the caller: the map and the Auftrag path used to pass bare fleet
    // lists, so a defective vehicle read as free on exactly those surfaces.
    return vehicles.map((v) => ({
      ...v,
      outOfService: (v.outOfService ?? false) || outOfServiceVehicleIds.has(v.id),
    }))
  }, [vehicles, outOfServiceVehicleIds])

  // For materials: show EVERYTHING — items bound to another incident/Auftrag stay
  // visible (amber-flagged) and need an explicit confirm instead of vanishing.
  const selectableMaterials = materials

  // EVERY place an occupied vehicle/material/person is currently held, resolved
  // from the operations + Auftrag contexts (no prop threading): vehicle name →
  // bindings, material id → bindings, person name → bindings (crew arrays hold
  // names). Each binding carries a truncated `short` for the card, an
  // untruncated `full` for the hover title, and what is needed to release it.
  // The current assign target never counts as "elsewhere" — note operationId
  // holds the GROUP id when assignTarget === 'route'.
  //
  // A LIST, not a single entry: a resource can stand on two Schadenplätze and a
  // route at once, and «Hierher verschieben» has to release all of them.
  const { vehicleOccupancy, materialOccupancy, personOccupancy } = useMemo(() => {
    const vehicleMap = new Map<string, Binding[]>()
    const materialMap = new Map<string, Binding[]>()
    const personMap = new Map<string, Binding[]>()
    const push = (map: Map<string, Binding[]>, key: string, binding: Binding) => {
      const existing = map.get(key)
      if (existing) existing.push(binding)
      else map.set(key, [binding])
    }
    for (const op of operations) {
      if (assignTarget === 'incident' && op.id === operationId) continue
      const label = { short: getIncidentRefLabel(op, 40), full: getIncidentRefLabel(op, 1000) }
      for (const name of op.vehicles) push(vehicleMap, name, { ...label, kind: 'incident', id: op.id })
      for (const id of op.materials) push(materialMap, id, { ...label, kind: 'incident', id: op.id })
      for (const name of op.crew) push(personMap, name, { ...label, kind: 'incident', id: op.id })
    }
    for (const group of groups) {
      if (assignTarget === 'route' && group.id === operationId) continue
      const res = getGroupResources(group.id)
      const label = { short: group.name, full: group.name }
      for (const v of res.vehicles) push(vehicleMap, v.name, { ...label, kind: 'route', id: group.id, assignmentId: v.assignmentId })
      for (const m of res.materials) push(materialMap, m.resourceId, { ...label, kind: 'route', id: group.id, assignmentId: m.assignmentId })
      for (const p of res.personnel) push(personMap, p.name, { ...label, kind: 'route', id: group.id, assignmentId: p.assignmentId })
    }
    return { vehicleOccupancy: vehicleMap, materialOccupancy: materialMap, personOccupancy: personMap }
  }, [operations, groups, getGroupResources, assignTarget, operationId])

  /** The «Neu:» half of the conflict prompt — where the resource is heading. */
  const targetLabel = useMemo(() => {
    if (assignTarget === 'route') return routeName
    const op = operations.find((o) => o.id === operationId)
    return op ? getIncidentRefLabel(op, 1000) : undefined
  }, [assignTarget, routeName, operations, operationId])

  /**
   * Hand the double-booking question to the ONE dialog that asks it.
   *
   * This dialog used to ask it a second time itself, with two of the three
   * answers: «Trotzdem zuweisen» or nothing, no «Verschieben». Same question,
   * same three answers, whichever way the assignment started.
   */
  const askConflict = (
    resourceType: 'personnel' | 'material',
    resourceId: string,
    resourceName: string,
    bindings: Binding[],
    proceed: () => void,
  ) => {
    requestResourceConflict({
      resourceType,
      resourceId,
      resourceName,
      targetOperationId: operationId ?? '',
      targetOperationLabel: targetLabel,
      conflicts: bindings.map((b) => ({ operationId: b.id, operationLabel: b.full })),
      customResolve: async (action) => {
        if (action === 'move') {
          // Sequentially: two releases of the same person racing each other
          // reconcile against each other's stale snapshot.
          for (const binding of bindings) {
            if (binding.kind === 'incident') {
              if (resourceType === 'material') await removeMaterial(binding.id, resourceId)
              else await removeCrew(binding.id, resourceName)
            } else if (binding.assignmentId) {
              await unassignResource(binding.id, binding.assignmentId)
            }
          }
        }
        proceed()
      },
    })
  }

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
    if (vehicleOccupancy.has(vehicle.name)) return vehicleOccupancy.get(vehicle.name)![0]
    if (occupiedVehicleIds.has(vehicle.id)) return genericElsewhereLabel()
    return null
  }
  const materialElsewhereLabel = (material: Material): OccupancyLabel | null => {
    if (!occupiedElsewhereMaterialIds.has(material.id)) return null
    return materialOccupancy.get(material.id)?.[0] ?? genericElsewhereLabel()
  }
  const personElsewhereLabel = (person: Person): OccupancyLabel | null => {
    if (assignedPersonnel.includes(person.name)) return null
    if (personOccupancy.has(person.name)) return personOccupancy.get(person.name)![0]
    // Deliberately NOT falling back on `status === 'assigned'`: the context sets
    // that flag for special-function people too (Fahrer, Telefondienst, …), and
    // the generic «Im Einsatz» next to their function badge claimed an incident
    // that does not exist. If somebody IS on an incident or Auftrag, the two
    // lookups above name it (short address / route name).
    if (occupiedPersonnelIds.has(person.id)) return genericElsewhereLabel()
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
    // Ranks keep the station's OWN order (the same `role_sort_order` the list
    // below them uses); everything else is alphabetical. Sorting the rank chips
    // alphabetically made the chip row read «AdF · Gruppenführer · Offizier»
    // over a list that runs the other way round — two orders for one thing, on
    // one screen.
    if (resourceType === 'crew') {
      const seen = new Set<string>()
      const ranks: string[] = []
      for (const person of [...selectablePersonnel].sort(compareByRankThenName)) {
        const rank = person.role
        if (!rank || seen.has(rank)) continue
        seen.add(rank)
        ranks.push(rank)
      }
      return ranks
    }
    return [...new Set(source)].sort((a, b) => a.localeCompare(b, 'de-CH'))
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
      .sort((a, b) => a.type.localeCompare(b.type, 'de-CH'))
  }, [resourceType, selectableMaterials])

  // Filter resources by search query + quick category filter. The shared
  // matcher also finds people by their special function ("telefondienst",
  // "kommandoposten", a driver's vehicle name) — see lib/resource-status.ts.
  const filteredPersonnel = useMemo(() => {
    return selectablePersonnel.filter(p =>
      personMatchesQuery(p, searchQuery) &&
      (!categoryFilter || p.role === categoryFilter)
    )
  }, [selectablePersonnel, searchQuery, categoryFilter])

  /**
   * Rank first, assigned-first inside a rank, then the name.
   *
   * The rank legs used to collate with `getActiveLocale()` — the UI language —
   * so a French-speaking operator got a different sequence than the board next
   * to them. Names and rank labels are roster data (`lib/roster-order.ts`), not
   * interface copy. The assigned-first leg stays in the middle: it is about
   * this dialog, not about the roster.
   */
  const sortedFilteredPersonnel = useMemo(() => {
    return [...filteredPersonnel].sort((a, b) => {
      if (a.role !== b.role) return compareByRankThenName(a, b)
      if (a.status !== b.status) return a.status === "assigned" ? -1 : 1
      return compareByName(a, b)
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
    // Selecting someone bound to another incident/Auftrag → the shared
    // Doppelbelegung dialog (verschieben / auf beiden führen / abbrechen).
    // Takes precedence over the special-function confirm — one question is enough.
    const bindings = personOccupancy.get(person.name)
    if (bindings?.length) {
      askConflict('personnel', person.id, person.name, bindings, () => addPersonToSelection(person))
      return
    }
    // Bound elsewhere but not resolvable to a concrete incident/route: nothing
    // to move it off, so it stays a plain confirm.
    if (personElsewhereLabel(person)) {
      setConfirmOccupiedPerson(person)
      return
    }
    // Selecting someone already busy in a special function → confirm first, so a
    // driver/reko/magazin isn't double-booked by a stray tap.
    if (specialFunctionsOf(person).length > 0) {
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
    // Selecting a material bound to another incident/Auftrag → the same shared
    // Doppelbelegung dialog the crew list and drag & drop use.
    if (occupiedElsewhereMaterialIds.has(material.id)) {
      const bindings = materialOccupancy.get(material.id)
      if (bindings?.length) {
        askConflict('material', material.id, material.name, bindings, () => addMaterialToSelection(material.id))
        return
      }
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

  /**
   * Free first, spoken-for underneath — the dialog's answer to "wen kann ich
   * nehmen".
   *
   * An occupied row was already amber-flagged, and that was the whole of it: the
   * flagged rows sat scattered through the grid, so finding three free people in
   * a roster of forty meant reading all forty. Sinking them under a heading
   * turns that into one eye movement, and the amber line stays for the rows that
   * still say *where* somebody is.
   *
   * Nothing is hidden and nothing is disabled — the bottom block is still
   * clickable and still opens the Doppelbelegung confirm. This orders the list;
   * it does not take a decision away from the operator.
   *
   * "Busy" is exactly what the row already draws in amber: bound to another
   * Schadenplatz or Auftrag, or holding an Ereignis role (a Reko trupp, the
   * TLF 1's driver). A resource on THIS target is never busy — it is selected.
   *
   * Module groups stay whole and stay on top: a module is a unit, and splitting
   * its contents across two headings would be a worse lie than the scatter this
   * fixes. Occupied items inside an expanded module keep the amber flag.
   */
  const crewSections = (() => {
    const free: Person[] = []
    const busy: Person[] = []
    for (const person of sortedFilteredPersonnel) {
      const isBusy = !!personElsewhereLabel(person) || specialFunctionsOf(person).length > 0
      ;(isBusy ? busy : free).push(person)
    }
    return { free, busy, ordered: [...free, ...busy] }
  })()

  const vehicleSections = (() => {
    const free: typeof filteredVehicles = []
    const busy: typeof filteredVehicles = []
    for (const vehicle of filteredVehicles) {
      // «Nicht einsatzbereit» is not free. It sinks with the spoken-for block so
      // «4 frei» over the grid keeps meaning what it says.
      const spokenFor = !!vehicleElsewhereLabel(vehicle) || (!!vehicle.outOfService && !isVehicleAssigned(vehicle.name))
      ;(spokenFor ? busy : free).push(vehicle)
    }
    return { free, busy, ordered: [...free, ...busy] }
  })()

  const ungroupedMaterialSections = (() => {
    const free: Material[] = []
    const busy: Material[] = []
    for (const material of groupedFilteredMaterials.ungrouped) {
      const spokenFor =
        occupiedElsewhereMaterialIds.has(material.id) ||
        (materialResourceState(material) === 'unavailable' && !isMaterialSelected(material.id))
      ;(spokenFor ? busy : free).push(material)
    }
    return { free, busy }
  })()

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
      // Indexed in the order the grid DRAWS them (free block, then the
      // spoken-for block) — «3» has to be the third tile on screen.
      if (resourceType === "vehicles") {
        const v = vehicleSections.ordered[idx]
        if (v) {
          e.preventDefault()
          handleToggleVehicle(v)
        }
      } else if (resourceType === "crew") {
        const p = crewSections.ordered[idx]
        if (p) {
          e.preventDefault()
          handleTogglePersonSelection(p)
        }
      } else if (resourceType === "materials") {
        const flat = [
          ...groupedFilteredMaterials.groups.flatMap((g) => g.materials),
          ...ungroupedMaterialSections.free,
          ...ungroupedMaterialSections.busy,
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

  /** One crew tile. Lifted out of the grid so the free and the spoken-for
   *  block can draw the same thing without a second copy of it. */
  const renderPersonTile = (person: Person) => {
    const isSelected = isPersonSelected(person.name)
    const wasJustAssigned = justAssigned === person.id
    const special = specialFunctionsOf(person)
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
          (elsewhere || special.length > 0) && !isSelected && "border-amber-500/40 bg-amber-500/5"
        )}
      >
        {isSelected ? (
          <CheckCircle className={cn(
            "h-5 w-5 text-emerald-500 flex-shrink-0",
            wasJustAssigned && "animate-check-appear"
          )} />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className="font-medium text-sm truncate" title={person.name}>{person.name}</p>
          {/* «Im Einsatz» and the Ereignis roles are different
              facts and both are shown: where somebody is now,
              and what taking them costs the Ereignis. The roles
              used to be hidden the moment the person was busy —
              exactly when the operator most needs to see that
              this is the TLF 1's driver. */}
          {elsewhere && (
            <span
              title={elsewhere.full}
              className="mt-0.5 flex max-w-full items-center gap-1 truncate text-2xs font-medium text-amber-600 dark:text-amber-400"
            >
              <Siren className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{elsewhere.short}</span>
            </span>
          )}
          {special.map((fn) => (
            <span
              key={fn.label}
              title={fn.label}
              className="mt-0.5 flex max-w-full items-center gap-1 truncate text-2xs font-medium text-amber-600 dark:text-amber-400"
            >
              <fn.Icon className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{fn.label}</span>
            </span>
          ))}
          {!elsewhere && special.length === 0 && person.role && (
            <p className="text-xs text-muted-foreground truncate">{person.role}</p>
          )}
        </div>
      </button>
    )
  }

  /** One vehicle row — shared by the free and the spoken-for block. */
  const renderVehicleTile = (vehicle: { id: string; name: string; type: string; outOfService?: boolean }) => {
    const isAssigned = isVehicleAssigned(vehicle.name)
    const wasJustAssigned = justAssigned === vehicle.id
    // «Nicht einsatzbereit» beats everything: the row says so in a word and a
    // glyph and refuses the click. No error message — the target is simply not
    // grabbable, which is the same treatment the sidebar gives it.
    const isOutOfService = !!vehicle.outOfService && !isAssigned
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
    const driver = vehicleDrivers.get(vehicle.name)
    const canSetStay = isAssigned && !!onToggleDriverStay
    return (
      <div
        key={vehicle.id}
        className={cn(
          "flex items-center gap-2 p-2.5 rounded-lg border border-border/50 transition-all",
          !isOutOfService && "hover:border-primary/50 hover:bg-secondary/30 hover-delight",
          isAssigned && "border-primary/30 bg-primary/5",
          elsewhere && !isAssigned && "border-amber-500/40 bg-amber-500/5",
          isOutOfService && "border-dashed opacity-60"
        )}
      >
        <button
          onClick={() => handleToggleVehicle(vehicle)}
          disabled={isOutOfService}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 text-left",
            isOutOfService ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          {isOutOfService ? (
            <Ban className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
          ) : isAssigned ? (
            <CheckCircle className={cn(
              "h-5 w-5 text-emerald-500 flex-shrink-0",
              wasJustAssigned && "animate-check-appear"
            )} />
          ) : (
            <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className={cn("font-medium text-sm truncate", isOutOfService && "text-muted-foreground")} title={vehicle.name}>{vehicle.name}</p>
            {isOutOfService ? (
              <p className="truncate text-2xs font-medium text-muted-foreground">
                {t('assignmentDialog.outOfService')}
              </p>
            ) : elsewhere ? (
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
            {/* Whether anybody is driving it — the half of "TLF 1
                is free" the fleet list does not carry. Said in
                both directions on purpose: a silent row would
                leave "no driver" and "not loaded yet" looking
                the same on the one screen where it decides
                whether the vehicle can actually roll. */}
            <p
              className={cn(
                "truncate text-2xs",
                driver ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
              )}
              title={driver ? t('assignmentDialog.vehicleDriver', { name: driver }) : undefined}
            >
              {driver
                ? t('assignmentDialog.vehicleDriver', { name: driver })
                : t('assignmentDialog.vehicleNoDriver')}
            </p>
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
                ? "bg-amber-500/20 text-amber-700 hover:bg-amber-500/30 dark:text-amber-300"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
            title={stays ? t('common.driverStayTooltip') : t('common.driverReturnTooltip')}
            aria-pressed={stays}
          >
            {stays ? <MapPin className="h-3 w-3" /> : <Undo2 className="h-3 w-3" />}
            {/* Full sentence here: this dialog is where the
                decision is MADE, and «bleibt» alone left the
                operator working out what the alternative was. */}
            {stays ? t('common.driverStaysFull') : t('common.driverReturnsFull')}
          </button>
        )}
      </div>
    )
  }

  /** One material tile — shared by the free block, the spoken-for block and
   *  the expanded module groups. */
  const renderMaterialTile = (material: Material) => {
    const isSelected = isMaterialSelected(material.id)
    const wasJustAssigned = justAssigned === material.id
    const elsewhere = materialElsewhereLabel(material)
    // Readiness beats deployment — see materialResourceState. A device recorded
    // as defective is shown, named as such, and cannot be ticked.
    const isOutOfService = materialResourceState(material) === 'unavailable' && !isSelected
    // This material's depot IS a vehicle already assigned to the target (e.g.
    // Mowa): its stock is on scene. Emphasis only — nothing gets preselected.
    const vehicleOnScene = !elsewhere && assignedVehicles.includes(material.category)
    return (
      <button
        key={material.id}
        onClick={() => handleToggleMaterialSelection(material)}
        disabled={isOutOfService}
        className={cn(
          "flex items-center gap-2.5 p-2.5 rounded-lg border border-border/50 transition-all text-left",
          isOutOfService ? "cursor-not-allowed border-dashed opacity-60" : "cursor-pointer hover:border-primary/50 hover:bg-secondary/30 hover-delight",
          isSelected && "border-primary/30 bg-primary/5",
          elsewhere && !isSelected && "border-amber-500/40 bg-amber-500/5",
          vehicleOnScene && !isSelected && "border-emerald-500/30"
        )}
      >
        {isOutOfService ? (
          <Ban className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
        ) : isSelected ? (
          <CheckCircle className={cn(
            "h-5 w-5 text-emerald-500 flex-shrink-0",
            wasJustAssigned && "animate-check-appear"
          )} />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className={cn("font-medium text-sm truncate", isOutOfService && "text-muted-foreground")} title={material.name}>{material.name}</p>
          {isOutOfService ? (
            <p className="truncate text-2xs font-medium text-muted-foreground">
              {t('assignmentDialog.outOfService')}
            </p>
          ) : elsewhere ? (
            <span
              title={elsewhere.full}
              className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-2xs font-medium text-amber-600 dark:text-amber-400"
            >
              <Siren className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{elsewhere.short}</span>
            </span>
          ) : vehicleOnScene ? (
            <span
              title={t('assignmentDialog.vehicleOnSceneHint', { name: material.category })}
              className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-2xs font-medium text-emerald-600 dark:text-emerald-400"
            >
              <Truck className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{material.category}</span>
            </span>
          ) : (
            <p className="text-xs text-muted-foreground truncate">{material.category}</p>
          )}
        </div>
      </button>
    )
  }

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
                <div className="space-y-4">
                  {crewSections.free.length > 0 && (
                    <ListSection tone="free" label={t('assignmentDialog.sectionFree', { count: crewSections.free.length })}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {crewSections.free.map(renderPersonTile)}
                      </div>
                    </ListSection>
                  )}
                  {crewSections.busy.length > 0 && (
                    <ListSection tone="busy" label={t('assignmentDialog.sectionBusy', { count: crewSections.busy.length })}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {crewSections.busy.map(renderPersonTile)}
                      </div>
                    </ListSection>
                  )}
                </div>
              )}

              {resourceType === 'vehicles' && (
                <div className="space-y-4">
                  {(vehicleSections.free.length > 0 || !!onToggleZuFuss) && (
                    <ListSection tone="free" label={t('assignmentDialog.sectionFree', { count: vehicleSections.free.length })}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {/* «Zu Fuss» is not a vehicle and is never spoken for,
                            so it leads the free block. */}
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
                        {vehicleSections.free.map(renderVehicleTile)}
                      </div>
                    </ListSection>
                  )}
                  {vehicleSections.busy.length > 0 && (
                    <ListSection tone="busy" label={t('assignmentDialog.sectionBusy', { count: vehicleSections.busy.length })}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {vehicleSections.busy.map(renderVehicleTile)}
                      </div>
                    </ListSection>
                  )}
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
                                  wasJustAssigned && "animate-check-appear"
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
                        {/* Expanded individual materials — the same tile as
                            ungrouped items, slightly inset so they read as the
                            module's contents. */}
                        {isExpanded && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-4 border-l-2 border-border/40 ml-3">
                            {groupMats.map(renderMaterialTile)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {/* Ungrouped materials — free first, spoken-for underneath.
                      Module groups above stay whole: a module is a unit. */}
                  {ungroupedMaterialSections.free.length > 0 && (
                    <ListSection tone="free" label={t('assignmentDialog.sectionFree', { count: ungroupedMaterialSections.free.length })}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {ungroupedMaterialSections.free.map(renderMaterialTile)}
                      </div>
                    </ListSection>
                  )}
                  {ungroupedMaterialSections.busy.length > 0 && (
                    <ListSection tone="busy" label={t('assignmentDialog.sectionBusy', { count: ungroupedMaterialSections.busy.length })}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {ungroupedMaterialSections.busy.map(renderMaterialTile)}
                      </div>
                    </ListSection>
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
              // Every role, so the confirm names what is actually being taken.
              func: specialFunctionsOf(confirmPerson).map((f) => f.label).join(' · '),
            })
          : ''
      }
      cancelText={t('common.cancel')}
      confirmText={t('assignmentDialog.specialFnConfirmAction')}
      onConfirm={() => {
        if (confirmPerson) addPersonToSelection(confirmPerson)
      }}
    />

    {/* Fallback only: the material is flagged as busy but the binding could not
        be resolved to a concrete incident/Auftrag, so there is nothing to move
        it off. Everything resolvable goes to the shared conflict dialog. */}
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

    {/* Fallback only — same reasoning as the material confirm above. */}
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
