'use client'

/**
 * The phone's Ereignis pill (owner picks 1A + 2A, phone sweep 24.11.2026): «<Ereignis> ⌄» at the
 * top of every page that shows the bottom nav, with the Übung tag where it applies. It IS the
 * menu, like KP Front's Einsatz pill: the open Ereignis, the others to switch to, «Alle
 * Ereignisse», then Einstellungen and Hilfe, then who is signed in and «Abmelden».
 *
 * Phone only (`md:hidden`): the desk has its event switcher and user menu in the header.
 * Switching is navigation, not editing – the phone board stays read-only (owner, 14.11.2026), so
 * there is no «Neues Ereignis» here.
 *
 * The board puts the pill first in its own phone head; every other page puts `PhoneEventHead`
 * above its header – the pill in the same 16px inset, on the header's surface.
 */

import { Calendar, ChevronDown, ChevronRight, HelpCircle, LogOut, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AccountBlock } from '@/components/auth/account-block'
import { TrainingBadge } from '@/components/training-mode-chrome'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { topLoading } from '@/components/ui/top-loading-bar'
import { VersionLabel } from '@/components/version-label'
import { useAuth } from '@/lib/contexts/auth-context'
import { useEvent } from '@/lib/contexts/event-context'
import { formatDateTime, formatTime } from '@/lib/format-time'
import { useLogout } from '@/lib/hooks/use-logout'
import { cn } from '@/lib/utils'

/** How many other Ereignisse the menu offers before «Alle Ereignisse» (the most recently active). */
const OTHER_EVENTS = 5

const ROW = 'min-h-11 gap-3 px-2 text-sm'
const HEADING = 'pt-3 text-xs font-medium text-muted-foreground'

/** «DB» for «Demo Bearbeiter»: the first letters of the first two words. */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')

export function PhoneEventPill({ className }: { className?: string }) {
  const t = useTranslations('nav.eventPill')
  const tAccount = useTranslations('nav.account')
  const { isAuthenticated, user } = useAuth()
  const { selectedEvent, events, setSelectedEvent } = useEvent()
  const { requestLogout, logoutDialog } = useLogout()
  const pathname = usePathname()

  if (!isAuthenticated) return null

  const name = selectedEvent?.name ?? t('noEvent')
  const training = !!selectedEvent?.training_flag
  const otherEvents = events
    .filter((e) => !e.archived_at && e.id !== selectedEvent?.id)
    .sort((a, b) => b.last_activity_at.getTime() - a.last_activity_at.getTime())
    .slice(0, OTHER_EVENTS)
  const since = selectedEvent
    ? selectedEvent.created_at.toDateString() === new Date().toDateString()
      ? formatTime(selectedEvent.created_at)
      : formatDateTime(selectedEvent.created_at)
    : null

  /** A page of the app: the row is the link; the loading bar starts on the tap (#2), and the
   *  page the operator is on is marked, as «Mehr» marked it. */
  const pageRow = (href: string, label: string, Icon: LucideIcon) => {
    const current = pathname === href
    return (
      <DropdownMenuItem asChild className={cn(ROW, current && 'bg-secondary')}>
        <Link
          href={href}
          aria-current={current ? 'page' : undefined}
          onNavigate={() => {
            if (!current) topLoading.startRoute()
          }}
        >
          <Icon aria-hidden />
          <span>{label}</span>
        </Link>
      </DropdownMenuItem>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('menu', { name })}
            className={cn(
              'group inline-flex min-h-11 max-w-full items-center gap-2 self-start rounded-full border bg-muted/60 py-1.5 pl-4 pr-3 text-left touch-manipulation md:hidden',
              className,
            )}
          >
            <span className="min-w-0 truncate text-base font-bold tracking-tight" title={name}>
              {name}
            </span>
            {training && <TrainingBadge label={t('training')} />}
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} className="w-[calc(100vw-1rem)] max-w-sm p-2">
          {/* The open Ereignis: a card, not a row – it is where you are, not where you go. */}
          {selectedEvent && (
            <div className="mb-1 rounded-lg border bg-muted/50 px-3 py-2.5">
              <p className="flex flex-wrap items-center gap-2 text-lg font-bold leading-snug tracking-tight">
                <span className="min-w-0 break-words">{selectedEvent.name}</span>
                {training && <TrainingBadge label={t('training')} />}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t('since', { time: since ?? '' })} · {t('incidents', { count: selectedEvent.incident_count })}
              </p>
            </div>
          )}

          {otherEvents.length > 0 && <DropdownMenuLabel className={HEADING}>{t('switch')}</DropdownMenuLabel>}
          {otherEvents.map((event) => (
            <DropdownMenuItem key={event.id} className={ROW} onSelect={() => setSelectedEvent(event)}>
              <ChevronRight aria-hidden />
              {/* Wrapped, not cut: two Ereignisse can share a long prefix */}
              <span className="min-w-0 flex-1 break-words">{event.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {event.training_flag ? `${t('training')} · ${event.incident_count}` : event.incident_count}
              </span>
            </DropdownMenuItem>
          ))}
          {pageRow('/events', t('allEvents'), Calendar)}

          <DropdownMenuSeparator className="my-2" />
          <DropdownMenuLabel className={HEADING}>{t('app')}</DropdownMenuLabel>
          {pageRow('/settings', t('settings'), Settings)}
          {pageRow('/help', t('help'), HelpCircle)}

          <DropdownMenuSeparator className="my-2" />
          {/* Who is signed in, and the way out – as on KP Front's pill. */}
          <div className="flex items-center gap-3 px-2 py-1">
            {user && (
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold"
              >
                {initialsOf(user.display_name?.trim() || user.username)}
              </span>
            )}
            <AccountBlock className="flex-1" />
            <DropdownMenuItem onSelect={requestLogout} className="min-h-11 shrink-0 gap-2 rounded-md border px-3">
              <LogOut aria-hidden />
              {tAccount('logout')}
            </DropdownMenuItem>
          </div>
          <VersionLabel className="px-2 pt-1" />
        </DropdownMenuContent>
      </DropdownMenu>
      {logoutDialog}
    </>
  )
}

/** The pill as a row of its own, above a page's header (Lagekarte, Ereignisse, Einstellungen,
 *  Hilfe, Übungs-Steuerung). `className` gives it the header's surface. */
export function PhoneEventHead({ className }: { className?: string }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return null
  return (
    <div className={cn('flex px-4 pt-3 md:hidden', className)}>
      <PhoneEventPill />
    </div>
  )
}
