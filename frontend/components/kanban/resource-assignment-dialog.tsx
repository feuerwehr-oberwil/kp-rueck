"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useEffectEvent } from "@/lib/hooks/use-effect-event"
import { useTranslations } from "next-intl"
import { ResponsiveDialog, ResponsiveDialogBody, ResponsiveDialogFooter, ResponsiveDialogToolbar } from "@/components/ui/responsive-dialog"
import { useIsMobile } from "@/components/ui/use-mobile"
import { SurfaceStep, SurfaceStepEscHint, useOpeningSurface } from "@/components/ui/surface-step"
import { Button } from "@/components/ui/button"
import { ShellLoader } from "@/components/ui/shell-loader"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useOperations, type Person, type Material } from "@/lib/contexts/operations-context"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { getIncidentLocationLabel } from "@/lib/incident-types"
import { usePersonTileFacts } from "@/components/kanban/person-tile-facts"
import { type PersonWhere } from "@/components/kanban/assignment-list-section"
import { MaterialAssignmentList } from "@/components/kanban/material-assignment-list"
import { useAssignmentOccupancy } from "@/components/kanban/assignment-occupancy"
import { useStagedMoves } from "@/components/kanban/assignment-staged-moves"
import { useAssignmentSections } from "@/components/kanban/assignment-sections"
import { type AssignmentResource, useAssignmentFilters } from "@/components/kanban/assignment-filters"
import { AssignmentFilterControls } from "@/components/kanban/assignment-filter-controls"
import { AssignmentEmptyState } from "@/components/kanban/assignment-empty-state"
import { AssignmentConfirmDialogs } from "@/components/kanban/assignment-confirm-dialogs"
import { CrewAssignmentList } from "@/components/kanban/crew-assignment-list"
import { type AssignableVehicle, VehicleAssignmentList } from "@/components/kanban/vehicle-assignment-list"
import { usePersonNaming } from "@/components/person-name"
import { onPickerKeyDown, PICKER_FOOTER } from "@/components/ui/picker-keys"

interface ResourceAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceType: AssignmentResource | null
  operationId: string | null
  /** The search the dialog opens with — a field request's item (R13), so
   *  «Material zuweisen» on «Tauchpumpe Gr. ×2» lands on the pumps. */
  initialSearch?: string
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
  vehicles: AssignableVehicle[]
  materials: Material[]
  assignedPersonnelIds: string[]
  assignedVehicleIds: string[]
  assignedMaterials: string[] // Array of material IDs
  /** Personnel ids assigned as Reko for this incident (should be excluded from crew assignment) */
  rekoPersonnelIds?: string[]
  onAssignPerson: (personId: string, personName: string, operationId: string) => void
  onAssignVehicle: (vehicleId: string, vehicleName: string, operationId: string) => void
  onAssignMaterial: (materialId: string, operationId: string) => void
  onRemovePerson: (operationId: string, personnelId: string) => void
  onRemoveVehicle: (operationId: string, vehicleId: string) => void
  onRemoveMaterial: (operationId: string, materialId: string) => void
  zuFuss?: boolean
  onToggleZuFuss?: () => void
  occupiedPersonnelIds?: Set<string>
  occupiedVehicleIds?: Set<string>
  occupiedMaterialIds?: Set<string>
  /** Vehicle id → «bleibt vor Ort». Shown per assigned vehicle so the choice
   *  can be made where the vehicle is assigned, not only on the incident card. */
  vehicleDriverStay?: ReadonlyMap<string, boolean>
  onToggleDriverStay?: (vehicleId: string) => void
  /** Opens the check-in link (the board's «Links & QR» sheet). Offered when
   *  nobody is checked in — the one way an empty crew list fills up. The
   *  dialog closes itself first. Omitted where there is no such sheet; the
   *  sentence still says where it is. */
  onShowCheckIn?: () => void
}

