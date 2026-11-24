'use client'

import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowRight, Plus } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { ShellLoader } from '@/components/ui/shell-loader'
import { cn } from '@/lib/utils'

/** One of the two answers: a card the operator reads and then clicks (or presses `shortcut`). */
export interface Choice {
  /** One letter; pressing it (no modifier) runs the choice. Shown on the card. */
  shortcut: string
  label: string
  icon: ReactNode
  /** The before/after picture (`ChoiceDiagram`). */
  diagram: ReactNode
  /** One plain sentence: what is true after this answer. */
  consequence: ReactNode
  onSelect: () => Promise<void> | void
}

/**
 * A question with two answers that both CHANGE something and no safe «yes» – the Doppelbelegung
 * («Hierher verschieben» / «Auf beiden führen») and the vehicle that drives an Auftrag («In
 * Auftrag aufnehmen» / «Nur zusätzlich zuweisen»). Owner pick 3A (23.11.2026): «cancel is
 * default. move or auf beiden needs to be clearly described and manually selected».
 *
 * - Two choice cards side by side (stacked on a phone), each with a mini before/after diagram
 *   and one sentence of the consequence. One click on a card, or its letter, runs it.
 * - The only footer button is Abbrechen: ink, focused on open, so Enter and Esc change nothing.
 * - Capped at `modal-h-tall`: on a short screen only the cards scroll (`data-slot="choice-cards"`),
 *   the title and Abbrechen stay in view (Sol review E round 3).
 *
 * The CALLER closes it, like `ConfirmDialog` with `onCancel`: every answer changes the caller's
 * state, Abbrechen / Esc call `onCancel`. While an answer runs every button waits; a rejecting
 * handler has reported itself and the question stays open for a second try.
 */
export function ChoiceDialog({
  title,
  icon,
  description,
  choices,
  onCancel,
  cancelText,
}: {
  title: ReactNode
  icon?: ReactNode
  description: ReactNode
  choices: readonly [Choice, Choice]
  onCancel: () => void
  cancelText?: string
}) {
  const t = useTranslations('common.choiceDialog')
  const [busy, setBusy] = useState<string | null>(null)
  // The label names a card, the consequence describes it – the diagram is for the eye only.
  const id = useId()

  const run = async (choice: Choice) => {
    if (busy) return
    setBusy(choice.shortcut)
    try {
      await choice.onSelect()
    } catch {
      // Reported by the handler; stay open for the retry.
    } finally {
      setBusy(null)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // No key reaches what is under the question: the board's and an open picker's keys listen
    // on `window` («0» = Zu Fuss, «1»–«9» tick a tile). Esc (Radix, document capture), Tab (the
    // focus trap, this element) and Enter / Space on a focused button (native) still work.
    e.stopPropagation()
    if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return
    const choice = choices.find((c) => c.shortcut.toLowerCase() === e.key.toLowerCase())
    if (!choice) return
    e.preventDefault()
    void run(choice)
  }

  return (
    <AlertDialog open onOpenChange={(next) => !next && !busy && onCancel()}>
      {/* Radix AlertDialog focuses Abbrechen on open: Enter = nichts ändern. */}
      <AlertDialogContent size="md" className="modal-h-tall grid-rows-[auto_minmax(0,1fr)_auto]" onKeyDown={onKeyDown}>
        <AlertDialogHeader>
          <AlertDialogTitle className={icon ? 'flex items-center gap-2' : undefined}>
            {icon && <span className="flex shrink-0">{icon}</span>}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {/* The one scroller; `-m-1 p-1` keeps the cards' focus ring inside its clip. */}
        <div data-slot="choice-cards" className="-m-1 grid min-h-0 gap-3 overflow-y-auto p-1 sm:grid-cols-2">
          {choices.map((choice) => (
            <button
              key={choice.shortcut}
              type="button"
              disabled={busy !== null}
              onClick={() => void run(choice)}
              aria-keyshortcuts={choice.shortcut.toUpperCase()}
              aria-labelledby={`${id}-${choice.shortcut}-label`}
              aria-describedby={`${id}-${choice.shortcut}-consequence`}
              className="rounded-xl border bg-background p-3.5 text-left shadow-xs transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:shrink-0">
                {busy === choice.shortcut ? <ShellLoader className="size-4" /> : choice.icon}
                <span id={`${id}-${choice.shortcut}-label`} className="min-w-0">{choice.label}</span>
                <Kbd aria-hidden className="ml-auto max-md:hidden">{choice.shortcut.toUpperCase()}</Kbd>
              </span>
              <span className="my-3 block">{choice.diagram}</span>
              <span id={`${id}-${choice.shortcut}-consequence`} className="block text-sm text-foreground">
                {choice.consequence}
              </span>
            </button>
          ))}
        </div>
        <AlertDialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground max-md:hidden">{t('cancelHint')}</span>
          <AlertDialogCancel disabled={busy !== null} className={cn(buttonVariants({ variant: 'default' }))}>
            {cancelText ?? t('cancel')}
            <Kbd aria-hidden className="bg-transparent text-current opacity-80 max-md:hidden">{t('enterKey')}</Kbd>
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** A resource chip on a mini card: as it is, gone from there (struck), or held twice. */
export type MiniChipTone = 'plain' | 'gone' | 'double'

/** One incident (or Auftrag) card of a `ChoiceDiagram`: its name and the chips that matter. */
export interface MiniCard {
  id: string
  title: string
  chips: { label: string; tone: MiniChipTone }[]
}

const CHIP_TONE: Record<MiniChipTone, string> = {
  plain: 'bg-secondary text-secondary-foreground',
  gone: 'border-dashed border-border text-muted-foreground line-through',
  double: 'border-warning/60 bg-warning/10 text-warning-foreground',
}

function MiniCardView({ card, faded }: { card: MiniCard; faded?: boolean }) {
  return (
    <span className={cn('block min-w-0 rounded-sm border bg-card px-2 py-1.5', faded && 'opacity-75')}>
      <span className="block truncate text-xs font-semibold" title={card.title}>{card.title}</span>
      <span className="mt-1 flex min-h-5 flex-wrap gap-1">
        {/* By position: two devices of one Modul can share a name. */}
        {card.chips.map((chip, i) => (
          <span
            key={i}
            className={cn('max-w-full truncate rounded-sm border border-transparent px-1.5 py-0.5 text-xs', CHIP_TONE[chip.tone])}
          >
            {chip.label}
          </span>
        ))}
      </span>
    </span>
  )
}

/**
 * The picture on a choice card: where things stand before (left) and what the answer makes of
 * it (right). `link` = `move` draws an arrow (it goes from left to right), `both` a plus (it is
 * on both). Every chip carries a word or a stroke, never a colour on its own.
 */
export function ChoiceDiagram({ from, to, link }: { from: MiniCard[]; to: MiniCard; link: 'move' | 'both' }) {
  const Link = link === 'move' ? ArrowRight : Plus
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-center gap-1.5" aria-hidden>
      <span className="grid gap-1.5">
        {from.map((card) => <MiniCardView key={card.id} card={card} faded={link === 'move'} />)}
      </span>
      <Link className="size-4 text-muted-foreground" />
      <MiniCardView card={to} />
    </span>
  )
}
