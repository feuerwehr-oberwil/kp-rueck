"use client"

import { EmptyState, SearchEmptyState } from "@/components/ui/empty-state"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { PickerDialog } from "@/components/ui/picker-dialog"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FormMessage } from "@/components/ui/form-message"
import { useIsMobile } from "@/components/ui/use-mobile"
import { Binoculars, ArrowLeft, ArrowRight, MapPin } from "lucide-react"
import { ListSection, PersonPickTile } from "@/components/kanban/assignment-list-section"
import { einsatzWhere, usePersonTileFacts } from "@/components/kanban/person-tile-facts"
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
 *
 * A host that shows these people as ONE section of a longer list (the status gate's «Andere
 * Anwesende») takes `tiles` (no empty messages), filters its own rows by `query`, and keeps a
 * single choice across both: `onChoose` fires when a tile here is ticked, `clearChoice()` unticks.
 */
export function useRekoCandidatePicker({
  personnel,
  operations,
  excludedPersonnelIds,
  disabled,
  onChoose,
}: {
  personnel: Person[]
  /** The board's Einsätze – where a candidate is now. */
  operations: readonly Operation[]
  excludedPersonnelIds?: ReadonlySet<string>
  disabled?: boolean
  onChoose?: () => void
}): {
  chosen: Person | null
  searchField: ReactNode
  list: ReactNode
  tiles: ReactNode[]
  query: string
  clearSearch: () => void
  clearChoice: () => void
  reset: () => void
} {
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
  const tiles = candidates.map((person) => {
    const { where, roles } = factsOf(person, { elsewhere: einsatzWhere(person.id, operations) })
    return (
      <PersonPickTile
        key={person.id}
        name={person.name}
        personnelId={person.id}
        kennung={person.kennung ?? null}
        rank={person.role}
        where={where}
        roles={roles}
        single
        checked={chosenId === person.id}
        disabled={disabled}
        onClick={() => {
          setChosenId((current) => (current === person.id ? null : person.id))
          onChoose?.()
        }}
      />
    )
  })
  const list =
    candidates.length === 0 && search.trim() ? (
      <SearchEmptyState query={search} onClear={() => setSearch("")} />
    ) : candidates.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        {personnel.length === 0 ? t("markNoCheckedIn") : t("markAllReko")}
      </p>
    ) : (
      tiles
    )

  // Stable, so a host may reset from an effect.
  const reset = useCallback(() => {
    setSearch("")
    setChosenId(null)
  }, [])

  const clearSearch = useCallback(() => setSearch(""), [])
  const clearChoice = useCallback(() => setChosenId(null), [])

  return {
    chosen: eligible.find((person) => person.id === chosenId) ?? null,
    searchField,
    list,
    tiles,
    query: search,
    clearSearch,
    clearChoice,
    reset,
  }
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
  /**
   * The status gate's frame (#4 A, 19.11.2026): the card was moved into «Reko» without a Reko
   * person and the picker opens in place of a question. Its own title and line, one search, a
   * quiet dashed «Ohne Reko-Person verschieben» row (`onWithout` – the caller closes), then
   * «Reko-Personen» and «Andere Anwesende» as one radio list – picking somebody from the second
   * marks them Reko for the Ereignis and assigns them in the same «Zuweisen» (`confirmLabel`).
   * Closing (Abbrechen, Esc, ✕) stays `onOpenChange(false)`.
   */
  gate?: {
    title: string
    description: string
    confirmLabel: string
    withoutLabel: string
    onWithout: () => void
  }
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
  gate,
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
  const mark = useRekoCandidatePicker({
    personnel: allPersonnel,
    operations,
    excludedPersonnelIds: uncertainPersonnelIds,
    disabled: busy,
    // The gate's one choice spans both sections: ticking somebody under «Andere Anwesende»
    // unticks the Reko person.
    onChoose: () => {
      setChosenId(null)
      setPickMessage(null)
    },
  })
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
   *  the ticked one. In the gate a candidate under «Andere Anwesende» is marked + assigned in
   *  the same click. Nothing ticked is said above the list, never a greyed-out button. */
  const applyChoice = async () => {
    const candidate = (markMode || gate) ? mark.chosen : null
    if (markMode ? !candidate : !candidate && !chosenId) {
      setPickMessage(tPick('noneChosen'))
      return
    }
    setBusy(true)
    try {
      if (candidate) await handleMarkAndAssign(candidate)
      else if (chosenId === currentlyAssignedId) finishAssigned()
      else if (chosenId) await handleAssign(chosenId)
    } finally {
      setBusy(false)
    }
  }

  const choose = (personnelId: string) => {
    setChosenId((current) => (current === personnelId ? null : personnelId))
    mark.clearChoice()
    setPickMessage(null)
  }

  const switchMode = (next: boolean) => {
    setMarkMode(next)
    setPickMessage(null)
  }

  // The gate's way on without anybody – quiet, at the top, never the main answer.
  const withoutRow = gate && !markMode && (
    <button
      type="button"
      onClick={gate.onWithout}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-sel-edge hover:text-foreground"
    >
      <Binoculars className="h-4 w-4" />
      <span className="min-w-0 flex-1 text-left">{gate.withoutLabel}</span>
      <ArrowRight className="h-4 w-4" />
    </button>
  )

  // The gate shows both lists at once (mock 1a A): the Ereignis' Reko people, then the other
  // checked-in people, one search over both – so no «Person als Reko markieren» detour.
  const gateQuery = mark.query.trim()
  const rekoHits = gate && gateQuery
    ? personnel.filter((person) => personMatchesQuery({ name: person.name, role: person.role, isReko: true }, gateQuery))
    : personnel

  const toolbar = gate && !markMode ? (
    <>
      {!loading && !error && mark.searchField}
      {withoutRow}
      <FormMessage id={REKO_PICK_MESSAGE_ID}>{pickMessage}</FormMessage>
    </>
  ) : markMode ? (
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
      {withoutRow}
      <MarkRekoRow onClick={() => switchMode(true)} />
      <FormMessage id={REKO_PICK_MESSAGE_ID}>{pickMessage}</FormMessage>
    </>
  ) : withoutRow || undefined

  const renderTile = (person: ApiAvailableRekoPersonnel) => {
    const isCurrent = person.personnel_id === currentlyAssignedId
    const openLabels = (person.open_assignments ?? []).map(
      (assignment) => formatLocation(assignment.location_address ?? '') || assignment.incident_title,
    )
    return (
      <PersonPickTile
        key={person.personnel_id}
        name={person.name}
        personnelId={person.personnel_id}
        rank={person.role}
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
      title={markMode ? t('markExisting') : gate?.title ?? t('title')}
      description={gate?.description ?? t('incidentLabel', { title: incidentTitle })}
      radioGroupLabel={markMode ? t('markExisting') : t('title')}
      toolbar={toolbar}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={() => void applyChoice()} disabled={busy}>
            {busy && <ShellLoader className="size-4" />}
            {gate?.confirmLabel ?? tPick('apply')}
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
      ) : gate ? (
        rekoHits.length === 0 && mark.tiles.length === 0 ? (
          gateQuery ? (
            <SearchEmptyState query={mark.query} onClear={mark.clearSearch} />
          ) : (
            <EmptyState title={t('emptyTitle')} description={t('markNoCheckedIn')} />
          )
        ) : (
          <div className="space-y-4">
            {rekoHits.length > 0 && (
              <ListSection label={t('sectionReko')} tone="free">
                <div className="space-y-2">{rekoHits.map(renderTile)}</div>
              </ListSection>
            )}
            {mark.tiles.length > 0 && (
              <ListSection label={t('sectionOthers')} tone="free">
                <div className="space-y-2">{mark.tiles}</div>
              </ListSection>
            )}
          </div>
        )
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
