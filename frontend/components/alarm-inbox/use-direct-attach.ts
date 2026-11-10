'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { apiClient, ApiError, type ApiDiveraEmergency } from '@/lib/api-client'
import { useEvent } from '@/lib/contexts/event-context'

/**
 * «Anhängen» without a dialog (owner pick UX-02 A, 10.11.2026): a new alarm goes straight
 * onto the Ereignis this window shows, and the toast offers «Rückgängig».
 *
 * The dialog (`openDialog`) still asks wherever there is something to decide:
 * - no open Ereignis in this window, or the alarm is already on one (a re-attach);
 * - a real alarm into a training Ereignis, or a training alarm into a real one;
 * - the alarm may be the same Schadenplatz as an open card – or that could not be checked.
 *
 * «Rückgängig» is a write of its own (`detach`): the server takes the alarm back only while
 * the card it made is untouched, and says so otherwise. `busyId` is the alarm on its way.
 */
export function useDirectAttach({
  openDialog,
  onChanged,
}: {
  openDialog: (alarms: readonly ApiDiveraEmergency[]) => void
  /** The pool changed – reload it. */
  onChanged: () => void
}) {
  const t = useTranslations('divera.pool')
  const tUndo = useTranslations('notifications.operations')
  const { selectedEvent } = useEvent()
  const [busyId, setBusyId] = useState<string | null>(null)

  const undo = useCallback(
    async (alarmId: string, incidentId: string) => {
      try {
        await apiClient.detachEmergency(alarmId, incidentId)
        toast(t('detached'))
      } catch (error) {
        // A refusal carries the server's sentence («inzwischen bearbeitet»).
        toast.error(t('detachRefused'), {
          description: error instanceof ApiError && ApiError.isConflictError(error) ? error.message : t('detachRefusedFallback'),
        })
      }
      onChanged()
    },
    [t, onChanged],
  )

  const attach = useCallback(
    async (alarm: ApiDiveraEmergency) => {
      const event = selectedEvent
      const plain =
        !!event && !event.archived_at && !alarm.attached_to_event_id && !!alarm.is_training === event.training_flag
      if (!plain || busyId) {
        if (!busyId) openDialog([alarm])
        return
      }
      setBusyId(alarm.id)
      try {
        const { candidates } = await apiClient.getDuplicateCandidates({
          eventId: event.id,
          lat: alarm.latitude ? Number(alarm.latitude) : null,
          lng: alarm.longitude ? Number(alarm.longitude) : null,
          address: alarm.address,
        })
        if (candidates.length > 0) {
          openDialog([alarm])
          return
        }
      } catch {
        // Could not ask: let the dialog ask, it shows what it finds.
        openDialog([alarm])
        return
      } finally {
        setBusyId(null)
      }

      setBusyId(alarm.id)
      try {
        const incident = await apiClient.attachEmergencyToEvent(alarm.id, event.id)
        toast.success(t('attachedTo', { event: event.name }), {
          description: incident.number != null ? t('attachedToNumber', { number: incident.number }) : undefined,
          action: { label: tUndo('undoLabel'), onClick: () => void undo(alarm.id, incident.id) },
        })
        onChanged()
      } catch (error) {
        console.error('Failed to attach emergency:', error)
        toast.error(t('errorTitle'), { description: t('attachError') })
      } finally {
        setBusyId(null)
      }
    },
    [selectedEvent, busyId, openDialog, onChanged, t, tUndo, undo],
  )

  return { attach, busyId }
}
