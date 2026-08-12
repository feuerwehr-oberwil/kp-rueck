"use client"

import { useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Clock, Wifi, WifiOff, ArrowLeft, Map, LayoutGrid, BarChart3, Maximize, Minimize, Eye } from "lucide-react"
import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useSearchParams, usePathname, useRouter } from "next/navigation"
import { apiClient } from "@/lib/api-client"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { SearchInput } from "@/components/ui/search-input"
import { DisplaySearchProvider, useDisplaySearch } from "@/lib/contexts/display-search-context"
import { useDisplayErrorRecovery } from "@/components/display-error"

const displayPages = [
  { href: "/display/map", labelKey: "pageMap", icon: Map },
  { href: "/display/board", labelKey: "pageBoard", icon: LayoutGrid },
  { href: "/display/status", labelKey: "pageStatus", icon: BarChart3 },
] as const

/** Which display pages filter on the top bar's search field. */
const SEARCHABLE_PAGES = ["/display/board", "/display/status"]

function ConnectionIndicator({ token }: { token: string | null }) {
  const t = useTranslations('display')
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const check = async () => {
      try {
        // Probe something THIS viewer can actually reach. `getAllSettings` is authenticated,
        // so on a share-token display it failed every single time and the icon sat
        // permanently red — the only warning these screens had was stuck crying wolf, which
        // is worse than no indicator at all: a real alert next to it reads as more noise.
        if (token) await apiClient.getViewerData(token)
        else await apiClient.getAllSettings()
        setOnline(true)
      } catch {
        setOnline(false)
      }
    }
    check()
    const interval = setInterval(check, 15000)
    return () => clearInterval(interval)
  }, [token])

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
  return (
    <DisplaySearchProvider>
      <DisplayChrome>{children}</DisplayChrome>
    </DisplaySearchProvider>
  )
}

