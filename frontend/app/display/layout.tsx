"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useTranslations } from "next-intl"
import { useIntlLocale } from "@/lib/date-locale"
import { Clock, Wifi, WifiOff, ArrowLeft, Map, LayoutGrid, BarChart3, Maximize, Minimize, Eye, CalendarRange, Hourglass } from "lucide-react"
import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useSearchParams, usePathname } from "next/navigation"
import { apiClient } from "@/lib/api-client"
import { usePolling } from "@/lib/hooks/use-polling"
import { isTypingTarget } from "@/lib/typing-target"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { WALL_TEXT_WRAP } from "@/lib/kanban-utils"
import { SearchInput } from "@/components/ui/search-input"
import { Kbd } from "@/components/ui/kbd"
import { DisplaySearchProvider, useDisplaySearch } from "@/lib/contexts/display-search-context"
import { TrainingBand, TrainingBadge } from "@/components/training-mode-chrome"
import { useDisplayErrorRecovery } from "@/components/display-error"
import { RouteSlot } from "@/components/route-slot"
import { useWallIdle } from "@/components/display/use-wall-idle"
import { usePointerFine } from "@/lib/hooks/use-pointer-fine"
import { useIsMobile } from "@/components/ui/use-mobile"
import { useReplaceRoute } from "@/lib/hooks/use-replace-route"

import { useViewerFeed, ViewerPayloadContext } from "@/lib/hooks/use-viewer-situation"
import { DisplayStaleBanner } from "@/components/display/display-stale-banner"
import { LoadingStatus } from "@/components/ui/shell-loader"

const displayPages = [
  { href: "/display/map", labelKey: "pageMap", icon: Map },
  { href: "/display/board", labelKey: "pageBoard", icon: LayoutGrid },
  { href: "/display/status", labelKey: "pageStatus", icon: BarChart3 },
  // The one page built for a tablet in the hand rather than a wall: crews waiting at the station.
  { href: "/display/bereitschaft", labelKey: "pageStandby", icon: Hourglass },
] as const

/** Which display pages filter on the top bar's search field. */
const SEARCHABLE_PAGES = ["/display/board", "/display/status", "/display/bereitschaft"]

/** True while any Radix dialog is open on the page (the incident detail, mostly). */
function isModalOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  )
}

function SessionConnectionIndicator() {
  const [online, setOnline] = useState(true)
  const check = useCallback(async () => {
    try {
      setOnline((await apiClient.getAllSettings()) !== undefined)
    } catch {
      setOnline(false)
    }
  }, [])
  usePolling(check, { intervalMs: 15000, pauseWhenHidden: false })
  return <ConnectionIndicator online={online} />
}

function ConnectionIndicator({ online }: { online: boolean }) {
  const t = useTranslations('display')
  return (
    <div className="flex items-center gap-1.5" title={online ? t('layout.connected') : t('layout.disconnected')}>
      {online ? (
        <Wifi className="h-4 w-4 text-success" />
      ) : (
        <WifiOff className="h-4 w-4 text-destructive animate-pulse" />
      )}
    </div>
  )
}

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  const token = useSearchParams().get("token")
  return (
    <DisplaySearchProvider>
      <DisplayChrome key={token} token={token}>{children}</DisplayChrome>
    </DisplaySearchProvider>
  )
}

