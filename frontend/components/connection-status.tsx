"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
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
        return "bg-green-500 hover:bg-green-600"
      case "disconnected":
        return "bg-red-500 hover:bg-red-600"
      case "checking":
        return "bg-yellow-500 hover:bg-yellow-600"
    }
  }

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return "Backend Connected"
      case "disconnected":
        return "Backend Offline"
      case "checking":
        return "Checking..."
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Badge className={getStatusColor()}>
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${status === "connected" ? "bg-white animate-pulse" : "bg-white"}`} />
          {getStatusText()}
        </div>
      </Badge>
      <span className="text-xs text-muted-foreground">
        {apiUrl ? new URL(apiUrl).host : 'localhost:8000'}
      </span>
    </div>
  )
}
