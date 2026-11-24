"use client"

/**
 * The phone's Einsatz detail – a bottom sheet over the board's phone list and the Lagekarte.
 *
 * READ-ONLY, for every role (owner's pick, 14.11.2026: «Board read-only, intake stays»): the
 * phone looks, the desk works the board. Status is a word, the Meldung is text, the Melder is a
 * `tel:` link – no tap-to-edit, no status select, no WhatsApp export (that stays on the desk).
 * What a phone may still write is intake: «Neuer Einsatz», Übungs-Einsätze, the Appell.
 */

import { vehicleLabel } from "@/lib/vehicle-label"
import Link from "next/link"
import { useRef } from "react"
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { formatDurationHours } from "@/lib/duration"
import { Button } from "@/components/ui/button"
import { IncidentNumber } from "@/components/ui/incident-number"
import { Separator } from "@/components/ui/separator"
import {
  Truck,
  Users,
  Package,
  Binoculars,
  AlertTriangle,
  Map as MapIcon,
  Phone,
  Footprints,
} from "lucide-react"
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { RemovableChip } from "@/components/ui/removable-chip"
import { MelderLink } from "@/components/ui/melder-link"
import { DriverStayGlyph } from "@/components/ui/driver-stay-glyph"
import { LeaderBadge } from "@/components/kanban/leader-badge"
import { DetailGroupHeading } from "@/components/kanban/detail-field"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import { PriorityGlyph } from "@/components/ui/priority-glyph"
import { ScrollEndFade } from "@/components/ui/scroll-end-fade"
import { isIncidentType } from "@/lib/types/incidents"
import { AddressText } from "@/components/kanban/address-text"
import { useTranslations } from "next-intl"
import { sortCrewByLeader } from "@/lib/crew-order"
import { useEvent } from "@/lib/contexts/event-context"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import RekoReportSection from "@/components/reko/reko-report-section"
import { PhotoViewerProvider } from "@/components/photos/photo-viewer"
import { getIncidentRefParts } from "@/lib/incident-types"
import { PersonName } from "@/components/person-name"

interface MobileIncidentDetailSheetProps {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  materials: Material[]
  formatLocation: (address: string) => string
  /** Opened ON the Lagekarte: «Auf Karte anzeigen» closes the sheet and the map flies to the
   *  marker (the caller does both). Without it the button goes to `/map?highlight=`. */
  onShowOnMap?: (incidentId: string) => void
}

