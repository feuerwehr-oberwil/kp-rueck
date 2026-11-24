'use client'

/**
 * One entry of the Rapport's Mannschaft, Fahrzeuge or Material list, as a chip
 * (owner pick 1B «Compact chips», 24.11.2026): the name, its muted detail, and a
 * ✕ that takes the entry back out. A list is a `FeldChipList` of these, closed by
 * the dashed «+ Person» chip (`FeldAddPicker`).
 *
 * The ✕ is a real button with its own name («Meier Andrea entfernen»); on a phone
 * the global 44px touch rule sizes it, so the chip grows to a thumb's height
 * rather than hiding the control. A read-only mount passes no `onRemove` and
 * gets a plain chip.
 *
 * The children may be a button when the chip itself opens something – the
 * Material chip's menu («vor Ort verblieben»). The ✕ stays beside it either way,
 * so «remove» is the same tap on every chip.
 */

import type { ReactNode } from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

/** The pill every rapport chip shares – the add chip's dashed one included. */
export const FELD_CHIP_CLASS = 'inline-flex min-h-9 max-w-full items-center gap-1 rounded-full text-sm'

/** The wrapping row of chips. Children are `FeldChip`s and one `<li>` with the add chip. */
export function FeldChipList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-2">
      {children}
    </ul>
  )
}

export function FeldChip({
  children,
  removeLabel,
  onRemove,
}: {
  children: ReactNode
  /** «Meier Andrea entfernen» – the ✕'s accessible name and tooltip. */
  removeLabel: string
  /** Omit for a read-only chip. */
  onRemove?: () => void
}) {
  return (
    <li className={cn(FELD_CHIP_CLASS, 'bg-secondary pl-3', onRemove ? 'pr-0.5' : 'pr-3')}>
      <span className="flex min-w-0 items-center gap-1.5 py-1">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="relative hit-area inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </li>
  )
}
