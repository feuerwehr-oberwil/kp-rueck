"use client"

import { useState, useEffect } from "react"
import { Clock, Wifi, WifiOff } from "lucide-react"
import { useEvent } from "@/lib/contexts/event-context"
import { useSearchParams } from "next/navigation"
import { apiClient } from "@/lib/api-client"

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
  const token = searchParams.get("token")

  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [tokenEvent, setTokenEvent] = useState<{ name: string; training_flag: boolean } | null>(null)

  // Clock
  useEffect(() => {
    setCurrentTime(new Date())
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // If using viewer token, load event info
  useEffect(() => {
    if (!token) return
    const loadTokenEvent = async () => {
      try {
        const data = await apiClient.getViewerData(token)
        setTokenEvent({ name: data.event.name, training_flag: data.event.training_flag })
      } catch {
        // Silent fail — header will just show fallback
      }
    }
    loadTokenEvent()
  }, [token])

  const eventName = selectedEvent?.name || tokenEvent?.name || "KP Rück"
  const isTraining = selectedEvent?.training_flag || tokenEvent?.training_flag || false

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Thin display header */}
      <header className="flex items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-4 py-1.5 min-h-10">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            {eventName}
          </h1>
          {isTraining && (
            <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded">
              Übung
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <ConnectionIndicator />
          <div className="flex items-center gap-1.5 rounded-md bg-secondary/50 px-2.5 py-1">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-sm font-semibold tabular-nums">
              {currentTime ? currentTime.toLocaleTimeString("de-DE") : "--:--:--"}
            </span>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
