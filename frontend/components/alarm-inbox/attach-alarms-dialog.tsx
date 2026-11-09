'use client'

/**
 * «An Ereignis anhängen» – the one way an alarm from the Alarmeingang goes onto a board.
 *
 * Opened by the sheet's «Anhängen» (one alarm) and «Alle anhängen» (every new one); `alarms` is
 * what was pressed for, `null` = closed. The Ereignis defaults to the one this window shows, as
 * long as it may take these alarms. What it asks before the click:
 * - a training alarm only goes to a training Ereignis (the backend enforces it too);
 * - a REAL alarm into a training Ereignis is allowed – a genuine alarm during a drill may have
 *   to be carried on the same board – but the consequences are named first;
 * - ONE alarm gets the «Möglicherweise dasselbe wie …» hint against the chosen Ereignis
 *   (R2) – advice only: the server flags the card anyway when it is not merged, as it does for
 *   a bulk attach, which is not asked per alarm.
 * While a write runs it stays open (no Esc, outside click or swipe) and offers nothing else.
 * Desktop: a centred dialog; phone: a bottom sheet (CLAUDE.md «Phone geometry»).
 */

import { useEffect, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { apiClient, ApiError, type ApiDiveraEmergency, type ApiDuplicateCandidate, type ApiEvent } from '@/lib/api-client'
import { useEvent } from '@/lib/contexts/event-context'
import { useDuplicateCandidates } from '@/lib/hooks/use-duplicate-candidates'
import { DuplicateHint } from '@/components/duplicates/duplicate-hint'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ShellLoader } from '@/components/ui/shell-loader'
import { useIsMobile } from '@/components/ui/use-mobile'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface AttachAlarmsDialogProps {
  alarms: readonly ApiDiveraEmergency[] | null
  onClose: () => void
  /** After a write that went through (the pool is reloaded by the caller). */
  onAttached: () => void
}

