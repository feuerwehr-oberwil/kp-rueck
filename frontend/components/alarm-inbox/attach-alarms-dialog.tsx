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
 *   (R2); a bulk attach is not asked per alarm, the server flags those cards instead.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { apiClient, ApiError, type ApiDiveraEmergency, type ApiDuplicateCandidate, type ApiEvent } from '@/lib/api-client'
import { useEvent } from '@/lib/contexts/event-context'
import { useDuplicateCandidates } from '@/lib/hooks/use-duplicate-candidates'
import { DuplicateHint } from '@/components/duplicates/duplicate-hint'
import { Button } from '@/components/ui/button'
import { ShellLoader } from '@/components/ui/shell-loader'
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
  const [activeEvents, setActiveEvents] = useState<ApiEvent[]>([])
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
      .then((data) => live && setActiveEvents(data.events))
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

  const close = () => {
    setChosenEventId(null)
    onClose()
  }

  const done = () => {
    close()
    onAttached()
  }

  const handleMergeAttach = async (candidate: ApiDuplicateCandidate) => {
    if (!single || !selectedEventId) return
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
    if (!selectedEventId) return
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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {/* Wider while the duplicate hint is up: its sketch needs the room. */}
      <DialogContent className={shownDuplicates.length > 0 ? 'sm:max-w-xl' : 'sm:max-w-md'}>
        <DialogHeader>
          <DialogTitle>{t('attachDialogTitle')}</DialogTitle>
          <DialogDescription>{t('attachDialogDescription', { count: selected.length })}</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Select value={selectedEventId} onValueChange={setChosenEventId}>
            <SelectTrigger>
              {/* The label from our own state – Radix derives SelectValue's text from the lazily
                  mounted items, so a preset value would otherwise show the placeholder. */}
              <SelectValue placeholder={t('selectEventPlaceholder')}>
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
          {hasTrainingSelection && <p className="mt-2 text-xs text-muted-foreground">{t('trainingOnlyHint')}</p>}
          <DuplicateHint
            candidates={shownDuplicates}
            origin={singleLat !== null && singleLng !== null ? { lat: singleLat, lng: singleLng } : null}
            onMerge={handleMergeAttach}
            onDismiss={() => setDismissedDuplicateKey(duplicateKey)}
            mergingId={mergingId}
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
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={close} disabled={attaching}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleAttach}
            disabled={!selectedEventId || attaching}
            variant={realAlarmIntoTraining ? 'destructive' : 'default'}
          >
            {attaching && <ShellLoader className="size-4" />}
            {realAlarmIntoTraining ? t('attachAnyway') : t('attach')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
