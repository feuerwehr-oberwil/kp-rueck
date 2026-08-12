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
import { Binoculars, Package, Phone, TriangleAlert, Truck, Users } from 'lucide-react'

import { FeldSection } from '@/components/feld/feld-section'
import type { ApiFeldAssignment, ApiFeldMaterialLine } from '@/lib/api-client'
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
 * `folded` is what `/feld` passes: the briefing becomes one of the page's
 * foldable blocks, open on arrival because it is the first thing read, but
 * closable once the crew knows the address by heart. The board-side rendering
 * (and the tests) keep the plain section.
 */
export function FeldBriefing({ assignment, folded }: { assignment: ApiFeldAssignment; folded?: boolean }) {
  const t = useTranslations('feld.briefing')
  const { description, contact, contact_phone: phone, crew, vehicles, materials, reko } = assignment

  const hasResources = crew.length > 0 || vehicles.length > 0 || materials.length > 0
  const hasReko = Boolean(reko && (reko.summary || reko.notes || reko.dangers.length > 0))
  if (!description && !contact && !phone && !hasResources && !hasReko) return null

  // Closed, this is all the crew sees of the briefing — so it is the Meldung
  // (the sentence that says what happened), falling back to what was sent.
  const summary =
    description?.replace(/\s+/g, ' ').trim() ||
    [vehicles.join(', '), crew.length ? `${crew.length}` : ''].filter(Boolean).join(' · ') ||
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

      {vehicles.length > 0 && (
        <BriefingRow icon={Truck} label={t('vehicles')}>
          {vehicles.join(', ')}
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

  if (folded) {
    return (
      <FeldSection title={t('title')} summary={summary} state="filled" defaultOpen>
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
          <span className="truncate">{vehicles.join(', ')}</span>
        </p>
      )}
      <FeldDangerBadges dangers={dangers} />
    </div>
  )
}
