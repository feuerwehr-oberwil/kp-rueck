'use client'

import { useTranslations } from 'next-intl'
import { Binoculars, Clock, MonitorCog, Phone, Truck } from 'lucide-react'

/**
 * What an empty list means for THIS person.
 *
 * "Noch kein Einsatz" is right for a crew waiting to be sent somewhere and
 * wrong for everybody with a role: somebody on the phone desk or running the
 * board has not been told nothing, they are doing the thing this page has no
 * rows for. Telling them they have no job reads as the app not knowing what
 * they are for. The /feld list shows it in place of an empty feed.
 */
export function FeldEmptyFeed({
  functions,
  driverVehicles,
  checkedIn,
}: {
  /** The roles this person holds here (`functions` of the list answer). */
  functions: readonly string[]
  /** The vehicles this person drives here. */
  driverVehicles: readonly string[]
  checkedIn: boolean
}) {
  const t = useTranslations('feld')
  /** The vehicles as one readable string — «TLF 1» or «TLF 1, MTW». */
  const drivenVehicles = driverVehicles.join(', ')
  const emptyState: { title?: string; body?: string; Icon?: typeof Clock } = functions.includes(
    'telefondienst',
  )
    ? { title: t('roleEmpty.telefondienstTitle'), body: t('roleEmpty.telefondienstBody'), Icon: Phone }
    : functions.includes('kommandoposten')
      ? { title: t('roleEmpty.kommandopostenTitle'), body: t('roleEmpty.kommandopostenBody'), Icon: MonitorCog }
      : // A driver whose vehicle has not been disponiert yet, and a Reko trupp
        // waiting for an auftrag, are the two other people who were given a
        // specific job and would otherwise read "melde dich beim KP" — which is
        // the app telling them it does not know what they are here for. The
        // vehicle is NAMED, because that is the whole content of the message.
        drivenVehicles
        ? {
            title: t('roleEmpty.driverTitle', { vehicle: drivenVehicles }),
            body: t('roleEmpty.driverBody', { vehicle: drivenVehicles }),
            Icon: Truck,
          }
        : functions.includes('reko')
          ? { title: t('roleEmpty.rekoTitle'), body: t('roleEmpty.rekoBody'), Icon: Binoculars }
          : {}

  return (
    <div className="py-12 text-center animate-in fade-in duration-300">
      <div className="h-12 w-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
        {emptyState.Icon ? (
          <emptyState.Icon className="h-6 w-6 text-muted-foreground" />
        ) : (
          <Clock className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      {/* Checked in with nothing to do is NOT the same as being unknown —
          and saying so is the whole reason the picker may now be the
          roster (decision 10). It answers the question actually being
          asked: wissen die überhaupt, dass ich da bin?
          Somebody holding a role has a better answer than that: an empty
          list is not "nothing for you", it is their job. */}
      {(checkedIn || emptyState.title) && (
        <p className="mb-2 text-base font-medium">
          {emptyState.title ?? t('attendance.hereNoJob')}
        </p>
      )}
      {/* Visibility is "only mine" and it is enforced server-side, so a
          crew redirected by radio genuinely cannot file until the KP
          assigns them. This sentence is the whole mitigation for that
          decision — an empty page without it turns a policy into a bug
          report. */}
      <p className="text-sm text-muted-foreground px-2">
        {emptyState.body ?? t('assignments.empty')}
      </p>
    </div>
  )
}
