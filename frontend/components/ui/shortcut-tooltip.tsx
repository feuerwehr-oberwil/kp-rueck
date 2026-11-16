'use client'

import type { ReactElement } from 'react'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A control's name in the app's ink tooltip, with its keyboard shortcut as key caps beside it –
 * how the desktop board teaches its keys at the moment of use (owner pick «A», 16.11.2026).
 *
 *   <ShortcutTooltip label="Tagebuch" keys={['J']}><Button … /></ShortcutTooltip>
 *   <ShortcutTooltip label="Board" keys={['G', 'B']}>…</ShortcutTooltip>   // a chord: G, then B
 *
 * It replaces the control's native `title` (don't set both: two tooltips). The child keeps its
 * own `aria-label`; the tooltip is for the eye. `keys` may be omitted for a control without a
 * shortcut, so a toolbar can use one tooltip for every item.
 */
export function ShortcutTooltip({
  label,
  keys,
  side = 'top',
  children,
}: {
  label: string
  keys?: readonly string[]
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactElement
}) {
  return (
    // 300ms: quick enough to read while reaching for the control, slow enough that sweeping the
    // mouse across the footer does not flash a tooltip per pill.
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={6} className="flex items-center gap-2">
        <span>{label}</span>
        {keys && keys.length > 0 && (
          <KbdGroup>
            {keys.map((key, i) => (
              <Kbd key={`${i}-${key}`}>{key}</Kbd>
            ))}
          </KbdGroup>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
