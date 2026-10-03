'use client'

import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The pages a phone opens from «Links & QR» — /feld, /check-in, /reko, /alarm — share one frame
 * so they feel like one app, installed or not (owner, 03.10.):
 *
 * - `LINK_PAGE_VIEWPORT` (lib/link-page-viewport.ts, a server module — layouts export it) +
 *   `LinkPageNoZoom`: no pinch / double-tap / focus zoom (they are laid out
 *   for the phone; a zoomed page only ever leaves somebody stuck half off-screen);
 * - `LinkPageHeader`: ONE header — sticky, opaque (no frosted bar under the status bar), 56px,
 *   the column width of the page, a 44px leading control (back) and a title + context line.
 *   `FeldIdentityBar` is the same bar with the person in it.
 */
/** The class on `<html>` while a link page is mounted (globals.css). */
export const LINK_PAGE_NO_ZOOM_CLASS = 'link-page-no-zoom'

/**
 * The zoom guard, for as long as a link page is mounted: `html.link-page-no-zoom` →
 * `touch-action: pan-x pan-y` (no pinch, no double-tap; scrolling and a map's own JS gestures
 * untouched) and every field at ≥ 16px (no focus zoom); plus iOS's proprietary `gesturestart`
 * cancelled — iOS ignores `userScalable: false` for pinch since iOS 10. Removed on unmount, so a
 * client navigation back to the board gets its zoom back.
 */
export function LinkPageNoZoom() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add(LINK_PAGE_NO_ZOOM_CLASS)
    const block = (event: Event) => event.preventDefault()
    document.addEventListener('gesturestart', block, { passive: false })
    return () => {
      root.classList.remove(LINK_PAGE_NO_ZOOM_CLASS)
      document.removeEventListener('gesturestart', block)
    }
  }, [])
  return null
}

/** The height and padding every link-page header shares — `FeldIdentityBar` included. */
export const LINK_PAGE_HEADER_CLASS = 'sticky top-0 z-30 border-b border-border bg-background'
export const LINK_PAGE_HEADER_ROW_CLASS = 'mx-auto flex min-h-14 max-w-md items-center gap-2 px-3 py-2'

export function LinkPageHeader({
  title,
  subtitle,
  leading,
  trailing,
  className,
}: {
  title: ReactNode
  /** The context line: the Ereignis, «Übung», who is filing. */
  subtitle?: ReactNode
  /** A back button — give it `min-h-11`. */
  leading?: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <header data-slot="link-page-header" className={cn(LINK_PAGE_HEADER_CLASS, className)}>
      <div className={LINK_PAGE_HEADER_ROW_CLASS}>
        {leading}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {trailing}
      </div>
    </header>
  )
}
