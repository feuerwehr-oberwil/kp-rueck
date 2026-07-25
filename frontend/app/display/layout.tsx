"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Clock, Wifi, WifiOff, ArrowLeft, Map, LayoutGrid, BarChart3, Maximize, Minimize } from "lucide-react"
import { useEvent } from "@/lib/contexts/event-context"
import { useSearchParams, usePathname } from "next/navigation"
import { apiClient } from "@/lib/api-client"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { useDisplayErrorRecovery } from "@/components/display-error"

const displayPages = [
  { href: "/display/map", labelKey: "pageMap", icon: Map },
  { href: "/display/board", labelKey: "pageBoard", icon: LayoutGrid },
  { href: "/display/status", labelKey: "pageStatus", icon: BarChart3 },
] as const

const HIDE_DELAY = 8000 // ms before header auto-hides

function ConnectionIndicator() {
  const t = useTranslations('display')
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const check = async () => {
      try {
        await apiClient.getAllSettings()
        setOnline(true)
      } catch {
        setOnline(false)
      }
    }
    check()
    const interval = setInterval(check, 15000)
    return () => clearInterval(interval)
  }, [])

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

export default function DisplayLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const t = useTranslations('display')
  const { selectedEvent } = useEvent()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const token = searchParams.get("token")
  const isIndexPage = pathname === "/display"
  const isSubPage = !isIndexPage

  // Clears the error-boundary retry backoff once this display has been up and
  // healthy for a while, so an unrelated fault hours later starts from the
  // shortest retry delay instead of the capped one.
  useDisplayErrorRecovery()

  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [tokenEvent, setTokenEvent] = useState<{ name: string; training_flag: boolean } | null>(null)
  const [barVisible, setBarVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)

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

  // Auto-hide the control bar on sub-pages
  const resetHideTimer = useCallback(() => {
    if (!isSubPage) return
    setBarVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setBarVisible(false), HIDE_DELAY)
  }, [isSubPage])

  useEffect(() => {
    if (!isSubPage) return
    resetHideTimer()

    const onActivity = () => resetHideTimer()
    window.addEventListener("mousemove", onActivity)
    window.addEventListener("touchstart", onActivity)
    return () => {
      window.removeEventListener("mousemove", onActivity)
      window.removeEventListener("touchstart", onActivity)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [isSubPage, resetHideTimer])

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
          keeps it thumb-reachable there). Auto-hides on sub-pages (desktop only;
          on mobile it stays pinned — it's the only nav there).
          Token/viewer mode omits the back link so there's no path to the editor. */}
      <header
        className={cn(
          "order-last sm:order-first flex items-center justify-between gap-3 border-t sm:border-t-0 sm:border-b border-border bg-card/50 backdrop-blur-sm px-3 py-2 sm:py-1.5 min-h-10 shrink-0 transition-all duration-300",
          isSubPage && !barVisible && "sm:-translate-y-full sm:opacity-0 sm:pointer-events-none sm:absolute sm:inset-x-0 sm:top-0 sm:z-50"
        )}
      >
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
            <span className="text-[11px] sm:text-xs font-medium text-warning bg-warning/10 border border-warning/20 px-1.5 sm:px-2 py-0.5 rounded shrink-0">
              {t('layout.training')}
            </span>
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
              <ConnectionIndicator />
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
        {children}
      </main>
    </div>
  )
}
