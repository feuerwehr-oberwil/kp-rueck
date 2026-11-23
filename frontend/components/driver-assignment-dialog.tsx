"use client"

import { EmptyState, SearchEmptyState } from "@/components/ui/empty-state"
import { useState, useMemo, useEffect } from "react"
import { PickerDialog } from "@/components/ui/picker-dialog"
import { SearchInput } from "@/components/ui/search-input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { UserPlus, Plus } from "lucide-react"
import { useIsMobile } from "@/components/ui/use-mobile"
import { PersonPickTile } from "@/components/kanban/assignment-list-section"
import { einsatzWhere, usePersonTileFacts } from "@/components/kanban/person-tile-facts"
import { toast } from "sonner"
import { FormMessage, fieldMessageProps, focusFirstBlockingField, formMessageId } from "@/components/ui/form-message"
import { apiClient, type ApiEventSpecialFunctionResponse } from "@/lib/api-client"
import { type Person, type Operation, useOperations } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { usePersonMatcher } from "@/lib/hooks/use-person-matcher"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { useTranslations } from "next-intl"
import { ShellLoader } from "@/components/ui/shell-loader"

interface DriverAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vehicleId: string
  vehicleName: string
  eventId: string
  currentDriverId: string | null
  currentDriverName: string | null
  personnel: Person[]
  operations: Operation[]
  specialFunctions: ApiEventSpecialFunctionResponse[]
  onDriverAssigned: () => void
  /** Resolves false when the removal failed (already rolled back + toasted). */
  removeCrew: (operationId: string, personnelId: string) => Promise<boolean>
}

/** The walk-in name field – its message and the submit's focus target. */
const WALK_IN_NAME_ID = "walk-in-driver-name"
/** «Keine Person gewählt.» – said above the list when «Übernehmen» has nothing to take. */
const PICK_MESSAGE_ID = "driver-pick-message"

/**
 * «Fahrer für TLF»: pick the vehicle's ONE driver (ENT-10 A). The person tiles of the
 * assignment dialog (`PersonPickTile`, one to choose: radio dot), the current driver chosen
 * with «aktuell»; a tap chooses, «Übernehmen» applies – a mistap is not yet a write. Unticking the current driver
 * turns the main answer into «Ohne Fahrer» (after a confirm). Moving somebody off an Einsatz
 * or off another vehicle asks first. A bottom sheet on the phone (`PickerDialog`).
 */
