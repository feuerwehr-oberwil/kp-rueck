"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
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
  const t = useTranslations('common.websocketStatus')
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
        return t('connecting')
      case 'connected':
        return t('connected')
      case 'disconnected':
        return t('disconnected')
      case 'error':
        return t('error')
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'connecting':
        return 'text-warning-foreground'
      case 'connected':
        return 'text-success'
      case 'disconnected':
        return 'text-muted-foreground'
      case 'error':
        return 'text-destructive'
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            "bg-muted",
            getStatusColor()
          )}>
            {getStatusIcon()}
            <span className="hidden sm:inline">{getStatusText()}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">
            {status === 'connected'
              ? t('tooltipConnected')
              : status === 'connecting'
              ? t('tooltipConnecting')
              : t('tooltipPolling')}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
