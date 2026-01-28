"use client"

import { useEffect, useState } from "react"
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client"
import { cn } from "@/lib/utils"
import { WifiOff, Wifi, Loader2, AlertCircle } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function WebSocketStatus() {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected')

  useEffect(() => {
    // Subscribe to status changes
    const unsubscribe = wsClient.onStatusChange(setStatus)

    // Cleanup
    return unsubscribe
  }, [])

  const getStatusIcon = () => {
    switch (status) {
      case 'connecting':
        return <Loader2 className="h-4 w-4 animate-spin" />
      case 'connected':
        return <Wifi className="h-4 w-4" />
      case 'disconnected':
        return <WifiOff className="h-4 w-4" />
      case 'error':
        return <AlertCircle className="h-4 w-4" />
    }
  }

  const getStatusText = () => {
    switch (status) {
      case 'connecting':
        return 'Verbindung wird hergestellt...'
      case 'connected':
        return 'Echtzeit-Updates aktiv'
      case 'disconnected':
        return 'Offline - Polling aktiv'
      case 'error':
        return 'Verbindungsfehler - Polling aktiv'
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'connecting':
        return 'text-yellow-600 dark:text-yellow-400'
      case 'connected':
        return 'text-green-600 dark:text-green-400'
      case 'disconnected':
        return 'text-gray-600 dark:text-gray-400'
      case 'error':
        return 'text-red-600 dark:text-red-400'
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            "bg-gray-100 dark:bg-gray-800",
            getStatusColor()
          )}>
            {getStatusIcon()}
            <span className="hidden sm:inline">{getStatusText()}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">
            {status === 'connected'
              ? 'Änderungen werden in Echtzeit übertragen'
              : status === 'connecting'
              ? 'Verbindung zum Server wird hergestellt'
              : 'Daten werden alle 5 Sekunden aktualisiert'}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
