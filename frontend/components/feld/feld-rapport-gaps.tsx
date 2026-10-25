'use client'

/**
 * The one question «Rapport abschliessen» can ask on `/feld` – and the rows in
 * it that take the crew to the gap (UX-PHONE-05, owner pick B, 2026-10-24).
 *
 * Two tiers, because the old list cried wolf: it named Material and
 * Eigentümerdaten on almost every rapport, sections the form itself labels
 * «nur wenn nötig», so crews learned to tap «Trotzdem abschliessen» unread and
 * the one useful case – an empty Kurzbericht – drowned with them.
 *
 * - **missing** (Kurzbericht, Mannschaft – the sections whose state can be
 *   «todo»): only these open the question. The title names them, and the quiet
 *   answer says what is given up («Ohne Kurzbericht abschliessen»).
 * - **optional** (Material, Eigentümer-/Halterdaten): shown as quieter rows
 *   under the missing ones, so they can still be reached in one tap, but on
 *   their own they never ask – the rapport simply files.
 *
 * «Zurück zum Rapport» is the filled, focused answer (KP Front's `safeAnswer`):
 * an Enter or a reflex tap must not file over a gap. Every row closes the
 * question and lands on its section (FeldSection `jumpSignal`).
 */

import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
// The bare primitives for the two answers: the wrapped AlertDialogCancel is
// pre-styled as an outline, and «Zurück» here is the filled one.
import { Action as AlertDialogAction, Cancel as AlertDialogCancel } from '@radix-ui/react-alert-dialog'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { FELD_STATE_DOT } from '@/components/feld/feld-section'
import { cn } from '@/lib/utils'

export type MissingGap = 'kurzbericht' | 'personnel'
export type OptionalGap = 'material' | 'owner'
export type RapportGap = MissingGap | OptionalGap

export interface RapportGaps {
  missing: MissingGap[]
  optional: OptionalGap[]
}

/**
 * Sorts the empty sections into the two tiers, in form order.
 *
 * `ownerShown`: the Eigentümer block only counts where it is on screen – the KP
 * mount hides it when nobody filled it, and pointing at a block nobody can see
 * is worse than not pointing.
 */
export function rapportGaps(facts: {
  kurzbericht: string
  peopleCount: number
  materialCount: number
  ownerSummary: string
  ownerShown: boolean
}): RapportGaps {
  const missing: MissingGap[] = []
  if (!facts.kurzbericht.trim()) missing.push('kurzbericht')
  if (facts.peopleCount === 0) missing.push('personnel')
  const optional: OptionalGap[] = []
  if (facts.materialCount === 0) optional.push('material')
  if (facts.ownerShown && !facts.ownerSummary.trim()) optional.push('owner')
  return { missing, optional }
}

/** Which message names the missing set – one key per combination, so each
 *  language can phrase «A und B fehlen» its own way. */
function missingKey(missing: MissingGap[]): 'kurzbericht' | 'personnel' | 'both' {
  return missing.length > 1 ? 'both' : missing[0]
}

interface FeldRapportGapsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  gaps: RapportGaps
  /** A row was tapped: the dialog is already closing; land on that section. */
  onJump: (gap: RapportGap) => void
  /** «Ohne … abschliessen». */
  onConfirm: () => void
}

export function FeldRapportGapsDialog({ open, onOpenChange, gaps, onJump, onConfirm }: FeldRapportGapsDialogProps) {
  const t = useTranslations('feld.rapport')
  // Set by a row tap, read by the close: only then is the focus the landing
  // section's to take.
  const jumpedRef = useRef(false)
  // Never rendered without a missing section (the form files straight away
  // then), but a closing dialog re-renders with whatever the form now holds.
  const key = gaps.missing.length > 0 ? missingKey(gaps.missing) : null

  const sectionTitle = (gap: RapportGap) =>
    gap === 'material' ? t('material.title') : t(`sections.${gap}`)
  const emptyLine = (gap: RapportGap) =>
    ({
      kurzbericht: t('summary.kurzberichtEmpty'),
      personnel: t('summary.personnelEmpty'),
      material: t('summary.materialEmpty'),
      owner: t('summary.ownerEmpty'),
    })[gap]

  const row = (gap: RapportGap, quiet: boolean) => (
    <li key={gap}>
      <button
        type="button"
        onClick={() => {
          jumpedRef.current = true
          onOpenChange(false)
          onJump(gap)
        }}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-left transition-colors',
          quiet
            ? 'min-h-12 bg-card/50 py-1.5 hover:bg-muted/60'
            : 'min-h-13 border border-border bg-card py-2 hover:bg-muted/40',
        )}
      >
        <span
          className={cn('size-2 shrink-0 rounded-full', FELD_STATE_DOT[quiet ? 'optional' : 'todo'])}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm', quiet ? 'font-medium text-muted-foreground' : 'font-semibold')}>
            {sectionTitle(gap)}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{emptyLine(gap)}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  )

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* After a row tap, no focus hand-back to «Rapport abschliessen»: the
          landing section takes the focus, and Radix restoring it to the button
          would scroll the page back down under the crew's thumb. */}
      <AlertDialogContent
        className="gap-3 sm:max-w-md"
        onCloseAutoFocus={e => {
          if (!jumpedRef.current) return
          jumpedRef.current = false
          e.preventDefault()
        }}
      >
        {key && (
          <>
            <AlertDialogTitle className="text-center">{t(`gaps.title.${key}`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`gaps.lead.${key}`)}</AlertDialogDescription>
            <ul className="space-y-2">{gaps.missing.map(gap => row(gap, false))}</ul>
            {gaps.optional.length > 0 && (
              <>
                <p className="mt-1 px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('gaps.optionalHeading')}
                </p>
                <ul className="space-y-2">{gaps.optional.map(gap => row(gap, true))}</ul>
              </>
            )}
            {/* Stacked, the safe answer on top and filled. AlertDialog focuses
                its Cancel on open, so Enter means «Zurück» – going ahead is
                still one deliberate tap away. */}
            <div className="mt-1 flex flex-col gap-2">
              <AlertDialogCancel className={cn(buttonVariants(), 'h-12 w-full')}>{t('gaps.back')}</AlertDialogCancel>
              <AlertDialogAction className={cn(buttonVariants({ variant: 'outline' }), 'h-12 w-full whitespace-normal')} onClick={onConfirm}>
                {t(`gaps.confirm.${key}`)}
              </AlertDialogAction>
            </div>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
