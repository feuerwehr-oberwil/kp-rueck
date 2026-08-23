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
 * behave exactly as they did before.
 */

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type SearchInputSize = 'sm' | 'default' | 'lg'

const ORNAMENTS: Record<SearchInputSize, { icon: string; left: string; pad: string; clear: string; clearIcon: string; hint: string }> = {
  // Dense sidebar filters (personnel/materials lists).
  sm: { icon: 'h-3.5 w-3.5', left: 'left-2.5', pad: 'pl-8 pr-8', clear: 'right-1', clearIcon: 'h-3 w-3', hint: 'right-2' },
  default: { icon: 'h-4 w-4', left: 'left-3', pad: 'pl-9 pr-9', clear: 'right-1.5', clearIcon: 'h-3.5 w-3.5', hint: 'right-2.5' },
  // Phone surfaces (check-in), where the field is taller.
  lg: { icon: 'h-5 w-5', left: 'left-3', pad: 'pl-10 pr-10', clear: 'right-2', clearIcon: 'h-4 w-4', hint: 'right-3' },
}

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
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    { value, onValueChange, containerClassName, className, size = 'default', disabled, hint, ...props },
    ref,
  ) {
    const t = useTranslations('kanban.common')
    const o = ORNAMENTS[size]
    const inner = React.useRef<HTMLInputElement>(null)
    React.useImperativeHandle(ref, () => inner.current as HTMLInputElement)

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
          className={cn(o.pad, className)}
          // A search box is never a credential. Without this, a browser that has
          // saved a KP login drops the username into the nearest text input the
          // moment a password field appears elsewhere on the page — opening
          // Einstellungen → Synchronisation typed «admin» into this field and
          // filtered the section list down to nothing. Before `...props`, so a
          // caller can still override it.
          autoComplete="off"
          {...props}
        />
        {hint && value.length === 0 && (
          // A flex box, not a bare div: an inline <kbd> child would sit on the
          // text baseline and float a pixel high of center. The inset mirrors
          // the magnifier's, not the clear button's — the button carries its
          // own p-1, the chip doesn't.
          <div className={cn('pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center', o.hint)}>
            {hint}
          </div>
        )}
        {value.length > 0 && !disabled && (
          <button
            type="button"
            // Clearing must not cost the field its focus — the operator is
            // mid-search, and refocusing by hand is the friction we removed.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onValueChange('')
              inner.current?.focus()
            }}
            aria-label={t('clearSearch')}
            title={t('clearSearch')}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              o.clear,
            )}
          >
            <X className={o.clearIcon} />
          </button>
        )}
      </div>
    )
  },
)
