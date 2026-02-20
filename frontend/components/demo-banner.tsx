'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { apiClient } from '@/lib/api-client'
import { X } from 'lucide-react'

interface DemoStatus {
  demo: boolean
  next_reset: string | null
  seconds_until_reset: number
  reset_interval_hours: number
}

export function DemoBanner() {
  const [demoStatus, setDemoStatus] = useState<DemoStatus | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number>(0)
  const [dismissed, setDismissed] = useState(false)
  const [showResetOverlay, setShowResetOverlay] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    const status = await apiClient.getDemoStatus()
    if (status) {
      setDemoStatus(status)
      setSecondsLeft(status.seconds_until_reset)
    }
  }, [])

  // Initial fetch + periodic refresh
  useEffect(() => {
    fetchStatus()
    const statusInterval = setInterval(fetchStatus, 30000) // every 30s
    return () => clearInterval(statusInterval)
  }, [fetchStatus])

  // Client-side countdown
  useEffect(() => {
    if (!demoStatus) return

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setShowResetOverlay(true)
          // Reload page after 5 seconds
          setTimeout(() => window.location.reload(), 5000)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [demoStatus])

  // Listen for WebSocket demo_reset message
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'demo_reset') {
          setShowResetOverlay(true)
          setTimeout(() => window.location.reload(), 3000)
        }
      } catch {
        // ignore non-JSON messages
      }
    }

    // Socket.IO uses its own transport, so we listen for custom events
    // The banner will rely on the countdown hitting 0 as primary trigger
    // WebSocket broadcast is a bonus for instant detection

    return () => {
      // cleanup if needed
    }
  }, [])

  // Don't render if not in demo mode
  if (!demoStatus) return null

  // Reset overlay
  if (showResetOverlay) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-sm">
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full mx-auto" />
          <h2 className="text-xl font-semibold text-foreground">Demo wird zurückgesetzt...</h2>
          <p className="text-muted-foreground text-sm">Die Seite wird in wenigen Sekunden neu geladen.</p>
        </div>
      </div>
    )
  }

  if (dismissed) return null

  const minutes = Math.floor(secondsLeft / 60)
  const hours = Math.floor(minutes / 60)
  const displayMinutes = minutes % 60

  let timeText: string
  if (hours > 0) {
    timeText = `${hours}h ${displayMinutes}min`
  } else if (minutes > 0) {
    timeText = `${minutes} min`
  } else {
    timeText = `${secondsLeft}s`
  }

  return (
    <div className="flex-shrink-0 z-50 flex items-center justify-center gap-2 bg-amber-500/90 px-4 py-1.5 text-sm font-medium text-amber-950 backdrop-blur-sm">
      <span>
        Demo-Modus — wird in {timeText} zurückgesetzt
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-2 rounded p-0.5 hover:bg-amber-600/30 transition-colors"
        aria-label="Banner schliessen"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