export function ResourceAssignmentDialog({
  open,
  onOpenChange,
  resourceType,
  operationId,
  initialSearch,
  assignTarget = 'incident',
  routeName,
  personnel,
  vehicles,
  materials,
  assignedPersonnelIds,
  assignedVehicleIds,
  assignedMaterials,
  rekoPersonnelIds = [],
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
  onShowCheckIn,
}: ResourceAssignmentDialogProps) {
  const t = useTranslations('kanban')
  // Below 768px the dialog is a bottom sheet (see PHONE below).
  const isMobile = useIsMobile()
  // The Einsatz-Detail (an L window) this dialog was opened from, if any – then it is a step there.
  const stepHost = useOpeningSurface(open, { wideOnly: true })
  const { outOfServiceVehicleIds, operations } = useOperations()
  // Who drives what, live. Assigning a vehicle without knowing whether anybody
  // is driving it is how a Fahrzeug reaches a Schadenplatz on the board and
  // nowhere else — the driver is the half of "TLF 1 is available" that the
  // fleet list does not carry. Loaded only while the dialog is open.
  const vehicleDrivers = useVehicleDrivers()
  const naming = usePersonNaming()
  const [justAssigned, setJustAssigned] = useState<string | null>(null)
  // The 600 ms «just assigned» flash on a tile. One timer at a time, cleared on
  // unmount so it never sets state on a dialog that is gone.
  const justAssignedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flashJustAssigned = (id: string) => {
    setJustAssigned(id)
    clearTimeout(justAssignedTimerRef.current)
    justAssignedTimerRef.current = setTimeout(() => setJustAssigned(null), 600)
  }
  useEffect(() => () => clearTimeout(justAssignedTimerRef.current), [])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

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
   * The rule itself is shared with the single pickers (`usePersonTileFacts`).
   */
  const factsOf = usePersonTileFacts()
  const tileFactsOf = (p: Person, elsewhere: PersonWhere | null) =>
    factsOf(p, { elsewhere, isReko: rekoPersonnelIds.includes(p.id) })
  const specialFunctionLabels = (p: Person): string[] => {
    const { where, roles } = tileFactsOf(p, null)
    return [...(where ? [where.full] : []), ...roles.map((role) => role.label)]
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

  const {
    materialOccupancy,
    personOccupancy,
    occupiedElsewhereMaterialIds,
    vehicleElsewhereLabel,
    materialElsewhereLabel,
    personElsewhereLabel,
  } = useAssignmentOccupancy({
    assignTarget,
    operationId,
    materials,
    assignedPersonnelIds,
    assignedVehicleIds,
    assignedMaterials,
    occupiedPersonnelIds,
    occupiedVehicleIds,
    occupiedMaterialIds,
  })
  const { askConflict, releaseStaged, clearStagedMoves } = useStagedMoves({ assignTarget, operationId, routeName })
  const filters = useAssignmentFilters({
    open,
    resourceType,
    personnel: selectablePersonnel,
    vehicles: availableVehicles,
    materials: selectableMaterials,
    assignedVehicleIds,
  })
  const { setSearchQuery, groupedFilteredMaterials, emptyReason } = filters

  // Snapshot the assigned state into the local selection ONLY on the open
  // transition. Re-snapshotting whenever assignedPersonnelIds/assignedMaterials
  // change (a background poll, WS push, or optimistic revert that lands while the
  // dialog is open) was wiping the user's in-progress ticks — boxes appeared to
  // untick themselves. Guarding on the false→true edge keeps selections stable.
  const wasOpenRef = useRef(false)
  // Counts the openings, so a «Fertig» that finishes after a close and reopen leaves the new
  // picker open (`handleConfirm`).
  const openSession = useRef(0)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      openSession.current++
      setSelectedPersonnel(new Set(assignedPersonnelIds))
      setSelectedMaterials(new Set(assignedMaterials))
      clearStagedMoves()
      if (initialSearch) setSearchQuery(initialSearch)
    }
    wasOpenRef.current = open
  }, [open, assignedPersonnelIds, assignedMaterials, initialSearch, clearStagedMoves, setSearchQuery])

  /** The Einsatz the title's «zu Einsatz» means, named under it (number + address), so the
   *  operator sees WHICH one before ticking. An Auftrag already names itself in the title. */
  const destination = useMemo(() => {
    if (assignTarget === 'route') return null
    const op = operations.find((o) => o.id === operationId)
    return op ? { number: op.number ?? null, place: getIncidentLocationLabel(op) } : null
  }, [assignTarget, operations, operationId])

  // One «Fertig» at a time: a second click while releases run would free and assign twice.
  // The ref answers synchronously (a double click); `saving` freezes the picker meanwhile – no
  // tick, no close – so what «Fertig» commits is what the operator sees.
  const committing = useRef(false)
  const [saving, setSaving] = useState(false)
  const close = () => {
    if (!committing.current) onOpenChange(false)
  }
  const onOpenChangeUnlessSaving = (next: boolean) => {
    if (next) onOpenChange(true)
    else close()
  }

  // Check if a resource is selected (for crew/materials) or assigned (for vehicles)
  const isPersonSelected = (personId: string) => selectedPersonnel.has(personId)
  const isVehicleAssigned = (vehicleId: string) => assignedVehicleIds.includes(vehicleId)
  const isMaterialSelected = (materialId: string) => selectedMaterials.has(materialId)

  // Toggle selection for crew (local state only, doesn't call API)
  const addPersonToSelection = (person: Person) => {
    setSelectedPersonnel(prev => {
      const next = new Set(prev)
      next.add(person.id)
      return next
    })
    flashJustAssigned(person.id)
  }

  const handleTogglePersonSelection = (person: Person) => {
    if (committing.current) return
    // Deselecting is always immediate.
    if (selectedPersonnel.has(person.id)) {
      setSelectedPersonnel(prev => {
        const next = new Set(prev)
        next.delete(person.id)
        return next
      })
      return
    }
    // Selecting someone bound to another incident/Auftrag → the shared
    // Doppelbelegung dialog (verschieben / auf beiden führen / abbrechen).
    // Takes precedence over the special-function confirm — one question is enough.
    const bindings = personOccupancy.get(person.id)
    if (bindings?.length) {
      askConflict('personnel', person.id, naming.inline(person), bindings, () => addPersonToSelection(person))
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
    if (specialFunctionLabels(person).length > 0) {
      setConfirmPerson(person)
      return
    }
    addPersonToSelection(person)
  }

  // Vehicles still use instant assignment
  const handleToggleVehicle = (vehicle: { id: string; name: string }) => {
    if (!operationId) return

    const isAssigned = isVehicleAssigned(vehicle.id)
    if (isAssigned) {
      onRemoveVehicle(operationId, vehicle.id)
    } else {
      onAssignVehicle(vehicle.id, vehicle.name, operationId)
      flashJustAssigned(vehicle.id)
    }
  }

  // Add a material to the local selection (free path or after the confirm).
  const addMaterialToSelection = (materialId: string) => {
    setSelectedMaterials(prev => {
      const next = new Set(prev)
      next.add(materialId)
      return next
    })
    flashJustAssigned(materialId)
  }

  // Toggle selection for materials (local state only, doesn't call API)
  const handleToggleMaterialSelection = (material: Material) => {
    if (committing.current) return
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
    if (groupMaterialIds.length === 0 || committing.current) return
    setSelectedMaterials(prev => {
      const next = new Set(prev)
      const allSelected = groupMaterialIds.every(id => next.has(id))
      if (allSelected) {
        for (const id of groupMaterialIds) next.delete(id)
      } else {
        for (const id of groupMaterialIds) {
          next.add(id)
        }
        flashJustAssigned(`group-${groupMaterialIds[0]}`)
      }
      return next
    })
  }

  const { crewSections, vehicleSections, ungroupedMaterialSections, allBusyText } = useAssignmentSections({
    resourceType,
    filters,
    assignedPersonnelIds,
    isVehicleAssigned,
    vehicleElsewhereLabel,
    occupiedElsewhereMaterialIds,
    isMaterialSelected,
  })

  // A material depot named like an assigned vehicle («MoWa») is stock already on
  // scene. Depots are free text, so this one match is by name on purpose.
  const assignedVehicleNames = vehicles.filter((v) => assignedVehicleIds.includes(v.id)).map((v) => v.name)

  // Quick number-key assignment (1..9): toggle the Nth visible item of the active
  // resource type — the same action as clicking it. The onAssign*/onRemove*
  // callbacks are wired by the parent, so in route-assign mode this assigns to the
  // Auftrag (via assignResource) exactly like clicking, not to a single incident.
  // An effect event, so a key always sees the lists and handlers of the latest render.
  const onNumberKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
    // The compact «Filtern» menu has type-ahead of its own.
    if (target?.closest?.('[role="menu"]')) return
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
  })
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => onNumberKey(e)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // Commit changes when "Fertig" is clicked (for crew and materials). A failed staged release
  // keeps the dialog open with its ticks, so the operator sees what did not go through.
  const handleConfirm = async () => {
    if (!operationId) {
      onOpenChange(false)
      return
    }
    if (committing.current) return
    committing.current = true
    setSaving(true)
    const session = openSession.current
    let released = true
    try {
      // Process crew changes
      if (resourceType === 'crew') {
        const currentAssigned = new Set(assignedPersonnelIds)
        const toAdd = [...selectedPersonnel].filter(id => !currentAssigned.has(id))
        const toRemove = [...currentAssigned].filter(id => !selectedPersonnel.has(id))

        // Add new assignments
        for (const id of toAdd) {
          const person = personnel.find(p => p.id === id)
          if (!person) continue
          if (await releaseStaged('personnel', person.id)) onAssignPerson(person.id, person.name, operationId)
          else released = false
        }

        // Remove unselected
        for (const id of toRemove) {
          onRemovePerson(operationId, id)
        }
      }

      // Process material changes
      if (resourceType === 'materials') {
        const currentAssigned = new Set(assignedMaterials)
        const toAdd = [...selectedMaterials].filter(id => !currentAssigned.has(id))
        const toRemove = [...currentAssigned].filter(id => !selectedMaterials.has(id))

        // Add new assignments
        for (const id of toAdd) {
          if (await releaseStaged('material', id)) onAssignMaterial(id, operationId)
          else released = false
        }

        // Remove unselected
        for (const id of toRemove) {
          onRemoveMaterial(operationId, id)
        }
      }
    } finally {
      committing.current = false
      setSaving(false)
    }
    if (released && session === openSession.current) onOpenChange(false)
  }

  const getDialogTitle = () => {
    // An Auftrag (route) names the route in «…»; a plain incident reads «Mannschaft
    // zuweisen» – the Einsatz is named on the line under the title, and «… zu Einsatz
    // zuweisen» wrapped to two lines on a phone (hill climb r21).
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
        return t('assignmentDialog.selectedCountCrew', { selected: selectedPersonnel.size, total: selectablePersonnel.length })
      case 'vehicles':
        return t('assignmentDialog.vehiclesAssigned', { count: assignedVehicleIds.length }) + (zuFuss ? t('assignmentDialog.zuFussSuffix') : '')
      case 'materials':
        return t('assignmentDialog.selectedCountMaterials', { selected: selectedMaterials.size, total: selectableMaterials.length })
      default:
        return ''
    }
  }

  // Check if there are pending changes
  const hasPendingChanges = useMemo(() => {
    if (resourceType === 'crew') {
      const currentSet = new Set(assignedPersonnelIds)
      if (selectedPersonnel.size !== currentSet.size) return true
      for (const id of selectedPersonnel) {
        if (!currentSet.has(id)) return true
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
  }, [resourceType, selectedPersonnel, selectedMaterials, assignedPersonnelIds, assignedMaterials])

  const resourceList = (
    <div className="space-y-2">
      {resourceType === 'crew' && (
        <CrewAssignmentList
          free={crewSections.free}
          busy={crewSections.busy}
          allBusyText={allBusyText}
          isPersonSelected={isPersonSelected}
          justAssigned={justAssigned}
          tileFacts={(person) => tileFactsOf(person, personElsewhereLabel(person))}
          onTogglePerson={handleTogglePersonSelection}
        />
      )}

      {resourceType === 'vehicles' && (
        <VehicleAssignmentList
          free={vehicleSections.free}
          busy={vehicleSections.busy}
          allBusyText={allBusyText}
          emptyReason={emptyReason}
          zuFuss={zuFuss}
          onToggleZuFuss={onToggleZuFuss}
          isVehicleAssigned={isVehicleAssigned}
          justAssigned={justAssigned}
          vehicleElsewhereLabel={vehicleElsewhereLabel}
          vehicleDrivers={vehicleDrivers}
          vehicleDriverStay={vehicleDriverStay}
          onToggleDriverStay={onToggleDriverStay}
          onToggleVehicle={handleToggleVehicle}
        />
      )}

      {resourceType === 'materials' && (
        <MaterialAssignmentList
          groups={groupedFilteredMaterials.groups}
          ungroupedFree={ungroupedMaterialSections.free}
          ungroupedBusy={ungroupedMaterialSections.busy}
          allBusyText={allBusyText}
          selectedMaterials={selectedMaterials}
          occupiedElsewhereMaterialIds={occupiedElsewhereMaterialIds}
          materialElsewhereLabel={materialElsewhereLabel}
          assignedVehicles={assignedVehicleNames}
          justAssigned={justAssigned}
          expandedGroups={expandedGroups}
          onToggleExpanded={(groupId) => setExpandedGroups(prev => {
            const next = new Set(prev)
            if (next.has(groupId)) next.delete(groupId)
            else next.add(groupId)
            return next
          })}
          onToggleMaterial={handleToggleMaterialSelection}
          onToggleGroup={handleToggleGroupSelection}
        />
      )}

      <AssignmentEmptyState
        filters={filters}
        resourceType={resourceType}
        assignTarget={assignTarget}
        assignedVehicleIds={assignedVehicleIds}
        onClose={close}
        onShowCheckIn={onShowCheckIn}
      />
    </div>
  )

  // The search and the filters above the list — the same on the dialog and the phone sheet.
  const filterControls = (
    <AssignmentFilterControls filters={filters} resourceType={resourceType} assignedVehicleNames={assignedVehicleNames} />
  )

  // «Abbrechen» only where «Fertig» commits a selection (crew, material); a vehicle is
  // assigned on the tap, so «Fertig» just closes.
  const footerButtons = (
    <>
      {(resourceType === 'crew' || resourceType === 'materials') && (
        <Button variant="outline" disabled={saving} onClick={close}>
          {t('common.cancel')}
        </Button>
      )}
      <Button
        onClick={resourceType === 'vehicles' ? close : handleConfirm}
        disabled={saving}
        className="hover-delight"
      >
        {saving && <ShellLoader className="size-4" />}
        {t('common.done')}
        {hasPendingChanges && (resourceType === 'crew' || resourceType === 'materials') && (
          <span className="ml-1.5 px-1.5 py-0.5 text-2xs bg-action-foreground/20 rounded">
            {t('assignmentDialog.changes')}
          </span>
        )}
      </Button>
    </>
  )

  // The list on a desk: it scrolls between the filters and the footer, and while tiles run on
  // below, its bottom edge fades instead of cutting a tile off flush against the footer.
  const scrollingList = (
    <ScrollArea className="flex-1 min-h-0 pr-2" fadeEnd>
      {resourceList}
    </ScrollArea>
  )

  // PHONE (U3 B, 08.11.2026): the one bottom sheet – grip and swipe-to-close (through
  // `onOpenChange`, like the ✕), the head, the search and filters fixed, the list scrolling,
  // «Abbrechen» / «Fertig» in a footer that stays on the keys. Full height (`fill`): the sheet
  // does not jump while a search or a filter shortens the list. Opening focuses the sheet, not
  // the search (ui/sheet.tsx) – no keyboard until a tap.
  // DESK: L, a work surface – fixed height and place (dialog-frame.ts), so the list scrolls
  // inside it and the top does not jump as quick filters change. A Fahrer picker for a vehicle
  // assigned here opens inside it as a step (`surface`, owner pick 5A). ONE header: title
  // (18/600, 22px line) · the destination («1 Langegasse 28», up to two lines) · the counts
  // (12, muted), left-aligned with the search field, no icon before the title. `ps-0!` cancels
  // the start padding globals.css gives centred narrow headers.
  const dialog = (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChangeUnlessSaving}
      title={getDialogTitle()}
      subject={destination ?? undefined}
      description={getDialogDescription()}
      size="lg"
      fill
      surface={isMobile ? undefined : getDialogTitle()}
      onKeyDown={onPickerKeyDown}
      className="overflow-hidden flex flex-col"
      headerClassName="gap-1 text-left ps-0!"
      titleClassName="text-lg leading-[1.375rem] font-semibold"
      descriptionClassName="text-xs"
    >
      {/* Desk: `contents` – the filters, the list and the footer are the window's rows, 16px apart. */}
      <ResponsiveDialogToolbar className="contents">{filterControls}</ResponsiveDialogToolbar>
      <ResponsiveDialogBody className="contents">{isMobile ? resourceList : scrollingList}</ResponsiveDialogBody>
      {/* A rule and 16px above the buttons, so the last tiles end at an edge. */}
      <ResponsiveDialogFooter {...PICKER_FOOTER} className="border-t border-border pt-4">
        {footerButtons}
      </ResponsiveDialogFooter>
    </ResponsiveDialog>
  )

  // Opened from the Einsatz-Detail (an L window): a step of that window – the place first in
  // the breadcrumb, «← Zurück», Esc back – not a second L window on top (owner pick «Schritt
  // im Detail», 19.11.2026). It is a surface itself, so the Fahrer picker of a vehicle assigned
  // here becomes the next step. From the board it is its own L window (`dialog`).
  const step = stepHost && open && (
    <SurfaceStep
      host={stepHost}
      title={getDialogTitle()}
      description={getDialogDescription()}
      onBack={close}
      surface={getDialogTitle()}
      testId="assignment-step"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-4" onKeyDown={onPickerKeyDown}>
        {filterControls}
        {scrollingList}
        <div {...PICKER_FOOTER} className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <SurfaceStepEscHint host={stepHost} />
          {footerButtons}
        </div>
      </div>
    </SurfaceStep>
  )

  return (
    <>
    {stepHost && !isMobile ? step : dialog}

    <AssignmentConfirmDialogs
      confirmPerson={confirmPerson}
      setConfirmPerson={setConfirmPerson}
      specialFunctionLabels={specialFunctionLabels}
      confirmMaterial={confirmMaterial}
      setConfirmMaterial={setConfirmMaterial}
      materialElsewhereLabel={materialElsewhereLabel}
      confirmOccupiedPerson={confirmOccupiedPerson}
      setConfirmOccupiedPerson={setConfirmOccupiedPerson}
      personElsewhereLabel={personElsewhereLabel}
      addPersonToSelection={addPersonToSelection}
      addMaterialToSelection={addMaterialToSelection}
    />
    </>
  )
}
