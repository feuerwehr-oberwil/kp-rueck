"use client"

import { EmptyState, SearchEmptyState } from "@/components/ui/empty-state"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { PickerDialog } from "@/components/ui/picker-dialog"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FormMessage } from "@/components/ui/form-message"
import { useIsMobile } from "@/components/ui/use-mobile"
import { Binoculars, ArrowLeft, MapPin } from "lucide-react"
import { PersonPickTile } from "@/components/kanban/assignment-list-section"
import { einsatzWhere, tilePlan, usePersonTileFacts } from "@/components/kanban/person-tile-facts"
import { apiClient, type ApiAvailableRekoPersonnel } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { type Operation, useOperations } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"
import { personMatchesQuery, RESOURCE_STATE_BADGE_CLASSES } from "@/lib/resource-status"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { ShellLoader, LoadingStatus } from "@/components/ui/shell-loader"

/** «Keine Person gewählt.» – said above the list of a Reko picker whose main answer has
 *  nothing to take. */
export const REKO_PICK_MESSAGE_ID = "reko-pick-message"

/**
 * «Person als Reko markieren» – the checked-in people who are not Reko yet, as the same
 * person tiles as every picker (`PersonPickTile`), one to choose (radio dot), each with the
 * Fahrer picker's «where · roles» line (`usePersonTileFacts`: the Einsatz they are on, their
 * other roles) – facts only, nobody is refused. Used by the four Reko surfaces (Reko zuweisen,
 * Rekos übertragen, the checklist, Reko-Modus); each host places `searchField` above its list
 * and `list` in a `radiogroup`, and its own main answer marks `chosen`.
 */
export function useRekoCandidatePicker({
  personnel,
  operations,
  excludedPersonnelIds,
  disabled,
}: {
  personnel: Person[]
  /** The board's Einsätze – where a candidate is now. */
  operations: readonly Operation[]
  excludedPersonnelIds?: ReadonlySet<string>
  disabled?: boolean
}): { chosen: Person | null; searchField: ReactNode; list: ReactNode; reset: () => void } {
  const t = useTranslations("incidents.assignReko")
  const isMobile = useIsMobile()
  const [search, setSearch] = useState("")
  const [chosenId, setChosenId] = useState<string | null>(null)
  const factsOf = usePersonTileFacts()
  const eligible = personnel.filter((person) => !person.isReko && !excludedPersonnelIds?.has(person.id))
  const candidates = search.trim() ? eligible.filter((person) => personMatchesQuery(person, search)) : eligible

  const searchField = (
    <SearchInput
      // A phone sheet raises no keyboard by itself (ui/sheet.tsx).
      autoFocus={!isMobile}
      value={search}
      onValueChange={setSearch}
      placeholder={t("markSearchPlaceholder")}
    />
  )
  const list =
    candidates.length === 0 && search.trim() ? (
      <SearchEmptyState query={search} onClear={() => setSearch("")} />
    ) : candidates.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        {personnel.length === 0 ? t("markNoCheckedIn") : t("markAllReko")}
      </p>
    ) : (
      candidates.map((person) => {
        const { where, roles, plan } = factsOf(person, { elsewhere: einsatzWhere(person.id, operations) })
        return (
          <PersonPickTile
            key={person.id}
            name={person.name}
            personnelId={person.id}
            kennung={person.kennung ?? null}
            rank={person.role}
            where={where}
            roles={roles}
            plan={plan}
            single
            checked={chosenId === person.id}
            disabled={disabled}
            onClick={() => setChosenId((current) => (current === person.id ? null : person.id))}
          />
        )
      })
    )

  // Stable, so a host may reset from an effect.
  const reset = useCallback(() => {
    setSearch("")
    setChosenId(null)
  }, [])

  return { chosen: eligible.find((person) => person.id === chosenId) ?? null, searchField, list, reset }
}

/** The dashed «Person als Reko markieren» row above a Reko picker's list – the same
 *  shape as the driver picker's «Person hinzufügen». */
export function MarkRekoRow({ onClick }: { onClick: () => void }) {
  const t = useTranslations("incidents.assignReko")
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-sel-edge hover:text-foreground"
    >
      <Binoculars className="h-4 w-4" />
      <span>{t("markExisting")}</span>
    </button>
  )
}

/** "≈ 400 m" below ~1 km, "≈ 1,2 km" above — rounded so it reads as an
 *  estimate, not a measurement (it's straight-line, not driving distance). */
