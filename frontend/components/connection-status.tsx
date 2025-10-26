"use client"

import { useEffect, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { getApiUrl } from "@/lib/env"

export function ConnectionStatus() {
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking")
  const [lastCheck, setLastCheck] = useState<Date>(new Date())
  const [apiUrl] = useState(getApiUrl())

  const checkConnection = async () => {
    try {
      const response = await fetch(`${apiUrl}/health`)
      if (response.ok) {
        setStatus("connected")
      } else {
        setStatus("disconnected")
      }
    } catch (error) {
      console.error("Backend health check failed:", error)
      setStatus("disconnected")
    }
    setLastCheck(new Date())
  }

  useEffect(() => {
    // Initial check
    checkConnection()

    // Check every 30 seconds
    const interval = setInterval(checkConnection, 30000)

    return () => clearInterval(interval)
  }, [])

  const getStatusColor = () => {
    switch (status) {
      case "connected":
        return "bg-zinc-500"
      case "disconnected":
        return "bg-red-500"
      case "checking":
        return "bg-yellow-500"
    }
  }

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return "Connected"
      case "disconnected":
        return "Offline"
      case "checking":
        return "Checking..."
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`h-3 w-3 rounded-full ${getStatusColor()} ${status === "connected" ? "animate-pulse" : ""} cursor-pointer transition-all hover:scale-110`}
          aria-label="Backend connection status"
        />
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Backend Status</span>
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
              <span className="text-sm">{getStatusText()}</span>
            </div>
          </div>
          <div className="border-t pt-2 space-y-1">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Backend URL:</span>
              <div className="mt-1 font-mono text-xs break-all">
                {apiUrl}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Last check:</span> {formatTime(lastCheck)}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
