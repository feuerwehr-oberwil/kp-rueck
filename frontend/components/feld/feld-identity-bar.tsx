'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown } from 'lucide-react'

import { LINK_PAGE_HEADER_CLASS, LINK_PAGE_HEADER_ROW_CLASS } from '@/components/link-page/link-page'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { clearCookie, readCookie, writeCookie } from '@/lib/cookie'

/**
 * Where the device's own name is kept, readable from `/feld` AND `/reko`.
 *
 * Path-scoped to "/" unlike the other `/feld` cookies, because a Reko auftrag
 * navigates OUT of `/feld` into the form and the bar has to keep saying who is
 * filing. It holds a name the person just picked off a list on their own
 * phone — no token, no id, nothing a log would want.
 */
export const FELD_NAME_COOKIE = 'feld-person-name'

const FELD_NAME_SCOPE = { path: '/', days: 7 }

// The name is free text, so it is URI-encoded on the way in and decoded on the way out.
export function readFeldName(): string | null {
  const raw = readCookie(FELD_NAME_COOKIE)
  return raw ? decodeURIComponent(raw) : null
}

export function writeFeldName(name: string) {
  writeCookie(FELD_NAME_COOKIE, encodeURIComponent(name), FELD_NAME_SCOPE)
}

export function clearFeldName() {
  clearCookie(FELD_NAME_COOKIE, FELD_NAME_SCOPE)
}

/**
 * «Sa 14.11.» — the Ereignis' day for the header's second line, in the device's
 * language (`intlLocale` from `useIntlLocale`). The date is the Ereignis' own
 * (when it was opened), not today's, so a night that runs past midnight keeps
 * its date. `''` when there is none or it does not parse.
 */
export function formatEventDay(value: string | null | undefined, intlLocale: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  // de-CH writes «Sa», fr-CH «sam.» — the dot goes, the day and the date read as one word pair.
  const weekday = date.toLocaleDateString(intlLocale, { weekday: 'short' }).replace(/\.$/, '')
  const day = date.toLocaleDateString(intlLocale, { day: '2-digit', month: '2-digit' })
  return `${weekday} ${day}`
}

/**
 * Who this phone is, always on screen — the /feld header (owner pick 1A, 14.11.2026).
 *
 * The page is login-less and gets handed around a vehicle, so "which crew am I
 * looking at" is a real question on every screen, the detail four taps deep
 * included. The bar is meta only, one row high: the way back (`children`), the
 * name over one quiet line («Sturm Oberwil · Sa 14.11.»), and `trailing` on the
 * right — /feld puts the ink «+» for «Neuer Schadenplatz» there. Everything
 * about the Schadenplatz itself is in the page's main card, not up here.
 *
 * With `onNotMe` the name is a menu: what this person was given tonight
 * (`roleLine`, «Fahrer TLF 1») and «Nicht ich». /reko passes neither and gets
 * the plain name.
 */
export function FeldIdentityBar({
  name,
  subtitle,
  roleLine,
  onNotMe,
  trailing,
  children,
}: {
  name: string
  subtitle?: string | null
  /** What the KP gave this person tonight — shown at the top of the name menu. */
  roleLine?: string | null
  onNotMe?: () => void
  /** Right-hand control: the «Neuer Schadenplatz» button on /feld. */
  trailing?: ReactNode
  /** Leading control — the detail view puts its back button here. */
  children?: ReactNode
}) {
  const t = useTranslations('feld')
  // Fixed height whether or not the name has arrived. The bar is the topmost
  // thing on the page, so anything that grows here pushes the whole list down
  // after the first paint.
  const nameLine = name ? (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate text-sm font-semibold leading-tight">{name}</span>
      {onNotMe && <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </span>
  ) : (
    <span className="block h-3.5 w-24 rounded bg-muted" aria-hidden />
  )
  const lines = (
    <>
      {nameLine}
      {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
    </>
  )

  return (
    // Opaque, no backdrop blur: the bar is the first row under the status bar of the home-screen
    // app, and a frosted bar there read as a blurred strip at the top of the screen whenever the
    // page scrolled under it. The status bar takes the same colour (lib/theme-color.ts).
    // A <header> (the page's banner), like the shared LinkPageHeader on the picker.
    <header data-slot="feld-identity-bar" className={LINK_PAGE_HEADER_CLASS}>
      <div className={LINK_PAGE_HEADER_ROW_CLASS}>
        {children}
        {onNotMe && name ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="-mx-1.5 flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center rounded-md px-1.5 text-left"
              >
                {lines}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              {roleLine && (
                <>
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{roleLine}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem className="min-h-11" onSelect={onNotMe}>
                {t('assignments.notMe')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">{lines}</div>
        )}
        {trailing}
      </div>
    </header>
  )
}
