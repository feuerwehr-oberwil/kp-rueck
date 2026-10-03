'use client'

/**
 * SearchInput — the board's one search field: magnifier on the left, a clear
 * button on the right as soon as there is anything to clear.
 *
 * Every search box in the app used to be the same three lines copy-pasted (a
 * `relative` wrapper, an absolutely positioned `<Search>`, an `<Input pl-9>`),
 * which meant emptying a filter was a keyboard-only move — select-all, delete.
 * Not everyone at the KP does that, and a filter you can't see how to switch off
 * is a filter that quietly hides incidents.
 *
 * `size` only controls the ornaments (icon size and the padding reserved for
 * them); the field height still comes from `Input`, so `className` overrides
 * behave exactly as they did before — on a desk.
 *
 * On a phone (≤768px) or any coarse pointer (a tablet at the KP) the field is
 * at least 44px tall with 16px text whatever the caller's `className` says:
 * iOS zooms the whole page into anything smaller the moment it is focused, and
 * the ✕ becomes a full 44px square instead of a 20px glyph. The sizes are
 * floors (`min-h-*`), so a caller that is already bigger (check-in's `h-12`)
 * keeps its height.
 *
 * Focus is the `Input` primitive's own ring (`ring` token) — one look for every
 * field; a search box does not get an animated ring of its own.
 *
 * `count`: an optional live read-out at the end («3 Treffer»), announced
 * politely so a screen reader hears what the typing did.
 */

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type SearchInputSize = 'sm' | 'default' | 'lg'

// `pad` is the start side; `padEnd` is the room for the ✕ (or the hint), reserved only while
// one is there — kept always, it cut short placeholders: «Einstellung suchen …» lost 9px to an
// empty clear slot in the Einstellungen sidebar (overflow sweep, 03.10.).
const ORNAMENTS: Record<SearchInputSize, { icon: string; left: string; pad: string; padEnd: string; clear: string; clearIcon: string; hint: string }> = {
  // Dense sidebar filters (personnel/materials lists).
  // The icon sits where every other field's first glyph starts (the shared
  // `--field-px` inset + the 1px border, globals.css); the text follows
  // icon + 8px after it. `padEnd` (the ✕/hint room) is applied only while one is shown.
  sm: { icon: 'h-3.5 w-3.5', left: 'left-[calc(var(--field-px)+1px)]', pad: 'pl-[calc(var(--field-px)+1.375rem)]', padEnd: 'pr-8', clear: 'size-7', clearIcon: 'h-3 w-3', hint: 'right-2' },
  default: { icon: 'h-4 w-4', left: 'left-[calc(var(--field-px)+1px)]', pad: 'pl-[calc(var(--field-px)+1.5rem)]', padEnd: 'pr-9', clear: 'size-8', clearIcon: 'h-3.5 w-3.5', hint: 'right-2.5' },
  // Phone surfaces (check-in), where the field is taller.
  lg: { icon: 'h-5 w-5', left: 'left-[calc(var(--field-px)+1px)]', pad: 'pl-[calc(var(--field-px)+1.75rem)]', padEnd: 'pr-11', clear: 'size-11', clearIcon: 'h-4 w-4', hint: 'right-3' },
}

/** Phone / touch floors — see the header. Variants, so they outrank a caller's
 *  unprefixed `h-8 text-sm` exactly where it matters and nowhere else. */
const TOUCH_FIELD = 'max-md:min-h-11 max-md:text-base pointer-coarse:min-h-11 pointer-coarse:text-base'
const TOUCH_END = 'max-md:pr-11 pointer-coarse:pr-11'
const TOUCH_CLEAR = 'max-md:size-11 pointer-coarse:size-11'

export interface SearchInputProps
  extends Omit<React.ComponentProps<'input'>, 'onChange' | 'value' | 'type' | 'size'> {
  value: string
  onValueChange: (value: string) => void
  /** Classes for the positioning wrapper (width, margins, …). */
  containerClassName?: string
  size?: SearchInputSize
  /** Shown in the right slot while the field is empty — the keyboard-shortcut
   *  Kbd on the board. It yields to the clear button once there is text, since
   *  by then the operator has found the field and needs the way back out. */
  hint?: React.ReactNode
  /** A live read-out at the field's end — «3 Treffer». Shown while non-empty. */
  count?: React.ReactNode
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    { value, onValueChange, containerClassName, className, size = 'default', disabled, hint, count, ...props },
    ref,
  ) {
    const t = useTranslations('kanban.common')
    const o = ORNAMENTS[size]
    const inner = React.useRef<HTMLInputElement>(null)
    React.useImperativeHandle(ref, () => inner.current as HTMLInputElement)

    const hasValue = value.length > 0
    const showCount = count != null && count !== '' && count !== false
    // something sits at the field's end: the ✕ (a value), the shortcut hint, or the count
    const reserveEnd = (hasValue && !disabled) || !!hint || showCount

    return (
      <div className={cn('relative', containerClassName)}>
        <Search
          className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', o.icon, o.left)}
          aria-hidden
        />
        <Input
          ref={inner}
          type="text"
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
          className={cn(o.pad, reserveEnd ? o.padEnd : 'pr-[var(--field-px)]', className, size !== 'lg' && TOUCH_FIELD, size !== 'lg' && reserveEnd && TOUCH_END, showCount && 'pr-24 max-md:pr-24 pointer-coarse:pr-28')}
          // A search box is never a credential. Without this, a browser that has
          // saved a KP login drops the username into the nearest text input the
          // moment a password field appears elsewhere on the page — opening
          // Einstellungen → Synchronisation typed «admin» into this field and
          // filtered the section list down to nothing. Before `...props`, so a
          // caller can still override it.
          autoComplete="off"
          {...props}
        />
        {hint && !hasValue && (
          // A flex box, not a bare div: an inline <kbd> child would sit on the
          // text baseline and float a pixel high of center. The inset mirrors
          // the magnifier's, not the clear button's — the button carries its
          // own p-1, the chip doesn't.
          <div className={cn('pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center', o.hint)}>
            {hint}
          </div>
        )}
        {(showCount || (hasValue && !disabled)) && (
          <div className="absolute inset-y-0 right-0 flex items-center">
            {showCount && (
              <span
                aria-live="polite"
                data-slot="search-count"
                className={cn('pointer-events-none text-xs tabular-nums text-muted-foreground', !(hasValue && !disabled) && 'pr-3')}
              >
                {count}
              </span>
            )}
            {hasValue && !disabled && (
              <button
                type="button"
                // Clearing must not cost the field its focus — the operator is
                // mid-search, and refocusing by hand is the friction we removed.
                // On a phone a blur would also fold the keyboard away on the way
                // to an empty field they are about to type into.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onValueChange('')
                  inner.current?.focus()
                }}
                aria-label={t('clearSearch')}
                title={t('clearSearch')}
                className={cn(
                  'flex shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  o.clear,
                  size !== 'lg' && TOUCH_CLEAR,
                )}
              >
                <X className={o.clearIcon} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    )
  },
)