function formatDistance(meters: number): string {
  if (meters < 950) return `${Math.max(50, Math.round(meters / 50) * 50)} m`
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`
}

interface AssignRekoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  incidentId: string
  incidentTitle: string
  /**
   * A Reko person is now on this incident — **the caller closes the dialog.**
   *
   * The dialog used to fire this and then call `onOpenChange(false)` itself,
   * which was wrong for the status gate: there, closing the dialog *means*
   * "backed out", and backing out reverts the card to the status it came from.
   * React batches both calls, so `cancelGate("rekoAssignment")` still saw the old
   * operation id and undid the very move the assignment had just justified —
   * the card jumped back to «Eingegangen» right after a successful assignment.
   */
  onAssigned?: () => void
}

/**
 * «Reko-Personal zuweisen»: the Ereignis' Reko people as person tiles (ENT-10 A), the one
 * already on this Einsatz ticked with «aktuell»; a tap ticks, «Übernehmen» assigns – or,
 * on the current person, keeps it (the status gate's way forward when the answer is
 * already on screen). Open Rekos are each tile's where-note; the right column says how
 * busy and how far. «Person als Reko markieren» switches the list to the checked-in people
 * who are not Reko yet. A bottom sheet on the phone (`PickerDialog`).
 */
export function AssignRekoDialog({
  open,
  onOpenChange,
  incidentId,
  incidentTitle,
  onAssigned,
}: AssignRekoDialogProps) {
  const t = useTranslations('incidents.assignReko')
  const tCommon = useTranslations('incidents.common')
  const tPick = useTranslations('common.personPick')
  const { selectedEvent } = useEvent()
  const { personnel: allPersonnel, operations, refreshOperations, formatLocation } = useOperations()
  const [personnel, setPersonnel] = useState<ApiAvailableRekoPersonnel[]>([])
  const [currentlyAssignedId, setCurrentlyAssignedId] = useState<string | null>(null)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [pickMessage, setPickMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [markMode, setMarkMode] = useState(false)
  const [uncertainPersonnelIds, setUncertainPersonnelIds] = useState<ReadonlySet<string>>(new Set())
  const mark = useRekoCandidatePicker({ personnel: allPersonnel, operations, excludedPersonnelIds: uncertainPersonnelIds, disabled: busy })
  const resetMark = mark.reset

  // Backend sorts by (open work, distance, name). Mark the top candidate as
  // "Empfohlen" only when it is measurably better than the runner-up — a
  // recommendation between indistinguishable options would be arbitrary.
  const recommendedId = useMemo(() => {
    const candidates = personnel.filter((p) => p.personnel_id !== currentlyAssignedId)
    if (candidates.length < 2) return null
    const [first, second] = candidates
    const lessOpenWork = first.open_count < second.open_count
    const closer =
      first.open_count === second.open_count &&
      first.distance_m !== null &&
      (second.distance_m === null || first.distance_m < second.distance_m)
    return lessOpenWork || closer ? first.personnel_id : null
  }, [personnel, currentlyAssignedId])

  const loadAvailablePersonnel = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiClient.getAvailableRekoPersonnel(incidentId)
      setPersonnel(response.personnel)
      setCurrentlyAssignedId(response.currently_assigned_id)
      setChosenId(response.currently_assigned_id)
    } catch (err) {
      console.error('Failed to load Reko personnel:', err)
      setError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [incidentId, t])

  // Load available Reko personnel when dialog opens
  useEffect(() => {
    if (open) {
      loadAvailablePersonnel()
      setMarkMode(false)
      setPickMessage(null)
      resetMark()
    }
  }, [open, loadAvailablePersonnel, resetMark])

  // See `onAssigned`: the caller owns the close. The fallback is for a caller
  // that passes no handler at all — a dialog that stays open after a successful
  // assignment would be the worse failure.
  const finishAssigned = useCallback(() => {
    if (onAssigned) onAssigned()
    else onOpenChange(false)
  }, [onAssigned, onOpenChange])

  const handleMarkAndAssign = async (person: Person) => {
    if (!selectedEvent) return
    let roleAssigned = false
    try {
      await apiClient.assignSpecialFunction(selectedEvent.id, {
        personnel_id: person.id,
        function_type: 'reko',
        vehicle_id: null,
      })
      roleAssigned = true
      await apiClient.assignRekoPersonnel(incidentId, person.id)
      finishAssigned()
    } catch (err) {
      console.error('Failed to mark/assign Reko personnel:', err)
      if (roleAssigned) {
        try {
          await apiClient.unassignSpecialFunction(selectedEvent.id, {
            personnel_id: person.id,
            function_type: 'reko',
            vehicle_id: null,
          })
        } catch (rollbackError) {
          console.error('Failed to roll back Reko role assignment:', rollbackError)
          setUncertainPersonnelIds((current) => new Set(current).add(person.id))
          try {
            await refreshOperations()
          } catch (refreshError) {
            console.error('Failed to refresh Reko assignments:', refreshError)
          }
        }
      }
      toast.error(t('assignErrorTitle'), { description: t('markError') })
    }
  }

  const handleAssign = async (personnelId: string) => {
    try {
      await apiClient.assignRekoPersonnel(incidentId, personnelId)
      finishAssigned()
    } catch (err) {
      console.error('Failed to assign Reko personnel:', err)
      toast.error(t('assignErrorTitle'), { description: t('assignErrorDescription') })
    }
  }

  /** «Übernehmen»: mark + assign the ticked candidate, keep the current Reko, or assign
   *  the ticked one. Nothing ticked is said above the list, never a greyed-out button. */
  const applyChoice = async () => {
    const candidate = mark.chosen
    if (markMode ? !candidate : !chosenId) {
      setPickMessage(tPick('noneChosen'))
      return
    }
    setBusy(true)
    try {
      if (markMode && candidate) await handleMarkAndAssign(candidate)
      else if (chosenId === currentlyAssignedId) finishAssigned()
      else if (chosenId) await handleAssign(chosenId)
    } finally {
      setBusy(false)
    }
  }

  const choose = (personnelId: string) => {
    setChosenId((current) => (current === personnelId ? null : personnelId))
    setPickMessage(null)
  }

  const switchMode = (next: boolean) => {
    setMarkMode(next)
    setPickMessage(null)
  }

  const toolbar = markMode ? (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => switchMode(false)}>
        <ArrowLeft className="size-3.5" />
        {t('back')}
      </Button>
      {mark.searchField}
      <FormMessage id={REKO_PICK_MESSAGE_ID}>{pickMessage}</FormMessage>
    </>
  ) : !loading && !error && personnel.length > 0 ? (
    // Here, not only in the empty state: with exactly one Reko person on the Ereignis the
    // list is never empty, so the only way to put a second one on the board was to close
    // this dialog and right-click somebody in the sidebar.
    <>
      <MarkRekoRow onClick={() => switchMode(true)} />
      <FormMessage id={REKO_PICK_MESSAGE_ID}>{pickMessage}</FormMessage>
    </>
  ) : undefined

  const renderTile = (person: ApiAvailableRekoPersonnel) => {
    const isCurrent = person.personnel_id === currentlyAssignedId
    const openLabels = (person.open_assignments ?? []).map(
      (assignment) => formatLocation(assignment.location_address ?? '') || assignment.incident_title,
    )
    // The plan lives on the board's roster row, not on the Reko list's.
    const boardPerson = allPersonnel.find((p) => p.id === person.personnel_id)
    return (
      <PersonPickTile
        key={person.personnel_id}
        name={person.name}
        personnelId={person.personnel_id}
        rank={person.role}
        plan={boardPerson ? tilePlan(boardPerson, Date.now(), tPick) : null}
        // Its open Rekos are where the person is besides here – the where-note.
        where={openLabels.length > 0 && !isCurrent ? {
          head: openLabels.length > 1 ? `${openLabels[0]} +${openLabels.length - 1}` : openLabels[0],
          full: openLabels.join(', '),
          Icon: MapPin,
        } : null}
        single
        checked={chosenId === person.personnel_id}
        current={isCurrent}
        disabled={busy}
        onClick={() => choose(person.personnel_id)}
        badge={person.personnel_id === recommendedId && (
          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-2xs">{t('recommended')}</Badge>
        )}
        aside={!isCurrent && (
          <>
            {/* Open Rekos are a fact, not a warning: muted beside the green «frei» (VISUAL-03). */}
            {person.open_count > 0 ? (
              <span className="whitespace-nowrap font-medium text-muted-foreground">
                {t('openCount', { count: person.open_count })}
                {person.done_count > 0 && ` · ${t('doneCount', { count: person.done_count })}`}
              </span>
            ) : (
              <Badge variant="outline" className={cn('text-xs', RESOURCE_STATE_BADGE_CLASSES.available)}>
                {t('noOpenWork')}
              </Badge>
            )}
            {person.distance_m !== null && (
              <span
                className="whitespace-nowrap text-2xs text-muted-foreground"
                title={person.distance_source === 'last' ? t('distanceLastTooltip') : t('distanceOpenTooltip')}
              >
                ≈ {formatDistance(person.distance_m)}
                {person.distance_source === 'last' && ` ${t('distanceLastSuffix')}`}
              </span>
            )}
          </>
        )}
      />
    )
  }

  return (
    <PickerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={markMode ? t('markExisting') : t('title')}
      description={t('incidentLabel', { title: incidentTitle })}
      radioGroupLabel={markMode ? t('markExisting') : t('title')}
      toolbar={toolbar}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={() => void applyChoice()} disabled={busy}>
            {busy && <ShellLoader className="size-4" />}
            {tPick('apply')}
          </Button>
        </>
      }
    >
      {markMode ? (
        mark.list
      ) : loading ? (
        <div className="flex h-full min-h-40 items-center justify-center">
          <LoadingStatus size="surface" className="text-sm">{t('loading')}</LoadingStatus>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-10">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" onClick={loadAvailablePersonnel} className="mt-4">
            {t('retry')}
          </Button>
        </div>
      ) : personnel.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyHint')}
          action={{ label: t('markExisting'), icon: Binoculars, onClick: () => switchMode(true) }}
        />
      ) : (
        personnel.map(renderTile)
      )}
    </PickerDialog>
  )
}
