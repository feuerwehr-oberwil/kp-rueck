"use client"

import { useState, useEffect } from "react"
import { Clock, Wifi, WifiOff, ArrowLeft, Map, LayoutGrid, BarChart3 } from "lucide-react"
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

  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [tokenEvent, setTokenEvent] = useState<{ name: string; training_flag: boolean } | null>(null)

  useEffect(() => {
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

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

  const eventName = selectedEvent?.name || tokenEvent?.name || "KP Rück"
  const isTraining = selectedEvent?.training_flag || tokenEvent?.training_flag || false

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Thin display header */}
      <header className="flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-3 py-1.5 min-h-10">
        <div className="flex items-center gap-2">
          {/* Back to editor */}
          <Link
            href={isIndexPage ? "/" : "/display"}
            className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted transition-colors"
            title={isIndexPage ? "Zurück zum Editor" : "Display-Übersicht"}
          >
            <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
          </Link>

          <div className="w-px h-5 bg-border" />

          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            {eventName}
          </h1>
          {isTraining && (
            <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded">
              Übung
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Display page tabs (only on sub-pages, not index) */}
          {!isIndexPage && (
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
