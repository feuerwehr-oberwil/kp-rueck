'use client'

/**
 * «Möglicherweise dasselbe wie Hauptstrasse 6 · 40 m · vor 6'» — the amber
 * question a second report about one Schadenplatz gets before it becomes a
 * second card.
 *
 * One component, three mounts: «Neuer Einsatz» (dialog and phone sheet), the
 * Alarmeingang's attach dialog, and `/feld`'s review step. Advice, never a
 * block: amber, `role="status"`, and «Trotzdem neu» simply puts it away — the
 * form's own create button keeps working whether or not anybody answered.
 *
 * Two actions per card: «Zusammenführen» (the report goes into that card as a
 * Nachtrag, undoable from its Verlauf) and «Trotzdem neu». Both are real
 * buttons in the tab order, so the whole thing is a Tab and an Enter away.
 *
 * The sketch on the right is a map without a map: the 50 m circle around the
 * new report and the existing card(s) as pins, drawn from the coordinates — no
 * tiles, so it works offline and costs nothing inside a dialog. It only
 * appears where there is room (`sm:` and up, `showSketch`) and when both sides
 * have a pin; an address-only match has nothing to draw.
 */

import { useTranslations } from 'next-intl'
import { Combine, TriangleAlert } from 'lucide-react'

import type { ApiDuplicateCandidate } from '@/lib/api-client'
import {
  DUPLICATE_RADIUS_M,
  candidateAge,
  candidateDistance,
  candidateLabel,
  offsetMetres,
} from '@/lib/duplicates'
import { Button } from '@/components/ui/button'
import { ShellLoader } from '@/components/ui/shell-loader'
import { cn } from '@/lib/utils'

export interface DuplicateHintProps {
  candidates: ApiDuplicateCandidate[]
  /** The new report's own pin — the sketch's centre. */
  origin?: { lat: number; lng: number } | null
  onMerge: (candidate: ApiDuplicateCandidate) => void
  onDismiss: () => void
  /** The candidate being merged right now (its button shows the trail). */
  mergingId?: string | null
  /** False on narrow mounts (the phone sheet) — the sketch needs ~7rem. */
  showSketch?: boolean
  /** «Zusammenführen» is not offered (a viewer, or a bulk attach). */
  readOnly?: boolean
  /** `touch` on a phone: 44px buttons, the board's touch floor. */
  density?: 'dense' | 'touch'
  className?: string
}

export function DuplicateHint({
  candidates,
  origin = null,
  onMerge,
  onDismiss,
  mergingId = null,
  showSketch = true,
  readOnly = false,
  density = 'dense',
  className,
}: DuplicateHintProps) {
  const t = useTranslations('duplicates')
  if (candidates.length === 0) return null

  const busy = mergingId !== null
  const buttonSize = density === 'touch' ? 'default' : 'xs'
  // One candidate (the usual case): the sentence, then both answers side by side.
  // Several: each line carries its own «Zusammenführen», «Trotzdem neu» answers for all.
  const single = candidates.length === 1
  // Only what is really near goes into the sketch — an address-only match whose
  // pin is 300 m off would sit clamped on the edge, looking like 60 m.
  const pins = candidates
    .filter((c) => c.match !== 'address')
    .map((c) => ({ id: c.id, offset: offsetMetres(origin, { lat: c.location_lat, lng: c.location_lng }) }))
    .filter((p): p is { id: string; offset: { east: number; north: number } } => p.offset !== null)

  const mergeButton = (candidate: ApiDuplicateCandidate) => (
    <Button
      type="button"
      size={buttonSize}
      variant="outline"
      disabled={busy}
      title={t('mergeHint')}
      onClick={() => onMerge(candidate)}
      className="shrink-0"
    >
      {mergingId === candidate.id ? <ShellLoader className="size-3.5" /> : <Combine className="size-3.5" />}
      {t('merge')}
    </Button>
  )

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="duplicate-hint"
      className={cn(
        'flex gap-3 rounded-lg border border-warning/60 bg-warning/10 p-3 text-sm',
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-2.5">
        <ul className="space-y-2">
          {candidates.map((candidate) => {
            const distance = candidateDistance(candidate)
            const facts = [
              distance !== null ? t('distance', { meters: distance }) : t('sameAddress'),
              t('ago', { duration: candidateAge(candidate.created_at) }),
            ]
            return (
              <li key={candidate.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <p className="flex min-w-0 flex-1 basis-56 items-start gap-1.5 leading-snug">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                  <span className="min-w-0 break-words">
                    <span className="text-warning-foreground">{t('lead')} </span>
                    <span className="font-semibold text-foreground">{candidateLabel(candidate)}</span>
                    <span className="text-muted-foreground"> · {facts.join(' · ')}</span>
                  </span>
                </p>
                {!single && !readOnly && mergeButton(candidate)}
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-2 pl-5.5">
          {single && !readOnly && mergeButton(candidates[0])}
          <Button type="button" size={buttonSize} variant="ghost" disabled={busy} onClick={onDismiss}>
            {t('createAnyway')}
          </Button>
        </div>
      </div>
      {showSketch && origin && pins.length > 0 && <DuplicateSketch pins={pins} label={t('sketchLabel')} />}
    </div>
  )
}

const SIZE = 104
const RADIUS_PX = 36

/** The 50 m circle, the new report in the middle, the existing card(s) as amber pins. */
function DuplicateSketch({
  pins,
  label,
}: {
  pins: { id: string; offset: { east: number; north: number } }[]
  label: string
}) {
  const scale = RADIUS_PX / DUPLICATE_RADIUS_M
  const half = SIZE / 2
  const clamp = (v: number) => Math.max(8, Math.min(SIZE - 8, v))
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={label}
      className="hidden shrink-0 self-center rounded-md bg-background/60 sm:block"
    >
      <circle cx={half} cy={half} r={RADIUS_PX} className="fill-warning/10 stroke-warning/60" strokeDasharray="3 3" />
      {pins.map((pin) => (
        <circle
          key={pin.id}
          cx={clamp(half + pin.offset.east * scale)}
          cy={clamp(half - pin.offset.north * scale)}
          r={6}
          className="fill-warning stroke-background"
          strokeWidth={2}
        />
      ))}
      <circle cx={half} cy={half} r={5} className="fill-foreground stroke-background" strokeWidth={2} />
      <text x={half} y={SIZE - 4} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        {DUPLICATE_RADIUS_M} m
      </text>
    </svg>
  )
}
