'use client'

/**
 * What the board knows about this Schadenplatz, read on a phone (§18.22).
 *
 * Until the second field test `/feld` showed an address, an EL and two state
 * chips. A crew standing in front of a house therefore had no way to find out
 * what was dispatched with them or what the Reko found — the two questions they
 * actually radio in. Everything here already existed on the board; the field
 * surface simply never carried it.
 *
 * **Read-only, and it stays that way.** `/feld` writes no assignment
 * (decisions 17/18) and this section writes nothing at all. It is the briefing
 * the paper slip used to be.
 *
 * Two renderings of one set of facts:
 *
 * * `FeldBriefing` — the detail section: Meldung, Melder, Mannschaft, Fahrzeuge,
 *   Material, Reko.
 * * `FeldBriefingLine` — the list row's condensed form: the Meldung on one
 *   clamped line, the vehicle names, and the Reko's Gefahren badges. Those three
 *   are what decides which of six rows you open; everything else would only make
 *   the list longer, and the list is scrolled with a wet thumb.
 *
 * Gefahren are the one thing that appears on BOTH: a hazard is never something
 * you have to tap through to.
 */

import { useTranslations } from 'next-intl'
import { Binoculars, MapPin, Package, Phone, TriangleAlert, Truck, Undo2, Users, Waypoints } from 'lucide-react'

import { FeldSection } from '@/components/feld/feld-section'
import type { ApiFeldAssignment, ApiFeldMaterialLine, ApiFeldVehicleLine } from '@/lib/api-client'
import { getActiveLocale } from '@/lib/i18n-messages'

/** The `DangersAssessment` keys the board renders badges for. */
const DANGER_KEYS = ['fire', 'fire_danger', 'explosion', 'collapse', 'chemical', 'electrical'] as const

function formatTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' })
}

/**
 * The Gefahren badges, in the board's own wording.
 *
 * Deliberately reusing `reko.reportSection.dangerBadges` rather than a second
 * `feld.*` copy: two wordings for "Einsturz" is how the phone and the board stop
 * describing the same hazard.
 */
