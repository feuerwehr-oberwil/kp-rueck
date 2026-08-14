"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, User, Loader2, Binoculars, ArrowLeft, MapPin } from "lucide-react"
import { apiClient, type ApiAvailableRekoPersonnel } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

interface MarkExistingRekoPersonnelProps {
  personnel: Person[]
  onSelect: (person: Person) => Promise<void>
  excludedPersonnelIds?: ReadonlySet<string>
  /** Overrides the dialog-sized fixed height (e.g. `flex-1 min-h-0` when the
   *  list fills a flex column like the map's Reko-Modus panel). */
  className?: string
}

export function MarkExistingRekoPersonnel({
  personnel,
  onSelect,
  excludedPersonnelIds,
  className,
}: MarkExistingRekoPersonnelProps) {
  const t = useTranslations('incidents.assignReko')
  const [search, setSearch] = useState("")
  const [marking, setMarking] = useState<string | null>(null)
  const candidates = personnel
    .filter((person) => !person.isReko)
    .filter((person) => !excludedPersonnelIds?.has(person.id))
    .filter((person) => !search.trim() || person.name.toLowerCase().includes(search.trim().toLowerCase()))

  const handleSelect = async (person: Person) => {
    setMarking(person.id)
    try {
      await onSelect(person)
    } finally {
      setMarking(null)
    }
  }

  return (
    <div className={cn("flex flex-col", className ?? "h-[300px]")}>
      <SearchInput
        autoFocus
        containerClassName="mb-3"
        value={search}
        onValueChange={setSearch}
        placeholder={t('markSearchPlaceholder')}
      />
      {candidates.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {search.trim()
            ? t('markNoMatch')
            : personnel.length === 0
              ? t('markNoCheckedIn')
              : t('markAllReko')}
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0 pr-2">
          <div className="space-y-2">
            {candidates.map((person) => (
              <button
                key={person.id}
                onClick={() => handleSelect(person)}
                disabled={marking !== null}
                className={cn(
                  "w-full flex items-center justify-between p-3 rounded-lg border border-border transition-all text-left hover:border-primary/50 hover:bg-secondary/30",
                  marking === person.id && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{person.name}</p>
                    {person.role && (
                      <p className="text-xs text-muted-foreground">{person.role}</p>
                    )}
                  </div>
                </div>
                {marking === person.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Binoculars className="h-4 w-4 text-muted-foreground" />}
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
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
   * React batches both calls, so `cancelRekoAssignment` still saw the old
   * operation id and undid the very move the assignment had just justified —
   * the card jumped back to «Eingegangen» right after a successful assignment.
   */
  onAssigned?: () => void
}

export function AssignRekoDialog({
  open,
  onOpenChange,
  incidentId,
  incidentTitle,
  onAssigned,
}: AssignRekoDialogProps) {
  const t = useTranslations('incidents.assignReko')
  const tCommon = useTranslations('incidents.common')
  const { selectedEvent } = useEvent()
  const { personnel: allPersonnel, refreshOperations, formatLocation } = useOperations()
  const [personnel, setPersonnel] = useState<ApiAvailableRekoPersonnel[]>([])
  const [currentlyAssignedId, setCurrentlyAssignedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [markMode, setMarkMode] = useState(false)
  const [uncertainPersonnelIds, setUncertainPersonnelIds] = useState<ReadonlySet<string>>(new Set())

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
    }
  }, [open, loadAvailablePersonnel])

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

  const handleAssign = async (person: ApiAvailableRekoPersonnel) => {
    setAssigning(person.personnel_id)
    try {
      await apiClient.assignRekoPersonnel(incidentId, person.personnel_id)
      finishAssigned()
    } catch (err) {
      console.error('Failed to assign Reko personnel:', err)
      toast.error(t('assignErrorTitle'), { description: t('assignErrorDescription') })
    } finally {
      setAssigning(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription className="truncate" title={t('incidentLabel', { title: incidentTitle })}>
            {t('incidentLabel', { title: incidentTitle })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Fixed height container to prevent layout shifts */}
          <div className="min-h-[300px]">
            {markMode ? (
                <MarkExistingRekoPersonnel
                  personnel={allPersonnel}
                  onSelect={handleMarkAndAssign}
                  excludedPersonnelIds={uncertainPersonnelIds}
                />
            ) : loading ? (
              <div className="flex items-center justify-center h-[300px]">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">{t('loading')}</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-[300px]">
                <p className="text-destructive">{error}</p>
                <Button variant="outline" onClick={loadAvailablePersonnel} className="mt-4">
                  {t('retry')}
                </Button>
              </div>
            ) : personnel.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[300px]">
                <User className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm font-medium text-foreground mb-3">
                  {t('emptyTitle')}
                </p>
                <Button onClick={() => setMarkMode(true)} className="mb-3">
                  <Binoculars className="size-4" />
                  {t('markExisting')}
                </Button>
                <p className="text-xs text-muted-foreground text-center max-w-xs">
                  {t('emptyHint')}
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-2">
                <div className="space-y-2">
                  {personnel.map((person) => {
                  const isCurrentlyAssigned = person.personnel_id === currentlyAssignedId
                  const isRecommended = person.personnel_id === recommendedId
                  const openChips = person.open_assignments ?? []
                  return (
                    <button
                      key={person.personnel_id}
                      onClick={() => handleAssign(person)}
                      disabled={assigning !== null || isCurrentlyAssigned}
                      className={cn(
                        "w-full p-3 rounded-lg border transition-all text-left",
                        isCurrentlyAssigned
                          ? "border-success bg-success/10 cursor-default"
                          : "border-border hover:border-primary/50 hover:bg-secondary/30",
                        assigning === person.personnel_id && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <User className={cn(
                            "h-5 w-5 flex-shrink-0",
                            isCurrentlyAssigned ? "text-success" :
                            person.open_count > 0 ? "text-amber-500" : "text-muted-foreground"
                          )} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm truncate">{person.name}</p>
                              {isRecommended && (
                                <Badge variant="outline" className="text-2xs px-1.5 py-0 border-primary/50 text-primary flex-shrink-0">
                                  {t('recommended')}
                                </Badge>
                              )}
                            </div>
                            {person.role && (
                              <p className="text-xs text-muted-foreground truncate">{person.role}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                          {isCurrentlyAssigned ? (
                            <Badge variant="default" className="text-xs bg-success">
                              {t('assigned')}
                            </Badge>
                          ) : (
                            <>
                              <p className="text-xs whitespace-nowrap">
                                <span className={cn(
                                  "font-medium",
                                  person.open_count > 0
                                    ? "text-amber-700 dark:text-amber-400"
                                    : "text-emerald-700 dark:text-emerald-400"
                                )}>
                                  {person.open_count > 0
                                    ? t('openCount', { count: person.open_count })
                                    : t('noOpenWork')}
                                </span>
                                {person.done_count > 0 && (
                                  <span className="text-muted-foreground">
                                    {' · '}{t('doneCount', { count: person.done_count })}
                                  </span>
                                )}
                              </p>
                              {person.distance_m !== null && (
                                <p
                                  className="text-2xs text-muted-foreground whitespace-nowrap"
                                  title={person.distance_source === 'last' ? t('distanceLastTooltip') : t('distanceOpenTooltip')}
                                >
                                  ≈ {formatDistance(person.distance_m)}
                                  {person.distance_source === 'last' && ` ${t('distanceLastSuffix')}`}
                                </p>
                              )}
                            </>
                          )}
                          {assigning === person.personnel_id && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                        </div>
                      </div>
                      {openChips.length > 0 && !isCurrentlyAssigned && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-8">
                          {openChips.slice(0, 3).map((assignment) => {
                            const chipLabel = formatLocation(assignment.location_address ?? '') || assignment.incident_title
                            return (
                            <span
                              key={assignment.incident_id}
                              className="inline-flex items-center gap-1 max-w-[180px] rounded bg-secondary/60 px-1.5 py-0.5 text-2xs text-muted-foreground"
                              title={chipLabel}
                            >
                              <MapPin className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">
                                {chipLabel}
                              </span>
                            </span>
                            )
                          })}
                          {openChips.length > 3 && (
                            <span className="text-2xs text-muted-foreground">
                              +{openChips.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
              </ScrollArea>
            )}
          </div>

          {/* Footer.
              «Person als Reko markieren» belongs here, not only in the empty
              state: with exactly one Reko person on the Ereignis the list is
              never empty, so the only way to put a second one on the board was
              to close this dialog and right-click somebody in the sidebar.
              And when the incident already HAS its Reko person, the dialog has
              to offer a way forward — every row is disabled then, and Abbrechen
              reverts the card to «Eingegangen», which is not what an operator
              means when the answer to «wer macht die Reko» is already on screen. */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {markMode ? (
              <Button variant="ghost" onClick={() => setMarkMode(false)}>
                <ArrowLeft className="size-4" />
                {t('back')}
              </Button>
            ) : personnel.length > 0 ? (
              // The empty state carries this action as its own primary button;
              // two of them on screen at once would just be noise.
              <Button variant="ghost" onClick={() => setMarkMode(true)}>
                <Binoculars className="size-4" />
                {t('markExisting')}
              </Button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon('cancel')}
              </Button>
              {!markMode && currentlyAssignedId && (
                <Button onClick={finishAssigned}>
                  {t('keepAssigned')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