export function AttachAlarmsDialog({ alarms, onClose, onAttached }: AttachAlarmsDialogProps) {
  const t = useTranslations('divera.pool')
  const tDuplicates = useTranslations('duplicates')
  const { selectedEvent: currentEvent } = useEvent()
  const isMobile = useIsMobile()
  const labelId = useId()
  const triggerId = useId()
  const valueId = useId()
  const [activeEvents, setActiveEvents] = useState<ApiEvent[]>([])
  const [eventsLoaded, setEventsLoaded] = useState(false)
  // null = the default below; set once the operator picks one
  const [chosenEventId, setChosenEventId] = useState<string | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [mergingId, setMergingId] = useState<string | null>(null)
  const [dismissedDuplicateKey, setDismissedDuplicateKey] = useState<string | null>(null)

  const open = alarms !== null && alarms.length > 0
  const selected = alarms ?? []

  useEffect(() => {
    if (!open) return
    let live = true
    apiClient
      .getEvents(false)
      .then((data) => {
        if (!live) return
        setActiveEvents(data.events)
        setEventsLoaded(true)
      })
      .catch((error) => console.error('Failed to load events for the attach dialog:', error))
    return () => {
      live = false
    }
  }, [open])

  const hasTrainingSelection = selected.some((e) => e.is_training)
  const attachableEvents = hasTrainingSelection ? activeEvents.filter((e) => e.training_flag) : activeEvents
  // The current Ereignis, but only while it is in the list the dropdown can show – a stale or
  // unattachable id would otherwise be submitted invisibly.
  const defaultEventId =
    currentEvent?.id && attachableEvents.some((e) => e.id === currentEvent.id) ? currentEvent.id : ''
  const selectedEventId =
    chosenEventId !== null && attachableEvents.some((e) => e.id === chosenEventId) ? chosenEventId : defaultEventId
  const selectedAttachEvent = attachableEvents.find((e) => e.id === selectedEventId)

  const realAlarmCount = selected.filter((e) => !e.is_training).length
  const realAlarmIntoTraining = !!selectedAttachEvent?.training_flag && realAlarmCount > 0

  const single = selected.length === 1 ? selected[0] : null
  const singleLat = single?.latitude ? Number(single.latitude) : null
  const singleLng = single?.longitude ? Number(single.longitude) : null
  const duplicateLookup =
    open && single && selectedEventId
      ? { eventId: selectedEventId, lat: singleLat, lng: singleLng, address: single.address }
      : null
  const { candidates: duplicateCandidates, key: duplicateKey } = useDuplicateCandidates(duplicateLookup, (q) =>
    apiClient.getDuplicateCandidates({ eventId: q.eventId!, lat: q.lat, lng: q.lng, address: q.address }),
  )
  const shownDuplicates =
    duplicateKey !== null && duplicateKey !== dismissedDuplicateKey ? duplicateCandidates : []

  // An attach or a merge is on its way: neither may start a second, and the dialog stays open
  // so its answer (toast, close) cannot land on the next one.
  const busy = attaching || mergingId !== null

  const close = () => {
    setChosenEventId(null)
    // the next alarm, even at the same address, gets its own hint
    setDismissedDuplicateKey(null)
    onClose()
  }

  const done = () => {
    close()
    onAttached()
  }

  const handleMergeAttach = async (candidate: ApiDuplicateCandidate) => {
    if (!single || !selectedEventId || busy) return
    setMergingId(candidate.id)
    try {
      await apiClient.attachEmergencyToEvent(single.id, selectedEventId, candidate.id)
      toast.success(t('attachedSuccess'), {
        description: tDuplicates('mergedTitle', { label: candidate.location_display || candidate.title }),
      })
      done()
    } catch (error) {
      console.error('Failed to merge emergency:', error)
      // Other HTTP failures were already toasted by the transport; a refusal (409) carries the
      // server's sentence.
      if (!(error instanceof ApiError) || ApiError.isConflictError(error)) {
        toast.error(tDuplicates('mergeFailed'), {
          description: error instanceof ApiError ? error.message : undefined,
        })
      }
    } finally {
      setMergingId(null)
    }
  }

  const handleAttach = async () => {
    if (!selectedEventId || busy) return
    setAttaching(true)
    try {
      const ids = selected.map((e) => e.id)
      if (ids.length === 1) {
        await apiClient.attachEmergencyToEvent(ids[0], selectedEventId)
        toast.success(t('attachedSuccess'), { description: t('attachedOne') })
      } else {
        const { created, errors } = await apiClient.bulkAttachEmergencies(ids, selectedEventId)
        if (errors.length > 0) {
          // Partial success – say exactly how many actually went on.
          toast.error(t('partiallyAttached'), {
            description: t('partiallyAttachedDescription', {
              created: created.length,
              total: ids.length,
              failed: errors.length,
            }),
          })
        } else {
          toast.success(t('attachedSuccess'), { description: t('attachedMany', { count: created.length }) })
        }
      }
      done()
    } catch (error) {
      console.error('Failed to attach emergencies:', error)
      toast.error(t('errorTitle'), { description: t('attachError') })
    } finally {
      setAttaching(false)
    }
  }

  const eventLabel = (event: ApiEvent) => (event.training_flag ? t('eventTraining', { name: event.name }) : event.name)
  const noEvents = eventsLoaded && attachableEvents.length === 0

  const fields = (
    <>
      <Label id={labelId} htmlFor={triggerId} className="mb-1.5">
        {t('eventLabel')}
      </Label>
      <Select value={selectedEventId} onValueChange={setChosenEventId} disabled={busy}>
        {/* named «Ereignis» + the chosen one, not the chosen one alone (a combobox takes no
            name from its own content, so the value's span is referenced) */}
        <SelectTrigger id={triggerId} aria-labelledby={`${labelId} ${valueId}`} className="w-full">
          {/* The label from our own state – Radix derives SelectValue's text from the lazily
              mounted items, so a preset value would otherwise show the placeholder. */}
          <SelectValue id={valueId} placeholder={t('selectEventPlaceholder')}>
            {selectedAttachEvent ? eventLabel(selectedAttachEvent) : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {attachableEvents.map((event) => (
            <SelectItem key={event.id} value={event.id}>
              {eventLabel(event)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {noEvents ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('noAttachableEvents', { training: String(hasTrainingSelection) })}
        </p>
      ) : (
        hasTrainingSelection && <p className="mt-2 text-xs text-muted-foreground">{t('trainingOnlyHint')}</p>
      )}
      <DuplicateHint
        candidates={shownDuplicates}
        origin={singleLat !== null && singleLng !== null ? { lat: singleLat, lng: singleLng } : null}
        onMerge={handleMergeAttach}
        onDismiss={() => setDismissedDuplicateKey(duplicateKey)}
        mergingId={mergingId}
        busy={attaching}
        showSketch={!isMobile}
        density={isMobile ? 'touch' : 'dense'}
        className="mt-3"
      />
      {realAlarmIntoTraining && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-warning-foreground">
            <AlertTriangle className="size-4 shrink-0" />
            {t('realAlarmWarningTitle', { count: realAlarmCount })}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {(['realAlarmWarningAlerting', 'realAlarmWarningThresholds'] as const).map((key) => (
              <li key={key}>
                {t.rich(key, {
                  hint: (chunks) => <span className="text-muted-foreground">{chunks}</span>,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )

  const buttons = (
    <>
      <Button variant="outline" onClick={close} disabled={busy}>
        {t('cancel')}
      </Button>
      <Button
        onClick={handleAttach}
        disabled={!selectedEventId || busy}
        variant={realAlarmIntoTraining ? 'destructive' : 'default'}
      >
        {attaching && <ShellLoader className="size-4" />}
        {realAlarmIntoTraining ? t('attachAnyway') : t('attach')}
      </Button>
    </>
  )

  const onOpenChange = (next: boolean) => {
    if (!next && !busy) close()
  }

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* as tall as its content, up to the tall step; the body scrolls, the footer stays */}
        <SheetContent
          side="bottom"
          className="modal-h-tall gap-0 rounded-t-2xl [&>[data-slot=sheet-close]]:top-[29px] [&>[data-slot=sheet-close]]:-translate-y-1/2"
        >
          <SheetHeader className="px-4 pt-5 pb-3 pr-12">
            <SheetTitle className="text-lg leading-none">{t('attachDialogTitle')}</SheetTitle>
            <SheetDescription>{t('attachDialogDescription', { count: selected.length })}</SheetDescription>
          </SheetHeader>
          <SheetBody className="px-4 pb-4">{fields}</SheetBody>
          <SheetFooter className="mt-0 flex-row gap-2 border-t px-4 pt-3 pb-sheet-safe [&>*]:min-h-11 [&>*]:flex-1">
            {buttons}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider while the duplicate hint is up: its sketch needs the room. */}
      <DialogContent className={shownDuplicates.length > 0 ? 'sm:max-w-xl' : 'sm:max-w-md'}>
        <DialogHeader>
          <DialogTitle>{t('attachDialogTitle')}</DialogTitle>
          <DialogDescription>{t('attachDialogDescription', { count: selected.length })}</DialogDescription>
        </DialogHeader>
        <div className="py-4">{fields}</div>
        <DialogFooter className="gap-2 sm:gap-0">{buttons}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