export function MobileIncidentDetailSheet({
  operation,
  open,
  onOpenChange,
  materials,
  formatLocation,
  onShowOnMap,
}: MobileIncidentDetailSheetProps) {
  const t = useTranslations('incidents')
  const tColumns = useTranslations('kanban.columns')
  // The resource chips reuse the board's own labels (Funkrufname, Zu Fuss …)
  // so the phone and the board name the same thing the same way.
  const tKanban = useTranslations('kanban')
  const { selectedEvent } = useEvent()
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id ?? null, open)
  // The detail button that opened the sheet (`data-detail-opener`, on the phone card and the
  // Lagekarte row), read when the sheet takes the focus: a controlled sheet has no Radix trigger
  // to give it back to on close. Only that button: a field focused earlier would pop the keyboard.
  const openerRef = useRef<HTMLElement | null>(null)

  // Byte-identical fallback to the raw type value for unknown types
  const typeLabel = (type: string) => (isIncidentType(type) ? t(`types.${type}`) : type)

  if (!operation) return null

  const priority = operation.priority || "low"
  const notes = operation.notes?.trim()
  const contact = operation.contact?.trim()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <PhotoViewerProvider incidentLabel={getIncidentRefParts(operation).head}>
      <SheetContent
        side="bottom"
        // No description line: it used to print the Einsatz-ID (two lines of UUID) under the
        // title — a database key nobody on a phone reads, says or types.
        aria-describedby={undefined}
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          const opener = openerRef.current
          if (!opener?.isConnected || !opener.matches("[data-detail-opener]")) return
          event.preventDefault()
          opener.focus({ preventScroll: true })
        }}
        // The frame every phone sheet has (new-emergency-modal.tsx): header, a body that
        // scrolls, a foot that stays. It covers the nav, so the foot pays only the safe
        // area (`pb-sheet-safe`). One sheet-long scroller used to leave «Auf Karte
        // anzeigen» wherever the content ended – on a busy Einsatz on the screen's bottom
        // edge (hill climb r7).
        // The ✕ (44px on a phone) centred on the title's 28px first line, 16 + 14 = 30px down –
        // at the sheet's `top-4` it hung 9px below the title (hill climb r22), the same fix as
        // the «Neuer Einsatz» sheet's.
        className="modal-h-tall gap-0 [&>[data-slot=sheet-close]]:top-[30px] [&>[data-slot=sheet-close]]:-translate-y-1/2"
      >
        <SheetHeader className="border-b px-4 pb-4">
          <div className="flex items-start gap-2">
            {/* Priority: the shared mark alone, as on the desk card and the desk
                detail – a dot in front of it said the same thing twice (hill climb
                r5). The wall's drawing in an 18px box = a 16px mark (r20), centred
                on the title's 28px first line. */}
            <PriorityGlyph priority={priority} size="wall" className="mt-[5px] size-[18px]" />
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-xl text-left">
                {/* The number before the address, as on the phone card and the desk detail. */}
                <IncidentNumber number={operation.number} className="mr-2 text-xs" />
                {formatLocation(operation.location)
                  ? <AddressText text={formatLocation(operation.location)} />
                  : typeLabel(operation.incidentType)}
              </SheetTitle>
            </div>
          </div>
        </SheetHeader>

        {/* 16px everywhere: header rule → status, section → section, group → group.
            No bottom padding: the body ends in the shared end fade (below). */}
        <SheetBody className="space-y-4 px-4 pt-4">
          {/* Abholung (decision 24) — the `banner` variant, the same shape the
              desktop detail uses, because this sheet is the phone's detail
              surface. Read-only (`canEdit={false}`): the phone is for looking,
              and «Abholung disponiert» is irreversible — it erases the waiting
              time, which is the only record of how long the crew stood there.
              Not gated on status: completing the card releases the crew while
              they are still at the address. */}
          {operation.pickupNeeded && (
            <PickupBadge
              variant="banner"
              requestedAt={operation.pickupRequestedAt}
              note={operation.pickupNote}
              canEdit={false}
            />
          )}

          {/* Status & Time Row */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="secondary" className="text-sm max-w-full">
              {tColumns(operation.status)}
            </Badge>
            {/* The Einsatzart is a fact beside the status, so it is plain
                muted text (14/20 500), as on the phone card: boxed, it read as a
                second select (hill climb r18). The age stands at the row's end. */}
            <span className="min-w-0 text-sm font-medium text-muted-foreground">
              {typeLabel(operation.incidentType)}
            </span>
            <IncidentTimeRow
              readOnly
              operation={operation}
              className="ml-auto gap-1.5 text-sm text-muted-foreground"
              chipClassName="text-sm"
            />
            {/* Muted Binoculars = Reko filed, as on the board and the wall; the green
                ticked paper is the Schadenplatz-Rapport's mark only. */}
            {operation.hasCompletedReko && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Binoculars className="h-3 w-3" />
                {t('mobileDetail.rekoBadge')}
              </Badge>
            )}
          </div>

          {/* The Meldung, as text. Nothing when there is none: an empty grey box read as a
              field waiting for input. */}
          {notes && (
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">{notes}</p>
            </div>
          )}

          {/* Danger warnings from Reko */}
          {operation.rekoSummary?.hasDangers && operation.rekoSummary.dangerTypes.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-warning-foreground" />
                <span className="font-semibold text-warning-foreground text-sm">{t('mobileDetail.dangers')}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {operation.rekoSummary.dangerTypes.map((danger, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {danger}
                  </Badge>
                ))}
              </div>
              {(operation.rekoSummary.personnelCount || operation.rekoSummary.estimatedDuration) && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {operation.rekoSummary.personnelCount && (
                    <span className="mr-3">{t('mobileDetail.personnelCount', { count: operation.rekoSummary.personnelCount })}</span>
                  )}
                  {operation.rekoSummary.estimatedDuration && (
                    <span>{t('mobileDetail.estimatedDuration', { duration: formatDurationHours(operation.rekoSummary.estimatedDuration) })}</span>
                  )}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* Assigned Resources. Each section opens with the desk detail's caps
              label (`DetailGroupHeading`: type-label, 14px muted glyph, 8px to the
              chips) – «FAHRZEUGE · 1» like «KRÄFTE · 4»; the title-case 14/500
              heads read as one more item (hill climb r19). 16px between sections. */}
          <div className="space-y-4">
            {/* Vehicles */}
            <div>
              <DetailGroupHeading icon={<Truck className="h-3.5 w-3.5 shrink-0" />}>{t('mobileDetail.vehicles', { count: operation.vehicles.length })}</DetailGroupHeading>
              {/* «Zu Fuss» is a deliberate state, not an absence: a crew that
                  walked to the address has to read as such here, exactly as it
                  does on the board and on the wall. Without it the sheet said
                  «Keine Fahrzeuge zugewiesen» — the opposite of the truth. So
                  the empty line is gated on BOTH facts, and the chip leads the
                  row, in the same order as the board. */}
              {operation.zuFuss || operation.vehicles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {operation.zuFuss && (
                    <RemovableChip variant="secondary" className="text-sm max-w-full font-normal">
                      <Footprints className="flex-shrink-0" />
                      <span>{tKanban('common.zuFuss')}</span>
                    </RemovableChip>
                  )}
                  {operation.vehicles.map(({ vehicleId, name: vehicleName, callsign, driverStay }) => {
                    const driver = vehicleDrivers.get(vehicleId)
                    return (
                      <div key={vehicleId} className="flex max-w-full flex-col items-start gap-1.5">
                        <RemovableChip
                          variant="secondary"
                          className="text-sm max-w-full font-normal"
                          title={callsign ? tKanban('common.funkrufname', { callsign }) : undefined}
                        >
                          <span>
                            {vehicleLabel({ name: vehicleName, callsign })}
                            {driver && (
                              <span className="text-muted-foreground">
                                {" "}(<PersonName name={driver.name} personnelId={driver.personnelId} />)
                              </span>
                            )}
                          </span>
                        </RemovableChip>
                        {/* Whether the driver stays with the vehicle — the same
                            state the board and the wall carry per chip. The
                            phone shows the state only; the toggle is a control
                            and stays on the board. Its own caption line under
                            the chip, as on /feld: squeezed in beside vehicle +
                            driver it read as part of the name (hill climb r12).
                            6px under the chip and 22px tall (12/16 + 3px), so it
                            reads as its own line and not as the chip's shadow (r18).
                            On the vehicle chip's own surface (`bg-secondary`), not the
                            glyph's darker ink tint: two greys stacked read as two
                            kinds of thing (r22). */}
                        <DriverStayGlyph
                          stays={driverStay}
                          size="caption"
                          className="bg-secondary px-1.5 py-[3px] text-secondary-foreground"
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('mobileDetail.noVehicles')}</p>
              )}
            </div>

            {/* Crew */}
            <div>
              <DetailGroupHeading icon={<Users className="h-3.5 w-3.5 shrink-0" />}>{t('mobileDetail.crew', { count: operation.crew.length })}</DetailGroupHeading>
              {operation.crew.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {/* EL first (decision 23): the phone is a viewing surface, and
                      a wrapped badge row is exactly where a name gets lost.
                      The «EL» mark rides along — sorting alone only helps if
                      you already know the list is sorted. */}
                  {sortCrewByLeader(operation.crew, operation.leaderId).map(({ personnelId, name: member }) => (
                    <RemovableChip key={personnelId} variant="secondary" className="text-sm max-w-full font-normal">
                      <LeaderBadge isLeader={operation.leaderId === personnelId} />
                      <span><PersonName name={member} personnelId={personnelId} display={member.trim() || tKanban('common.unknownResource')} /></span>
                    </RemovableChip>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('mobileDetail.noCrew')}</p>
              )}
            </div>

            {/* Materials */}
            <div>
              <DetailGroupHeading icon={<Package className="h-3.5 w-3.5 shrink-0" />}>{t('mobileDetail.materials', { count: operation.materials.length })}</DetailGroupHeading>
              {operation.materials.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {operation.materials.map((matId) => (
                    <RemovableChip key={matId} variant="secondary" className="text-sm max-w-full font-normal">
                      <span>{materials.find(m => m.id === matId)?.name || matId}</span>
                    </RemovableChip>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('mobileDetail.noMaterials')}</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Contact. The number goes under the name as /feld draws it (`MelderLink`: one tel:
              link, the number whole on its own line); a name without a number is plain text. */}
          <div>
            <DetailGroupHeading icon={<Phone className="h-3.5 w-3.5 shrink-0" />}>{t('mobileDetail.contact')}</DetailGroupHeading>
            {operation.contactPhone ? (
              <MelderLink contact={contact} phone={operation.contactPhone} className="text-sm" />
            ) : (
              <p className={contact ? "text-sm text-foreground break-words" : "text-sm text-muted-foreground"}>
                {contact || t('mobileDetail.noContact')}
              </p>
            )}
          </div>

          {/* Reko Report Section */}
          {operation.hasCompletedReko && (
            <>
              <Separator />
              <RekoReportSection incidentId={operation.id} />
            </>
          )}

          {/* While more waits below, the last 24px fade into the sheet above the foot's
              rule, so a section is never cut flat against it (hill climb r20). `-mt-4`
              takes back the `space-y-4` step: at the end the fade lies over the 24px
              after the last section, which is the body's end padding. */}
          <ScrollEndFade surface="dialog" className="-mt-4" />
        </SheetBody>

        {/* The one way on from here, in the foot that stays: never on the screen's edge,
            never scrolled away. The same foot frame as «Neuer Einsatz». */}
        <SheetFooter className="mt-0 border-t px-4 pt-3 pb-sheet-safe">
          {onShowOnMap ? (
            <Button variant="outline" size="lg" className="w-full gap-2" onClick={() => onShowOnMap(operation.id)}>
              <MapIcon className="h-4 w-4" />
              {t('mobileDetail.showOnMap')}
            </Button>
          ) : (
            <Link href={`/map?highlight=${operation.id}`} onClick={() => onOpenChange(false)}>
              <Button variant="outline" size="lg" className="w-full gap-2">
                <MapIcon className="h-4 w-4" />
                {t('mobileDetail.showOnMap')}
              </Button>
            </Link>
          )}
        </SheetFooter>
      </SheetContent>
      </PhotoViewerProvider>
    </Sheet>
  )
}
