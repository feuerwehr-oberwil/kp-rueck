'use client'

import type { ComponentProps } from 'react'
import { Bell } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { TodoState } from '@/lib/hooks/use-todos'
import { cn } from '@/lib/utils'

/**
 * The bell (bell round 24.11.2026): it must be seen, or to-dos are missed.
 *
 * - To-dos open → an amber button with the number («3 zu erledigen»). The phone has no header
 *   bell: its «Meldungen» tile shows the same amber / red count (mobile-bottom-navigation.tsx). One open longer than 5' → red edge and text, and it pulses (motion-safe only). Red is
 *   never a fill here: a filled red button reads as the thing to press (DESIGN.md «Colour roles»).
 * - Nothing to do → the plain bell; unread Meldungen are a grey dot, never a number: if every
 *   FYI line counted, the number would never be 0 and nobody would trust it.
 *
 * All other props go to the `Button`, so a Sheet/Popover trigger can wrap it (`asChild`).
 */
export function BellButton({
  state,
  pressed = false,
  className,
  ...props
}: { state: Pick<TodoState, 'count' | 'overdue' | 'unreadMessages'>; pressed?: boolean } & ComponentProps<
  typeof Button
>) {
  const t = useTranslations('notifications.todo')
  const tSidebar = useTranslations('notifications.sidebar')
  if (state.count > 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        aria-label={t('bellAria', { count: state.count })}
        aria-pressed={pressed}
        className={cn(
          'gap-1.5 border-2 border-warning bg-warning px-2.5 font-semibold text-foreground hover:bg-warning/85',
          state.overdue && 'border-destructive bg-card text-destructive motion-safe:animate-pulse hover:bg-card',
          className,
        )}
        {...props}
      >
        <Bell className="size-4" aria-hidden="true" />
        <span className="tabular-nums text-base leading-none">{state.count}</span>
        <span className="text-xs">{t('bellLabel')}</span>
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={tSidebar('bellAria', {
        unread: state.unreadMessages > 0 ? tSidebar('bellUnread', { count: state.unreadMessages }) : '',
      })}
      aria-pressed={pressed}
      className={cn('relative', pressed && 'bg-muted', className)}
      {...props}
    >
      <Bell className="size-4 md:size-5" />
      {state.unreadMessages > 0 && (
        <span className="absolute right-2 top-2 size-2 rounded-full bg-muted-foreground" aria-hidden="true" />
      )}
    </Button>
  )
}
