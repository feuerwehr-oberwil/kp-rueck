'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { User } from 'lucide-react'

import { LINK_PAGE_HEADER_CLASS, LINK_PAGE_HEADER_ROW_CLASS } from '@/components/link-page/link-page'
import { Button } from '@/components/ui/button'
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
 * Who this phone is, always on screen.
 *
 * The page is login-less and gets handed around a vehicle, so "which crew am I
 * looking at" is a real question — and it used to be answerable only on the
 * list, which is exactly where somebody is *not* when they are filing. It rides
 * along into the detail view for that reason.
 */
export function FeldIdentityBar({
  name,
  subtitle,
  onNotMe,
  children,
}: {
  name: string
  subtitle?: string | null
  onNotMe?: () => void
  /** Leading control — the detail view puts its back button here. */
  children?: ReactNode
}) {
  const t = useTranslations('feld')
  return (
    // Opaque, no backdrop blur: the bar is the first row under the status bar of the home-screen
    // app, and a frosted bar there read as a blurred strip at the top of the screen whenever the
    // page scrolled under it. The status bar takes the same colour (lib/theme-color.ts).
    <div className={LINK_PAGE_HEADER_CLASS}>
      <div className={LINK_PAGE_HEADER_ROW_CLASS}>
        {children}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
            <User className="size-3.5 text-muted-foreground" />
          </div>
          {/* Fixed height whether or not the name has arrived. The bar is the
              topmost thing on the page, so anything that grows here pushes the
              whole list down after the first paint. */}
          <div className="min-w-0 flex h-8 flex-col justify-center">
            {name ? (
              <div className="truncate text-sm font-semibold leading-tight">{name}</div>
            ) : (
              <div className="h-3.5 w-24 rounded bg-muted" aria-hidden />
            )}
            {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
          </div>
        </div>
        {onNotMe && (
          <Button variant="ghost" size="sm" onClick={onNotMe} className="min-h-11 shrink-0">
            {t('assignments.notMe')}
          </Button>
        )}
      </div>
    </div>
  )
}
