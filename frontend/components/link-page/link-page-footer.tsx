'use client'

import { useRef, type ReactNode } from 'react'
import { useNavReserve } from '@/components/viewport-insets'
import { cn } from '@/lib/utils'

/**
 * The fixed foot of a link page: the page's one next action stays on screen while it scrolls
 * (phone sweep 24.11.2026 – /feld Schadenplatz 6C, /reko 9C; KP Front's phone-form footer).
 * `status` is the line above the action: which step this is, what the KP has.
 *
 * It publishes its height as `--nav-reserve` (it is these pages' bottom bar), so the toast lane
 * clears it and a page root with `pb-nav-reserve` scrolls its last line out from under it.
 *
 * While the keyboard is up it steps aside, so the field being typed in keeps the screen – unless
 * the focus is inside the footer: then it stands on the keys (`--kb-inset`, lib/viewport-insets).
 *
 * `liveStatus` makes the status line a polite live region – for a line that changes because of
 * the footer's own action (a report sent), not for one that ticks on its own.
 */
export function LinkPageFooter({
  status,
  liveStatus = false,
  children,
  className,
}: {
  status?: ReactNode
  liveStatus?: boolean
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useNavReserve(ref)
  return (
    <div
      ref={ref}
      data-slot="link-page-footer"
      className={cn(
        'fixed inset-x-0 bottom-0 z-sticky border-t border-border bg-card pt-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom,0px))]',
        '[:root[data-kb]_&]:bottom-[var(--kb-inset,0px)] [:root[data-kb]_&]:pb-2.5 [:root[data-kb]_&:not(:focus-within)]:hidden',
        className,
      )}
    >
      <div className="mx-auto max-w-md space-y-2 px-4">
        {status && (
          <div className="min-w-0 text-sm" {...(liveStatus ? { role: 'status', 'aria-live': 'polite' as const } : {})}>
            {status}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
