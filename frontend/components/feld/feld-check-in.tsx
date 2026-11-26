'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Clock } from 'lucide-react'

import { PlannedTimePicker } from '@/components/attendance/planned-time'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { ApiError } from '@/lib/api/types/common'
import { formatTime } from '@/lib/format-time'

/**
 * «Noch nicht da»: the individual half of the roll call (decision 10) at the top of the /feld
 * list – «Ich bin da» and «Ich komme um …». `visible` while the person is not checked in; the
 * page keeps it mounted either way, so a check-in still out stays «busy» across a hide and show.
 * What it writes is folded back into the page's list (`onCheckedIn`, `onPlannedFrom`).
 */
export function FeldCheckIn({
  visible,
  personnelId,
  token,
  planFrom,
  planUntil,
  onCheckedIn,
  onPlannedFrom,
}: {
  visible: boolean
  personnelId: string | undefined
  token: string | null
  planFrom: string | null
  planUntil: string | null
  onCheckedIn: () => void
  onPlannedFrom: (iso: string | null) => void
}) {
  const t = useTranslations('feld')
  const tPlan = useTranslations('common.attendancePlan')
  const [attendanceBusy, setAttendanceBusy] = useState(false)

  /** Say you are here. Only ever true: checking out from a phone in a vehicle would edit the
   *  roll call the KP is keeping. */
  const toggleAttendance = useCallback(async () => {
    if (!token || !personnelId || attendanceBusy) return
    setAttendanceBusy(true)
    const next = true
    try {
      await apiClient.setFeldAttendance(personnelId, token, next)
      onCheckedIn()
    } catch (err) {
      // A refusal («als nicht verfügbar gemeldet») is a 409, which skips the transport's toast.
      if (ApiError.isConflictError(err)) toast.error(err.message)
      else console.error('Attendance toggle failed:', err)
    } finally {
      setAttendanceBusy(false)
    }
  }, [token, personnelId, attendanceBusy, onCheckedIn])

  /** Writes «Ich komme um»; rejects, so the picker says it failed. */
  const saveFrom = useCallback(async (iso: string | null) => {
    if (!token || !personnelId) return
    await apiClient.setFeldAttendancePlan(personnelId, token, { planned_from: iso })
    onPlannedFrom(iso)
  }, [token, personnelId, onPlannedFrom])

  /** «Ich komme um …»: one quiet button, the bottom sheet behind it. No «Ich bin da bis …» here
   *  (owner, 20.11.2026): somebody on /feld usually stays to the end, and the button only made
   *  them wonder whether they must answer it. The KP still sets «bis» in the Appell. */
  const fromTime = formatTime(planFrom)
  const fromButton = (
    <PlannedTimePicker
      kind="from"
      value={planFrom}
      other={planUntil}
      title={tPlan('selfFrom')}
      hint={tPlan('hintSelf')}
      fieldLabel={tPlan('selfFrom')}
      onSave={saveFrom}
      trigger={
        <Button type="button" variant="outline" className="w-full">
          <Clock className="size-4" />
          {fromTime ? tPlan('selfFromSet', { time: fromTime }) : `${tPlan('selfFrom')} …`}
        </Button>
      }
    />
  )

  if (!visible) return null
  return (
    <section className="rounded-xl bg-secondary/60 p-4">
      <p className="mb-3 text-base font-semibold">{t('attendance.notHereTitle')}</p>
      <Button size="lg" className="w-full" onClick={toggleAttendance} disabled={attendanceBusy}>
        {t('attendance.checkIn')}
      </Button>
      <div className="mt-2">{fromButton}</div>
    </section>
  )
}