function DisplayChrome({
  children,
}: {
  children: React.ReactNode
}) {
  const t = useTranslations('display')
  const { selectedEvent } = useEvent()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const { isAuthenticated, loading: authLoading } = useAuth()
  const token = searchParams.get("token")
  const isIndexPage = pathname === "/display"
  const isSubPage = !isIndexPage

  // The display views exist for a wall screen behind a login, or for a share link behind a
  // token. Reached with neither, they used to render a single line of text on an otherwise
  // empty page — and on the demo the global welcome dialog then sat on top of it, promising
  // things a read-only display cannot do. Send those visitors to the front door instead.
  //
  // Waits for `authLoading`: the session resolves asynchronously, and redirecting before it
  // does would bounce somebody who IS logged in.
  const mayView = !!token || isAuthenticated
  useEffect(() => {
    if (authLoading || mayView) return
    router.replace("/")
  }, [authLoading, mayView, router])

  // Clears the error-boundary retry backoff once this display has been up and
  // healthy for a while, so an unrelated fault hours later starts from the
  // shortest retry delay instead of the capped one.
  useDisplayErrorRecovery()

  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [tokenEvent, setTokenEvent] = useState<{ name: string; training_flag: boolean } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { query, setQuery } = useDisplaySearch()
  const isSearchable = SEARCHABLE_PAGES.includes(pathname)

  // Clock
  useEffect(() => {
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Token event loading
  useEffect(() => {
    if (!token) return
    const loadTokenEvent = async () => {
      try {
        const data = await apiClient.getViewerData(token)
        setTokenEvent({ name: data.event.name, training_flag: data.event.training_flag })
      } catch { /* silent */ }
    }
    loadTokenEvent()
  }, [token])

  // The bar used to slide away after 8s of no mouse movement. It no longer
  // does: it is the ONLY bar now (the board pages had a second, near-identical
  // header of their own), and it carries the two things people read a wall
  // display for from across the room — which Ereignis, and what time it is.
  // A screen nobody touches would have hidden both within eight seconds.

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

  const eventName = selectedEvent?.name || tokenEvent?.name || "KP Rück"
  const isTraining = selectedEvent?.training_flag || tokenEvent?.training_flag || false

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Control bar — top navbar on desktop, bottom bar on mobile (order-last
          keeps it thumb-reachable there). Pinned: it is the only bar the display
          pages have, and on a share link it also carries the «Nur-Lesen» badge
          that used to sit in a second header of its own.
          Token/viewer mode omits the back link so there's no path to the editor. */}
      <header className="order-last sm:order-first flex items-center justify-between gap-3 border-t sm:border-t-0 sm:border-b border-border bg-card/50 backdrop-blur-sm px-3 py-2 sm:py-1.5 min-h-10 shrink-0">
        <div className="flex flex-1 items-center gap-2 min-w-0">
          {!token && (
            <>
              <Link
                href={isIndexPage ? "/" : "/display"}
                className="hidden sm:flex items-center justify-center h-7 w-7 shrink-0 rounded-md hover:bg-muted transition-colors"
                title={isIndexPage ? t('layout.backToEditor') : t('layout.displayOverview')}
              >
                <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>

              <div className="hidden sm:block w-px h-5 bg-border shrink-0" />
            </>
          )}

          <h1 className="min-w-0 max-w-[42vw] sm:max-w-none text-sm font-semibold tracking-tight text-foreground truncate">{eventName}</h1>
          {isTraining && (
            <span className="text-[11px] sm:text-xs font-medium text-warning-foreground bg-warning/10 border border-warning/20 px-1.5 sm:px-2 py-0.5 rounded shrink-0">
              {t('layout.training')}
            </span>
          )}
          {/* Was a panel of its own on the share-link board, under a header that
              repeated the Ereignis name this one already carries. */}
          {token && (
            <span className="hidden items-center gap-1.5 rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 sm:inline-flex dark:text-blue-400 shrink-0">
              <Eye className="h-3.5 w-3.5" />
              {t('layout.readOnly')}
            </span>
          )}

          {/* The board's own search, in the bar rather than in a row of its own:
              a wall display has no vertical space to spare, and this is the same
              predicate the main board filters with. */}
          {isSearchable && (
            <SearchInput
              size="sm"
              value={query}
              onValueChange={setQuery}
              placeholder={t('layout.searchPlaceholder')}
              containerClassName="ml-2 hidden w-40 shrink md:block lg:w-64"
              className="h-7 text-sm"
            />
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Display page tabs */}
          {isSubPage && (
            <nav className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
              {displayPages.map((p) => {
                const isActive = pathname === p.href
                return (
                  <Link
                    key={p.href}
                    href={token ? `${p.href}?token=${token}` : p.href}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-sm text-xs font-medium transition-colors",
                      isActive
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title={t(`layout.${p.labelKey}`)}
                  >
                    <p.icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t(`layout.${p.labelKey}`)}</span>
                  </Link>
                )
              })}
            </nav>
          )}

          <div className="w-px h-5 bg-border" />

          {/* Utility icons — grouped for consistent visual weight */}
          <div className="flex items-center gap-0.5">
            <div className="flex h-7 w-7 items-center justify-center">
              <ConnectionIndicator token={token} />
            </div>
            <button
              onClick={toggleFullscreen}
              className="hidden sm:flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors"
              title={isFullscreen ? t('layout.exitFullscreen') : t('layout.fullscreen')}
            >
              {isFullscreen ? (
                <Minimize className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Maximize className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 rounded-md bg-secondary/50 px-2.5 py-1">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-sm font-semibold tabular-nums">
              {currentTime ? currentTime.toLocaleTimeString("de-CH") : "--:--:--"}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {/* Nothing is rendered while the redirect above is in flight — a flash of the display
            chrome would be the same wrong promise, just briefer. */}
        {mayView || authLoading ? children : null}
      </main>
    </div>
  )
}
