"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Clock, Wifi, WifiOff, ArrowLeft, Map, LayoutGrid, BarChart3, Maximize, Minimize } from "lucide-react"
import { useEvent } from "@/lib/contexts/event-context"
import { useSearchParams, usePathname } from "next/navigation"
import { apiClient } from "@/lib/api-client"
import Link from "next/link"
import { cn } from "@/lib/utils"

const displayPages = [
  { href: "/display/map", label: "Karte", icon: Map },
  { href: "/display/board", label: "Board", icon: LayoutGrid },
  { href: "/display/status", label: "Status", icon: BarChart3 },
]

const HIDE_DELAY = 8000 // ms before header auto-hides

function ConnectionIndicator() {
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
    <div className="flex items-center gap-1.5" title={online ? "Verbunden" : "Verbindung unterbrochen"}>
      {online ? (
        <Wifi className="h-4 w-4 text-emerald-500" />
      ) : (
        <WifiOff className="h-4 w-4 text-red-500 animate-pulse" />
      )}
    </div>
  )
}

export default function DisplayLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { selectedEvent } = useEvent()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const token = searchParams.get("token")
  const isIndexPage = pathname === "/display"
  const isSubPage = !isIndexPage

  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [tokenEvent, setTokenEvent] = useState<{ name: string; training_flag: boolean } | null>(null)
  const [headerVisible, setHeaderVisible] = useState(true)
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

  // Auto-hide header on sub-pages
  const resetHideTimer = useCallback(() => {
    if (!isSubPage) return
    setHeaderVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setHeaderVisible(false), HIDE_DELAY)
  }, [isSubPage])

  useEffect(() => {
    if (!isSubPage) return
    resetHideTimer()

    const onMouseMove = () => resetHideTimer()
    window.addEventListener("mousemove", onMouseMove)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
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
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }

  const eventName = selectedEvent?.name || tokenEvent?.name || "KP Rück"
  const isTraining = selectedEvent?.training_flag || tokenEvent?.training_flag || false

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Header — auto-hides on display sub-pages */}
      <header
        className={cn(
          "flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-3 py-1.5 min-h-10 shrink-0 transition-all duration-300",
          isSubPage && !headerVisible && "-translate-y-full opacity-0 pointer-events-none absolute inset-x-0 top-0 z-50"
        )}
      >
        <div className="flex items-center gap-2">
          <Link
            href={isIndexPage ? "/" : "/display"}
            className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors"
            title={isIndexPage ? "Zurück zum Editor" : "Display-Übersicht"}
          >
            <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
          </Link>

          <div className="w-px h-5 bg-border" />

          <h1 className="text-sm font-semibold tracking-tight text-foreground">{eventName}</h1>
          {isTraining && (
            <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded">
              Übung
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Display page tabs */}
          {isSubPage && (
            <nav className="flex items-center rounded-md border border-border bg-muted/50 p-0.5">
              {displayPages.map((p) => {
                const isActive = pathname === p.href
                return (
                  <Link
                    key={p.href}
                    href={p.href}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium transition-colors",
                      isActive
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <p.icon className="h-3 w-3" />
                    <span>{p.label}</span>
                  </Link>
                )
              })}
            </nav>
          )}

          <div className="w-px h-5 bg-border" />
          <ConnectionIndicator />

          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors"
            title={isFullscreen ? "Vollbild beenden" : "Vollbild"}
          >
            {isFullscreen ? (
              <Minimize className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Maximize className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>

          <div className="flex items-center gap-1.5 rounded-md bg-secondary/50 px-2.5 py-1">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-sm font-semibold tabular-nums">
              {currentTime ? currentTime.toLocaleTimeString("de-DE") : "--:--:--"}
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
