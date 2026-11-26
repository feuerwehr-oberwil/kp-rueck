'use client'

/**
 * The sheets behind the phone's «Mehr» → Schnellzugriff, on every page that shows the bottom nav.
 *
 * They used to be the board's: the board handed its own sheet setters to the nav, and every other
 * page – the Lagekarte above all – passed none, so «Mehr» there offered Kennzahlen and nothing
 * else (owner, 16.11.2026: on the phone «Mehr» is the one menu, not a page's toolbar). Now the
 * nav owns them. The desktop board keeps its footer's own instances (`board-dialogs.tsx`); this
 * component is mounted only on a phone, so a desktop never carries two of each.
 *
 * Mounted for a viewer too (the phone shell is every role's, owner pick 4A, 24.11.2026): the
 * sheets that write – Links & QR, the Appell, Fahrzeuge, Drucken – are an editor's and are not
 * mounted for anyone else; Tagebuch, Personal and Dienstzeiten only read for a viewer.
 *
 * Controlled: the nav says which one is open (`open`), the sheet closing says `null`. Opening the
 * Appell from «Links & QR» replaces that sheet (two layers for one job is one too many), and so
 * does «Dienstzeiten» from Personal.
 */

import { useCallback, useRef } from 'react'
import { AttendanceModal } from '@/components/kanban/attendance-modal'
import { CrewDutySheet } from '@/components/kanban/crew-duty-sheet'
import { LinksQrSheet } from '@/components/kanban/links-qr-sheet'
import { JournalSheet } from '@/components/journal/journal-sheet'
import { MobilePersonnelSheet } from '@/components/mobile/mobile-personnel-sheet'
import { PrintHubSheet } from '@/components/print/print-hub-sheet'
import { VehicleStatusSheet } from '@/components/vehicle-status-sheet'
import { useAuth } from '@/lib/contexts/auth-context'
import { useEvent } from '@/lib/contexts/event-context'
import { useNotifications } from '@/lib/contexts/notification-context'
import { useOperations } from '@/lib/contexts/operations-context'
import { usePersonnel } from '@/lib/contexts/personnel-context'
import { usePersonEngagements } from '@/lib/hooks/use-person-engagements'
import { usePersonPlaces } from '@/lib/hooks/use-person-matcher'
import { usePrintBoard } from '@/lib/hooks/use-print-board'
import { useStationCapabilities } from '@/lib/hooks/use-station-capabilities'
import { getIncidentRefParts } from '@/lib/incident-types'
import { personNowLink } from '@/lib/detail-target'

export type PhoneQuickSheet = 'links' | 'attendance' | 'journal' | 'personnel' | 'crew' | 'vehicles' | 'print'

interface PhoneQuickSheetsProps {
  open: PhoneQuickSheet | null
  onOpenChange: (sheet: PhoneQuickSheet | null) => void
  /** Puts focus back on the Personal tile when its sheet closes (the tile is no SheetTrigger). */
  onPersonnelCloseFocus?: (event: Event) => void
}

export function PhoneQuickSheets({ open, onOpenChange, onPersonnelCloseFocus }: PhoneQuickSheetsProps) {
  const { selectedEvent } = useEvent()
  const { isEditor } = useAuth()
  const { operations, refreshOperations } = useOperations()
  // Auftrag crews folded in, as the board's sidebar draws them – the raw list calls them frei.
  const { personnel, refreshPersonnel } = usePersonnel()
  const { navigateToIncident, settings } = useNotifications()
  const personEngagements = usePersonEngagements()
  const personPlaces = usePersonPlaces()
  const { printerEnabled } = useStationCapabilities()
  const close = useCallback(() => onOpenChange(null), [onOpenChange])
  // A print queued a moment ago closes ITS sheet only: by the time the request answers the
  // operator may have closed it and opened another one, which must stay.
  const openRef = useRef(open)
  openRef.current = open
  const closePrint = useCallback(() => {
    if (openRef.current === 'print') onOpenChange(null)
  }, [onOpenChange])
  const { print, printing } = usePrintBoard(selectedEvent?.id ?? null, closePrint)
  const eventId = selectedEvent?.id ?? null

  /** A sheet's own close only clears it while it is still the open one – a hand-over
   *  (Links → Appell) has already moved `open` on. */
  const closes = (sheet: PhoneQuickSheet) => (next: boolean) => {
    if (!next && open === sheet) onOpenChange(null)
  }

  /** Where this person is still assigned, for the Appell's row (same as the board's). */
  const assignmentLabelFor = useCallback(
    (person: { id: string }) => {
      const op = operations.find((o) => o.status !== 'complete' && o.crew.some((m) => m.personnelId === person.id))
      return op ? getIncidentRefParts(op).head : null
    },
    [operations],
  )

  return (
    <>
      {isEditor && (
        <LinksQrSheet
          open={open === 'links'}
          onOpenChange={closes('links')}
          eventId={eventId}
          eventName={selectedEvent?.name ?? null}
          printerEnabled={printerEnabled}
          onOpenAttendance={() => onOpenChange('attendance')}
        />
      )}
      {isEditor && selectedEvent && (
        <AttendanceModal
          open={open === 'attendance'}
          onOpenChange={closes('attendance')}
          eventId={selectedEvent.id}
          eventName={selectedEvent.name}
          assignmentLabelFor={assignmentLabelFor}
          onAttendanceChange={() => void refreshPersonnel()}
          canCheckIn
        />
      )}
      <JournalSheet
        open={open === 'journal'}
        onOpenChange={closes('journal')}
        eventId={eventId}
        operations={operations}
        isEditor={isEditor}
        refreshBoard={refreshOperations}
        onOpenIncident={(id) => {
          close()
          navigateToIncident(id)
        }}
      />
      <MobilePersonnelSheet
        open={open === 'personnel'}
        onOpenChange={closes('personnel')}
        personnel={personnel}
        operations={operations}
        places={personPlaces}
        onOpenCrewDuty={() => onOpenChange('crew')}
        onOpenIncident={(id) => {
          close()
          navigateToIncident(id)
        }}
        onCloseAutoFocus={onPersonnelCloseFocus}
      />
      <CrewDutySheet
        open={open === 'crew'}
        onOpenChange={closes('crew')}
        eventId={eventId}
        personnel={personnel}
        personEngagements={personEngagements}
        fatigueHours={settings.fatigue_hours}
        // «Jetzt» opens the phone Einsatz sheet on the block of the place its line names, as the
        // desk's does. An Auftrag has no phone surface, so that line stays text.
        openNowFor={(person) => {
          const link = personNowLink(person, personEngagements.get(person.id), operations)
          if (link?.kind !== 'incident') return undefined
          return () => {
            close()
            navigateToIncident(link.targetId, link.target.tab, link.target.section)
          }
        }}
      />
      {isEditor && (
        <>
          <VehicleStatusSheet open={open === 'vehicles'} onOpenChange={closes('vehicles')} eventId={eventId} />
          <PrintHubSheet
            open={open === 'print'}
            onOpenChange={closes('print')}
            onThermoPrint={(options) => void print(options)}
            isThermoPrinting={printing}
            printerEnabled={printerEnabled}
          />
        </>
      )}
    </>
  )
}