function DisplayChrome({
  children, token,
}: {
  children: React.ReactNode
  token: string | null
}) {
  const t = useTranslations('display')
  const intlLocale = useIntlLocale()
  const { selectedEvent } = useEvent()
  const pathname = usePathname()
  const { isAuthenticated, loading: authLoading } = useAuth()
  const feed = useViewerFeed(token)
  const tCommon = useTranslations("common")
  const isIndexPage = pathname === "/display"
  const isMobile = useIsMobile()
  const isSubPage = !isIndexPage

  // The display views exist for a wall screen behind a login, or for a share link behind a
  // token. Reached with neither, they used to render a single line of text on an otherwise
  // empty page — and on the demo the global welcome dialog then sat on top of it, promising
  // things a read-only display cannot do. Send those visitors to the front door instead.
  //
  // Waits for `authLoading`: the session resolves asynchronously, and redirecting before it
  // does would bounce somebody who IS logged in.
  const mayView = !!token || isAuthenticated
  // The QR viewer link on a phone opens its board, not the four-mode picker (phone sweep
  // 24.11.2026, field.8: four unexplained buttons were the first thing a QR viewer saw); the
  // bottom tabs reach the other three. Decided here, before the token's feed has answered.
  const toTokenBoard = token && isIndexPage && isMobile ? `/display/board?token=${token}` : null
  useReplaceRoute(!authLoading && !mayView ? "/" : toTokenBoard)

  // Clears the error-boundary retry backoff once this display has been up and
  // healthy for a while, so an unrelated fault hours later starts from the
  // shortest retry delay instead of the capped one.
  useDisplayErrorRecovery()

  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { query, setQuery } = useDisplaySearch()
  const isSearchable = SEARCHABLE_PAGES.includes(pathname)
  const searchRef = useRef<HTMLInputElement>(null)
  // The search's own row below `lg` (the bar has no room for it there): a phone or tablet
  // viewer searches the board too (phone sweep 24.11.2026, crosscheck A1).
  const rowSearchRef = useRef<HTMLInputElement>(null)

  // Idle chrome (owner pick U5 B): after 10 s without a mouse move or a key, the
  // back arrow and the search field fade IN PLACE – opacity, not display, so the
  // Ereignis name and everything else in the bar stay exactly where they are. The
  // first mouse move or key («S» focuses the search in that same keystroke) brings
  // them back. A search in force never fades: a filtered wall must say so, and a
  // field holding the caret stays (`focus-within`). Under reduced motion it is a
  // cut, not a fade.
  //
  // Only where a pointer can move: on a touch screen (a tablet at the station)
  // nothing wakes the chrome but a tap, and a tap on a faded back arrow would
  // navigate. There the controls stay, at 44px.
  const pointerFine = usePointerFine()
  const chromeIdle = useWallIdle() && !query && pointerFine
  const idleChromeClass = cn(
    "transition-opacity duration-500 motion-reduce:transition-none",
    // No `pointer-events-none`: a pointer can only reach them by moving, which wakes them.
    chromeIdle && "opacity-0 focus-within:opacity-100",
  )

  // `s` (or `/`) jumps to the search field — the same two keys as the main
  // board, so somebody who walks from the KP to the wall screen does not have to
  // learn a second habit. Registered only where there IS a field to focus, and
  // never while a dialog is up or a field already has the caret: on a display
  // that is running unattended, a stray keystroke must do nothing at all.
  useEffect(() => {
    if (!isSearchable) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" && e.key !== "s" && e.key !== "S") return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target) || isModalOpen()) return
      e.preventDefault()
      // whichever of the two fields this width shows (a hidden one has no offsetParent)
      const field = searchRef.current?.offsetParent ? searchRef.current : rowSearchRef.current
      field?.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isSearchable])

  // Clock
  useEffect(() => {
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // The bar used to slide away after 8s of no mouse movement. It no longer
  // does: it is the ONLY bar now (the board pages had a second, near-identical
  // header of their own), and it carries the two things people read a wall
  // display for from across the room — which Ereignis, and what time it is.
  // A screen nobody touches would have hidden both within eight seconds. What
  // fades now is only the back arrow and the search field (`chromeIdle` above).

  // Fullscreen tracking
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const toggleFullscreen = () => {
    // Both APIs reject (rather than throw) when the browser refuses — no user
    // gesture, or a permissions-policy block. Swallow it: an unhandled
    // rejection helps nobody on a wall display.
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  const event = token ? feed.snapshot?.payload.event : selectedEvent
  const eventName = event?.name || "KP Rück"
  const isTraining = event?.training_flag ?? false
  // A logged-in display with no Ereignis picked draws empty columns and calls
  // itself «KP Rück», which reads as "nothing is happening" rather than "nothing
  // is selected" — and the only way out was an unlabelled ← that says «zurück».
  // The title becomes the way out, but ONLY in that state: once an Ereignis is
  // chosen the heading is a heading again, so nobody switches what a whole room
  // is watching by clicking near it. The picker itself is on /display.
  const needsEventPick = !token && isAuthenticated && !selectedEvent

  return (
    // `h-full`, NOT `h-dvh`. This mounts inside `AppShell`'s <main>, which is a
    // flex child of an `h-dvh` column that the banners above it have already
    // taken a slice out of (DemoBanner, StaleDataBanner, IncidentTruncation…).
    // Asking for the full viewport height there pushed the whole display chrome
    // down by exactly the banner height — with a 37px banner the board's bottom
    // landed at 1117 against a 1080 viewport. The banner that matters most is
    // the stale-data one, which fires precisely when a wall display has lost its
    // connection. `h-full` takes the height <main> actually has.
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Übung: the same warning strip the board carries, so a glance from the
          wall to the KP confirms itself. Fixed to the top of the viewport, so it
          needs no `order-first` to stay above the control bar that goes
          `order-last` on mobile, and it costs this column no height. */}
      {isTraining && <TrainingBand />}
      {/* Control bar — on top at every width. Pinned: it is the only bar the display
          pages have, and on a share link it also carries the «Nur Ansicht» badge
          that used to sit in a second header of its own.
          Token/viewer mode omits the back link so there's no path to the editor.
          From `sm` up the two things read across the room – which Ereignis, what
          time – are pinned in px (Ereignis 18/600, clock 20/600 mono), and so is
          the bar's 44px: the wall boards fit their root size (use-wall-fit), and
          a rem bar made the name 12px on a full board (hill climb r19).
          On a phone (below `md`, the app's phone breakpoint) the page tabs move to a
          bar of their own at the bottom, with their words (`PhoneDisplayTabs`); below
          `sm` the name keeps one line (phone sweep 24.11.2026, field.8 – it wrapped to
          three). */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-header px-3 py-1 min-h-11 sm:min-h-[44px] shrink-0">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          {!token && (
            // One box for the arrow and its divider, so the idle fade has one
            // target; `gap-2` is the row's own gap, so nothing moves.
            <div className={cn("flex items-center gap-2 shrink-0", idleChromeClass)}>
              <Link
                href={isIndexPage ? "/" : "/display"}
                className="flex items-center justify-center h-7 w-7 pointer-coarse:size-11 shrink-0 rounded-sm hover:bg-muted transition-colors"
                title={isIndexPage ? t('layout.backToEditor') : t('layout.displayOverview')}
              >
                <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>

              <div className="w-px h-5 bg-border shrink-0" />
            </div>
          )}

          {needsEventPick ? (
            <Link
              href="/display"
              className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-sm border border-warning/30 bg-warning/10 px-2 py-0.5 text-sm font-semibold tracking-tight text-warning-foreground transition-colors hover:bg-warning/20"
            >
              <CalendarRange className="h-3.5 w-3.5 shrink-0" />
              {t('layout.selectEvent')}
            </Link>
          ) : (
            <h1
              title={eventName}
              className={cn("min-w-0 max-sm:truncate text-base sm:text-[18px] sm:leading-[24px] font-semibold tracking-tight text-foreground", WALL_TEXT_WRAP)}
            >
              {eventName}
            </h1>
          )}
          {isTraining && <TrainingBadge label={t('layout.training')} />}
          {/* Was a panel of its own on the share-link board, under a header that
              repeated the Ereignis name this one already carries. */}
          {token && (
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground shrink-0">
              <Eye className="h-3.5 w-3.5" />
              {t('layout.readOnly')}
            </span>
          )}

          {/* The board's own search, in the bar rather than in a row of its own:
              a wall display has no vertical space to spare, and this is the same
              predicate the main board filters with. */}
          {isSearchable && (
            <SearchInput
              ref={searchRef}
              size="sm"
              value={query}
              onValueChange={setQuery}
              placeholder={t('layout.searchPlaceholder')}
              // From lg up only: at 768 the bar had ~30px left for it, «Suchen …» cut to «Su»
              // and the Ereignis name squeezed to an ellipsis (overflow sweep, 03.10.).
              containerClassName={cn("ml-2 hidden w-64 shrink-0 lg:block", idleChromeClass)}
              className="h-7 text-sm"
              // The «S» shortcut is a keyboard's; a touch screen has none to press.
              hint={pointerFine ? <Kbd>S</Kbd> : undefined}
            />
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Display page tabs (from `md`; the phone has its bottom bar) */}
          {isSubPage && (
            <nav className="hidden md:flex items-center rounded-md border border-border bg-muted/50 p-0.5">
              {displayPages.map((p) => {
                const isActive = pathname === p.href
                return (
                  <Link
                    key={p.href}
                    href={token ? `${p.href}?token=${token}` : p.href}
                    className={cn(
                      // Caption-sized at 12px whatever the wall's root size: a
                      // rem `text-xs` read 10.5px on a board fitted to 14px.
                      "relative hit-area flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-sm text-[12px] leading-[16px] font-medium transition-colors",
                      // Touch: a 44px target and a label at reading size.
                      "pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:sm:text-[14px]",
                      isActive
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title={t(`layout.${p.labelKey}`)}
                    aria-label={t(`layout.${p.labelKey}`)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <p.icon className="h-3.5 w-3.5 pointer-coarse:size-4" />
                    {/* A tablet in portrait has no room for four 44px tabs with
                        their words and the Ereignis name: there only the page
                        one is on keeps its word, the others are their icon. */}
                    <span className={cn("hidden sm:inline", !isActive && "pointer-coarse:max-lg:hidden")}>{t(`layout.${p.labelKey}`)}</span>
                  </Link>
                )
              })}
            </nav>
          )}

          <div className="hidden md:block w-px h-5 bg-border" />

          {/* Utility icons — grouped for consistent visual weight */}
          <div className="flex items-center gap-0.5">
            <div className="flex h-7 w-7 items-center justify-center">
              {token ? <ConnectionIndicator online={feed.status === 'ready'} /> : <SessionConnectionIndicator />}
            </div>
            <button
              onClick={toggleFullscreen}
              className="hidden sm:flex items-center justify-center h-7 w-7 pointer-coarse:size-11 rounded-sm hover:bg-muted transition-colors"
              title={isFullscreen ? t('layout.exitFullscreen') : t('layout.fullscreen')}
            >
              {isFullscreen ? (
                <Minimize className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Maximize className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 rounded-sm bg-secondary/50 px-2.5 py-0.5">
            <Clock className="size-[16px] text-muted-foreground" />
            <span className="font-mono text-[20px] leading-[28px] font-semibold tabular-nums">
              {currentTime ? currentTime.toLocaleTimeString(intlLocale) : "--:--:--"}
            </span>
          </div>
        </div>
      </header>

      {isSearchable && (
        <div className={cn("shrink-0 border-b border-border bg-header px-3 py-2 lg:hidden", idleChromeClass)}>
          <SearchInput
            ref={rowSearchRef}
            value={query}
            onValueChange={setQuery}
            placeholder={t('layout.searchPlaceholder')}
            hint={pointerFine ? <Kbd>S</Kbd> : undefined}
          />
        </div>
      )}

      {token && feed.snapshot && <DisplayStaleBanner lastRefresh={feed.snapshot.received} />}
      <main className="flex-1 overflow-hidden">
        {/* Nothing is rendered while the redirect above is in flight — a flash of the display
            chrome would be the same wrong promise, just briefer. */}
        {/* In a RouteSlot, never straight in <main>: React error #418 on a cold load (route-slot.tsx). */}
        {token && !feed.snapshot ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground">
            {feed.status === 'loading'
              ? <LoadingStatus size="surface">{tCommon('loading')}</LoadingStatus>
              : <p role="status">{feed.status === 'invalid' ? t('tokenBoard.invalidLink') : t('common.retrying')}</p>}
          </div>
        ) : (
          <ViewerPayloadContext.Provider value={feed.snapshot?.payload ?? null}>
            <RouteSlot>{mayView || authLoading ? children : null}</RouteSlot>
          </ViewerPayloadContext.Provider>
        )}
      </main>

      {isSubPage && <PhoneDisplayTabs pathname={pathname} token={token} />}
    </div>
  )
}

/** The page tabs on a phone (below `md`): a bottom bar under the thumb, each glyph with its
 *  word – like the phone shell's tabs and KP Front's (phone sweep 24.11.2026, field.8: four bare
 *  glyphs told a QR viewer nothing). */
function PhoneDisplayTabs({ pathname, token }: { pathname: string; token: string | null }) {
  const t = useTranslations('display')
  return (
    <nav
      aria-label={t('layout.pagesNav')}
      className="grid shrink-0 grid-cols-4 gap-1 border-t border-border bg-card px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {displayPages.map((p) => {
        const isActive = pathname === p.href
        return (
          <Link
            key={p.href}
            href={token ? `${p.href}?token=${token}` : p.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg py-2 transition-colors touch-manipulation",
              isActive ? "bg-foreground/[0.09] text-foreground" : "text-muted-foreground",
            )}
          >
            <p.icon className="size-5" aria-hidden />
            <span className={cn("max-w-full truncate text-xs font-medium", isActive && "font-semibold")}>
              {t(`layout.${p.labelKey}`)}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