export function FeldDangerBadges({ dangers, className }: { dangers: string[]; className?: string }) {
  const tDanger = useTranslations('reko.reportSection.dangerBadges')
  const known = dangers.filter((d): d is (typeof DANGER_KEYS)[number] =>
    (DANGER_KEYS as readonly string[]).includes(d),
  )
  if (known.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`}>
      {known.map(danger => (
        <span
          key={danger}
          className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
        >
          <TriangleAlert className="h-3 w-3" />
          {tDanger(danger)}
        </span>
      ))}
    </div>
  )
}

function materialLabel(line: ApiFeldMaterialLine): string {
  return line.count > 1 ? `${line.name} ×${line.count}` : line.name
}

/** Vehicle names alone — for the list row, which has one clamped line and no
 *  room for who is driving. */
function vehicleNames(lines: ApiFeldVehicleLine[]): string {
  return lines.map(line => line.name).join(', ')
}

/**
 * "Reko von Muster Hans, 21:14" — degrading to the parts that exist.
 *
 * Three keys rather than one with empty placeholders: a label that reads
 * "Reko von Muster Hans, " because a timestamp was missing is exactly the kind
 * of half-sentence a crew reports as a bug.
 */
function rekoLabel(t: (key: string, values?: Record<string, string>) => string, name: string | null, time: string) {
  if (name && time) return t('rekoBy', { name, time })
  if (name) return t('rekoByName', { name })
  return t('reko')
}

/** One labelled row of the detail section. Renders nothing when it has nothing. */
function BriefingRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Users
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  )
}

/**
 * `folded` is what `/feld` passes: the briefing takes the same card shape as the
 * rapport blocks around it, but it does NOT fold. What the board knows about the
 * Schadenplatz is what the crew opened the page to read, and a block that can be
 * closed can be closed by accident with a wet thumb. The board-side rendering
 * (and the tests) keep the plain section.
 */
export function FeldBriefing({
  assignment,
  folded,
  bare,
}: {
  assignment: ApiFeldAssignment
  folded?: boolean
  /** Render only the rows — no card, no heading. Used by the detail header. */
  bare?: boolean
}) {
  const t = useTranslations('feld.briefing')
  const { description, contact, contact_phone: phone, crew, vehicles, materials, reko } = assignment

  const hasResources = crew.length > 0 || vehicles.length > 0 || materials.length > 0
  const hasReko = Boolean(reko && (reko.summary || reko.notes || reko.dangers.length > 0))
  if (!description && !contact && !phone && !hasResources && !hasReko) return null

  // Closed, this is all the crew sees of the briefing — so it is the Meldung
  // (the sentence that says what happened), falling back to what was sent.
  const summary =
    description?.replace(/\s+/g, ' ').trim() ||
    [vehicleNames(vehicles), crew.length ? `${crew.length}` : ''].filter(Boolean).join(' · ') ||
    t('summaryFallback')

  const body = (
    <>

      {description && (
        <div>
          <p className="text-xs text-muted-foreground">{t('meldung')}</p>
          {/* `whitespace-pre-line`: a dispatch text arrives with its own line
              breaks and losing them turns three facts into one sentence. */}
          <p className="whitespace-pre-line text-sm">{description}</p>
        </div>
      )}

      {(contact || phone) && (
        <BriefingRow icon={Phone} label={t('melder')}>
          {/* A tel: link, because the whole point of carrying the Melder here is
              that somebody rings them from the pavement. */}
          {phone ? (
            <a href={`tel:${phone.replace(/\s/g, '')}`} className="text-primary underline underline-offset-2">
              {contact ? `${contact} · ${phone}` : phone}
            </a>
          ) : (
            contact
          )}
        </BriefingRow>
      )}

      {crew.length > 0 && (
        <BriefingRow icon={Users} label={t('crew')}>
          {crew.join(', ')}
        </BriefingRow>
      )}

      {/* One line per vehicle, and three facts on it, because those are the
          three a crew standing at an address actually asks about a vehicle:
          WHO is sitting in it (it is the person you need when it has to move),
          whether it BELONGS to the Auftrag (an Auftrag's vehicles are shared
          across every stop, so it comes to the next one — a Schadenplatz's do
          not), and whether it STAYS here or drives back once you are dropped
          off. «TLF 1» on its own answered none of them. */}
      {vehicles.length > 0 && (
        <BriefingRow icon={Truck} label={t('vehicles')}>
          <div className="space-y-1">
            {vehicles.map(vehicle => (
              <p key={vehicle.name} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span>
                  {vehicle.name}
                  {vehicle.driver && (
                    <span className="text-muted-foreground"> · {t('driver', { name: vehicle.driver })}</span>
                  )}
                </span>
                {vehicle.via_auftrag && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-info/15 px-1.5 py-0.5 text-[11px] font-medium text-info">
                    <Waypoints className="h-3 w-3 shrink-0" />
                    {t('vehicleViaAuftrag')}
                  </span>
                )}
                {/* Amber for the one that costs something — the same colour the
                    board gives it. A vehicle parked at the address is blocked
                    in; one that drives back is the normal state of the world.
                    Nothing at all when the answer is null: an Auftrag has no
                    driver-stay toggle, so «fährt zurück» there would be the
                    board answering for a decision nobody made. */}
                {vehicle.stays !== null && vehicle.stays !== undefined && (
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                      vehicle.stays ? 'bg-warning/15 text-warning-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {vehicle.stays ? <MapPin className="h-3 w-3 shrink-0" /> : <Undo2 className="h-3 w-3 shrink-0" />}
                    {t(vehicle.stays ? 'vehicleStays' : 'vehicleReturns')}
                  </span>
                )}
              </p>
            ))}
          </div>
        </BriefingRow>
      )}

      {materials.length > 0 && (
        <BriefingRow icon={Package} label={t('material')}>
          {materials.map(materialLabel).join(', ')}
        </BriefingRow>
      )}

      {hasReko && reko && (
        <BriefingRow icon={Binoculars} label={rekoLabel(t, reko.submitted_by_name, formatTime(reko.submitted_at))}>
          <div className="space-y-1.5">
            <FeldDangerBadges dangers={reko.dangers} />
            {reko.summary && <p className="whitespace-pre-line">{reko.summary}</p>}
            {reko.notes && <p className="whitespace-pre-line text-muted-foreground">{reko.notes}</p>}
          </div>
        </BriefingRow>
      )}
    </>
  )

  // `bare` drops the wrapper AND the heading: the briefing then sits inside the
  // detail's header card, under the address it belongs to. "Lage und
  // Ressourcen" was a title over the only content on screen — a label for a
  // section nobody had to be told apart from anything else.
  if (bare) return <div className="space-y-3">{body}</div>

  if (folded) {
    return (
      <FeldSection title={t('title')} summary={summary} state="filled" alwaysOpen>
        {body}
      </FeldSection>
    )
  }

  return (
    <section className="rounded-xl bg-secondary/30 p-4 space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t('title')}</h2>
      {body}
    </section>
  )
}

/**
 * The list row's condensed briefing: Meldung (clamped), vehicles, Gefahren.
 *
 * Three lines at most. The list is what a crew scrolls to find the right
 * Schadenplatz, so it answers "which one is this" and stops — the crew, the
 * material and the Reko text are one tap away in the detail.
 */
export function FeldBriefingLine({ assignment }: { assignment: ApiFeldAssignment }) {
  // No labels here on purpose: the truck glyph says "Fahrzeuge" and the Meldung
  // needs no heading. A list row that explains itself is a row twice as tall.
  const { description, vehicles, reko } = assignment
  const dangers = reko?.dangers ?? []

  if (!description && vehicles.length === 0 && dangers.length === 0) return null

  return (
    <div className="mb-2 space-y-1">
      {description && <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>}
      {vehicles.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Truck className="h-3 w-3 shrink-0" />
          <span className="truncate">{vehicleNames(vehicles)}</span>
        </p>
      )}
      <FeldDangerBadges dangers={dangers} />
    </div>
  )
}