export function DriverAssignmentDialog({
  open,
  onOpenChange,
  vehicleId,
  vehicleName,
  eventId,
  currentDriverId: initialDriverId,
  currentDriverName: initialDriverName,
  personnel,
  operations,
  specialFunctions,
  onDriverAssigned,
  removeCrew,
}: DriverAssignmentDialogProps) {
  const t = useTranslations('incidents.driver')
  const tCommon = useTranslations('incidents.common')
  const tForm = useTranslations('common.formMessage')
  const tPick = useTranslations('common.personPick')
  const isMobile = useIsMobile()
  const { refreshOperations } = useOperations()
  const { groups } = useGroups()
  const matchesPerson = usePersonMatcher()
  const [searchQuery, setSearchQuery] = useState("")
  const [isAssigning, setIsAssigning] = useState(false)
  const [justAssigned, setJustAssigned] = useState<string | null>(null)

  // Inline "add a walk-in as driver" (e.g. a former driver who shows up to help
  // and isn't in the checked-in roster yet).
  const [showAddForm, setShowAddForm] = useState(false)
  const [newPersonName, setNewPersonName] = useState("")
  const [newPersonError, setNewPersonError] = useState<string | null>(null)
  const [isAddingPerson, setIsAddingPerson] = useState(false)

  // Track driver locally so we can update UI immediately
  const [localDriverId, setLocalDriverId] = useState<string | null>(initialDriverId)
  const [localDriverName, setLocalDriverName] = useState<string | null>(initialDriverName)
  // The ticked tile – the answer «Übernehmen» applies. Starts on the current driver.
  const [chosenId, setChosenId] = useState<string | null>(initialDriverId)
  const [pickMessage, setPickMessage] = useState<string | null>(null)

  // Conflict dialog state
  const [conflictDialog, setConflictDialog] = useState<{
    open: boolean
    person: Person | null
    conflictingOperations: Array<{ id: string; location: string; personnelId: string }>
  }>({ open: false, person: null, conflictingOperations: [] })

  // Reassign dialog state (person is already driving another vehicle)
  const [reassignDialog, setReassignDialog] = useState<{
    open: boolean
    person: Person | null
    fromVehicleId: string | null
    fromVehicleName: string
  }>({ open: false, person: null, fromVehicleId: null, fromVehicleName: "" })

  // Remove-driver confirmation (losing the driver function is consequential:
  // the person is treated as a normal person afterwards)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)

  // Sync local state when props change (e.g., dialog reopened)
  useEffect(() => {
    if (open) {
      setLocalDriverId(initialDriverId)
      setLocalDriverName(initialDriverName)
      setChosenId(initialDriverId)
      setPickMessage(null)
    }
  }, [open, initialDriverId, initialDriverName])

  // The «just assigned» flash on a row lasts 600ms. The effect owns the timer, so closing or
  // unmounting the dialog clears it instead of setting state on a component that is gone.
  useEffect(() => {
    if (!justAssigned) return
    const timer = setTimeout(() => setJustAssigned(null), 600)
    return () => clearTimeout(timer)
  }, [justAssigned])

  // Reset search and the flash on close – reopened within 600ms it must not replay the last assign.
  useEffect(() => {
    if (!open) {
      setSearchQuery("")
      setJustAssigned(null)
    }
  }, [open])

  // Map personnel already driving ANOTHER vehicle → that vehicle {id, name}.
  // They stay selectable (shown with a "Fährt {vehicle}" badge); picking one
  // moves them here after a confirmation instead of being hidden.
  const otherVehicleByDriver = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const f of specialFunctions) {
      if (f.function_type === 'driver' && f.vehicle_id && f.vehicle_id !== vehicleId) {
        m.set(f.personnel_id, { id: f.vehicle_id, name: f.vehicle_name ?? '' })
      }
    }
    return m
  }, [specialFunctions, vehicleId])

  // Get available personnel (checked in). Includes people driving another
  // vehicle and incident-assigned personnel — both are selectable with a
  // confirmation step.
  const availablePersonnel = useMemo(() => {
    return personnel.filter(p => {
      // The current driver is a tile too – ticked, «aktuell».
      if (p.id === localDriverId) return true
      // Already driving another vehicle → keep (confirm-to-move on click)
      if (otherVehicleByDriver.has(p.id)) return true
      // Must be available or assigned to an incident (not a driver/magazin)
      if (p.status === 'available') return true
      // Include incident-assigned personnel (but not drivers/magazin)
      if (p.status === 'assigned' && !p.isDriver && !p.isMagazin) return true
      return false
    })
  }, [personnel, otherVehicleByDriver, localDriverId])

  // Get operations where a person is assigned
  const getPersonConflicts = (person: Person) => {
    return operations
      .filter(op => op.crew.some(m => m.personnelId === person.id))
      .map(op => ({ id: op.id, location: getIncidentRefLabel(op, 40), personnelId: person.id }))
  }

  // The tile's where · roles line: the Einsatz the person is on (amber – taking them releases
  // them there), else the other vehicle they drive, plus every other Ereignis role.
  const factsOf = usePersonTileFacts()

  const toggleChosen = (personId: string) => {
    setChosenId(current => (current === personId ? null : personId))
    setPickMessage(null)
  }

  /** «Übernehmen»: nothing changed → close; the current driver unticked → «Ohne Fahrer»
   *  (confirm first); somebody else ticked → assign, through the conflict confirms. */
  const applyChoice = () => {
    if (chosenId === localDriverId) {
      if (chosenId) onOpenChange(false)
      else setPickMessage(tPick('noneChosen'))
      return
    }
    if (!chosenId) {
      setRemoveDialogOpen(true)
      return
    }
    const person = availablePersonnel.find(p => p.id === chosenId)
    if (person) void handleAssignDriver(person)
    else setPickMessage(tPick('noneChosen'))
  }

  // Filter by search query — shared matcher (name / rank / tags / special
  // functions / current place), same behaviour as the sidebar and the assignment dialog.
  const filteredPersonnel = useMemo(() => {
    if (!searchQuery.trim()) return availablePersonnel
    return availablePersonnel.filter(p => matchesPerson(p, searchQuery))
  }, [availablePersonnel, searchQuery, matchesPerson])

  // Split into F-tagged (Fahrer) and others
  const { driversGroup, othersGroup } = useMemo(() => {
    const drivers: Person[] = []
    const others: Person[] = []
    for (const p of filteredPersonnel) {
      if (p.tags && p.tags.includes("F")) {
        drivers.push(p)
      } else {
        others.push(p)
      }
    }
    return { driversGroup: drivers, othersGroup: others }
  }, [filteredPersonnel])

  const handleAssignDriver = async (person: Person) => {
    // Already driving another vehicle → confirm the move first
    const drivingOther = otherVehicleByDriver.get(person.id)
    if (drivingOther) {
      setReassignDialog({
        open: true,
        person,
        fromVehicleId: drivingOther.id,
        fromVehicleName: drivingOther.name,
      })
      return
    }

    // Check if person is assigned to any incident
    const conflicts = getPersonConflicts(person)
    if (conflicts.length > 0) {
      setConflictDialog({
        open: true,
        person,
        conflictingOperations: conflicts,
      })
      return
    }

    await doAssignDriver(person)
  }

  const doAssignDriver = async (person: Person) => {
    setIsAssigning(true)
    const previousDriverId = localDriverId
    const previousDriverName = localDriverName
    try {
      // If there's a current driver, unassign them first
      if (previousDriverId) {
        await apiClient.unassignSpecialFunction(eventId, {
          personnel_id: previousDriverId,
          function_type: 'driver',
          vehicle_id: vehicleId,
        })
      }

      // Assign the new driver. If this fails, the old driver is ALREADY gone
      // server-side — compensate instead of leaving the UI claiming the old
      // driver while the vehicle is actually driverless.
      try {
        await apiClient.assignSpecialFunction(eventId, {
          personnel_id: person.id,
          function_type: 'driver',
          vehicle_id: vehicleId,
        })
      } catch (error) {
        console.error('Failed to assign driver:', error)
        if (previousDriverId) {
          try {
            await apiClient.assignSpecialFunction(eventId, {
              personnel_id: previousDriverId,
              function_type: 'driver',
              vehicle_id: vehicleId,
            })
            toast.error(t('assignErrorTitle'), {
              description: t('previousDriverKept', { driver: previousDriverName ?? '', vehicle: vehicleName }),
            })
          } catch {
            // Compensation failed too — show the real state.
            setLocalDriverId(null)
            setLocalDriverName(null)
            onDriverAssigned()
            toast.error(t('assignErrorTitle'), {
              description: t('noDriverNow', { vehicle: vehicleName }),
            })
          }
        } else {
          toast.error(t('assignErrorTitle'))
        }
        return
      }

      // Update local state
      setLocalDriverId(person.id)
      setLocalDriverName(person.name)

      setJustAssigned(person.id)

      onDriverAssigned()
      onOpenChange(false)
    } catch (error) {
      // Unassigning the old driver failed — nothing changed server-side.
      console.error('Failed to assign driver:', error)
      toast.error(t('assignErrorTitle'), {
        description: previousDriverName ? t('previousDriverKept', { driver: previousDriverName, vehicle: vehicleName }) : undefined,
      })
    } finally {
      setIsAssigning(false)
    }
  }

  // Create a not-yet-registered person as a GUEST of this Ereignis (not the roster – they
  // turned up tonight), check them in, tag them as Fahrer, and assign them as this
  // vehicle's driver in one go.
  const addWalkInDriver = async () => {
    const name = newPersonName.trim()
    if (isAddingPerson) return
    // Said under the name field, and the cursor stays there.
    const problem = !name
      ? tForm('nameRequired')
      : personnel.some(p => p.name.trim().toLowerCase() === name.toLowerCase())
        ? t('duplicateName')
        : null
    if (problem) {
      setNewPersonError(problem)
      focusFirstBlockingField([WALK_IN_NAME_ID])
      return
    }
    setIsAddingPerson(true)
    try {
      const created = await apiClient.createPersonnel({ name, status: 'available', tags: ['F'], guest_event_id: eventId })
      try {
        // The board's own door to the check-in endpoint. This used to mint a public
        // share token and consume it one line later, which handed a login-less link
        // to the whole Ereignis just to register one person the editor is looking at.
        await apiClient.checkInPersonnelForEvent(created.id, eventId)
      } catch (checkInError) {
        // NOT non-fatal, whatever the old comment here claimed. The Personal list IS
        // the checked-in roster, so a walk-in who failed to check in is a person
        // nobody on the board can see — the exact "Keine Personen verfügbar" the
        // operator reported. Say so and stop, rather than making an invisible person
        // the driver of a vehicle.
        console.error('Failed to check in walk-in driver:', checkInError)
        await refreshOperations()
        setNewPersonName("")
        setShowAddForm(false)
        toast.error(t('checkInFailedTitle'), {
          description: t('checkInFailedDescription', { name: created.name }),
        })
        return
      }
      await refreshOperations()
      setNewPersonName("")
      setShowAddForm(false)
      // Assign straight away — that's the whole point of adding them here.
      await doAssignDriver({ id: created.id, name: created.name } as Person)
    } catch (error) {
      console.error('Failed to add walk-in driver:', error)
      toast.error(t('addError'))
    } finally {
      setIsAddingPerson(false)
    }
  }

  const handleConflictConfirm = async () => {
    const { person, conflictingOperations } = conflictDialog
    if (!person) return

    setConflictDialog(prev => ({ ...prev, open: false }))
    setIsAssigning(true)
    try {
      // Unassign from all conflicting operations and WAIT for the results —
      // firing-and-forgetting raced the driver assignment, so a failed
      // removal put the person back on the incident AFTER they became
      // driver: exactly the state this dialog exists to prevent.
      const results = await Promise.all(
        conflictingOperations.map((conflict) => removeCrew(conflict.id, conflict.personnelId))
      )
      if (results.some((ok) => !ok)) {
        // removeCrew already rolled back and toasted; don't make the person
        // a driver while they're still assigned to an incident.
        return
      }

      await doAssignDriver(person)
    } finally {
      setIsAssigning(false)
    }
  }

  const handleReassignConfirm = async () => {
    const { person, fromVehicleId } = reassignDialog
    if (!person || !fromVehicleId) return

    setReassignDialog(prev => ({ ...prev, open: false }))
    setIsAssigning(true)
    try {
      // Take the person off the other vehicle first, then assign here.
      await apiClient.unassignSpecialFunction(eventId, {
        personnel_id: person.id,
        function_type: 'driver',
        vehicle_id: fromVehicleId,
      })
      await doAssignDriver(person)
    } catch (error) {
      console.error('Failed to reassign driver:', error)
      toast.error(t('assignErrorTitle'))
    } finally {
      setIsAssigning(false)
    }
  }

  const handleRemoveDriver = async () => {
    if (!localDriverId) return

    setIsAssigning(true)
    try {
      await apiClient.unassignSpecialFunction(eventId, {
        personnel_id: localDriverId,
        function_type: 'driver',
        vehicle_id: vehicleId,
      })

      setLocalDriverId(null)
      setLocalDriverName(null)

      // «Ohne Fahrer» was the answer: the picker is done.
      onDriverAssigned()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to remove driver:', error)
      toast.error(t('removeError'))
    } finally {
      setIsAssigning(false)
    }
  }

  const renderTile = (person: Person) => {
    const { where, roles, plan } = factsOf(person, { elsewhere: einsatzWhere(person.id, operations, groups), driverFor: vehicleId })
    return (
      <PersonPickTile
        name={person.name}
        personnelId={person.id}
        kennung={person.kennung ?? null}
        rank={person.role}
        where={where}
        roles={roles}
        plan={plan}
        single
        checked={chosenId === person.id}
        current={person.id === localDriverId}
        animate={justAssigned === person.id}
        disabled={isAssigning}
        onClick={() => toggleChosen(person.id)}
      />
    )
  }

  const toolbar = (
    <>
      <SearchInput
        placeholder={t('searchPlaceholder')}
        value={searchQuery}
        onValueChange={setSearchQuery}
        // A phone sheet raises no keyboard by itself (ui/sheet.tsx).
        autoFocus={!isMobile}
      />

      {/* Add a not-yet-registered walk-in directly as driver */}
      {!showAddForm ? (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-sel-edge hover:text-foreground"
        >
          <UserPlus className="h-4 w-4" />
          <span>{t('addPersonButton')}</span>
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t('addPersonHint')}</p>
          <Input
            id={WALK_IN_NAME_ID}
            type="text"
            autoFocus
            placeholder={t('addNamePlaceholder')}
            value={newPersonName}
            onChange={(e) => { setNewPersonName(e.target.value); setNewPersonError(null) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addWalkInDriver() }
              if (e.key === 'Escape') { setShowAddForm(false); setNewPersonName(""); setNewPersonError(null) }
            }}
            {...fieldMessageProps(WALK_IN_NAME_ID, newPersonError ? 'error' : null)}
          />
          <FormMessage id={formMessageId(WALK_IN_NAME_ID)}>{newPersonError}</FormMessage>
          <div className="flex gap-2">
            <Button
              onClick={addWalkInDriver}
              disabled={isAddingPerson}
              className="flex-1"
              size="sm"
            >
              {isAddingPerson ? (
                <><ShellLoader className="size-3.5" />{t('adding')}</>
              ) : (
                <><Plus className="size-3.5" />{t('addAndAssign')}</>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setShowAddForm(false); setNewPersonName(""); setNewPersonError(null) }}
              disabled={isAddingPerson}
            >
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      )}
      <FormMessage id={PICK_MESSAGE_ID}>{pickMessage}</FormMessage>
    </>
  )

  return (
    <>
      <PickerDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('title', { vehicle: vehicleName })}
        description={localDriverName ? t('currentDriver', { driver: localDriverName }) : t('noDriverAssigned')}
        toolbar={toolbar}
        listTestId="driver-list"
        radioGroupLabel={t('title', { vehicle: vehicleName })}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={applyChoice} disabled={isAssigning} aria-describedby={pickMessage ? PICK_MESSAGE_ID : undefined}>
              {isAssigning && <ShellLoader className="size-4" />}
              {chosenId === null && localDriverId ? t('withoutDriver') : tPick('apply')}
            </Button>
          </>
        }
      >
        {/* Fahrer (F-tagged) section */}
        {driversGroup.length > 0 && othersGroup.length > 0 && (
          <p className="px-1 pt-1 text-xs font-medium tracking-wide text-muted-foreground">{t('driversSection')}</p>
        )}
        {driversGroup.map((person) => (
          <div key={person.id}>{renderTile(person)}</div>
        ))}

        {/* Andere (non-F-tagged) section */}
        {othersGroup.length > 0 && driversGroup.length > 0 && (
          <p className="px-1 pt-3 text-xs font-medium tracking-wide text-muted-foreground">{t('othersSection')}</p>
        )}
        {othersGroup.map((person) => (
          <div key={person.id}>{renderTile(person)}</div>
        ))}

        {/* Empty state */}
        {filteredPersonnel.length === 0 && (searchQuery.trim() ? (
          <SearchEmptyState query={searchQuery} onClear={() => setSearchQuery("")} />
        ) : (
          <EmptyState compact title={t('noAvailablePersons')} description={t('allAssignedHint')} />
        ))}
      </PickerDialog>

      {/* Conflict confirmation dialog */}
      <ConfirmDialog
        open={conflictDialog.open}
        onOpenChange={(open) => setConflictDialog(prev => ({ ...prev, open }))}
        title={t('conflictTitle')}
        description={t.rich('conflictDescription', {
          name: conflictDialog.person?.name ?? '',
          count: conflictDialog.conflictingOperations.length,
          location: conflictDialog.conflictingOperations[0]?.location ?? '',
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        cancelText={tCommon('cancel')}
        confirmText={t('conflictConfirm')}
        onConfirm={handleConflictConfirm}
      />

      {/* Reassign confirmation dialog (person drives another vehicle) */}
      <ConfirmDialog
        open={reassignDialog.open}
        onOpenChange={(open) => setReassignDialog(prev => ({ ...prev, open }))}
        title={t('reassignTitle')}
        description={t.rich('reassignDescription', {
          name: reassignDialog.person?.name ?? '',
          fromVehicle: reassignDialog.fromVehicleName,
          vehicle: vehicleName,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        cancelText={tCommon('cancel')}
        confirmText={t('reassignConfirm')}
        onConfirm={handleReassignConfirm}
      />

      {/* Remove-driver confirmation dialog */}
      <ConfirmDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        title={t('removeConfirmTitle')}
        description={t.rich('removeConfirmDescription', {
          name: localDriverName ?? '',
          vehicle: vehicleName,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        cancelText={tCommon('cancel')}
        confirmText={t('removeConfirmAction')}
        onConfirm={handleRemoveDriver}
      />
    </>
  )
}
