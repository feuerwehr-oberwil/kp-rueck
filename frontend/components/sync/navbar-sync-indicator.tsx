'use client'

import { ArrowDown, ArrowUp, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import Link from 'next/link'
import { useSyncStatus } from '@/lib/hooks/use-sync-status'
import { useRailwayRecovery } from '@/lib/hooks/use-railway-recovery'

/**
 * Compact sync status indicator for the navbar.
 * Shows a colored dot, direction arrow, and last sync time on hover.
 */
export function NavbarSyncIndicator() {
  const { status, isLoading, error, isStale } = useSyncStatus()
  useRailwayRecovery(status)

  // Determine status color and icon
  const getStatusDot = () => {
    if (isLoading) {
      return <div className="h-2 w-2 rounded-full bg-gray-400 animate-pulse" />
    }

    if (error || !status) {
      return <div className="h-2 w-2 rounded-full bg-red-500" />
    }

    if (status.is_syncing) {
      return <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
    }

    if (!status.railway_healthy) {
      return <div className="h-2 w-2 rounded-full bg-red-500" />
    }

    if (isStale) {
      return <div className="h-2 w-2 rounded-full bg-orange-500" />
    }

    return <div className="h-2 w-2 rounded-full bg-green-500" />
  }

  const getDirectionIcon = () => {
    if (!status) return null

    if (status.is_syncing) {
      return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
    }

    if (status.direction === 'from_railway') {
      return <ArrowDown className="h-3 w-3 text-muted-foreground" />
    } else {
      return <ArrowUp className="h-3 w-3 text-muted-foreground" />
    }
  }

  const getTooltipText = () => {
    if (isLoading) return 'Lade Status...'
    if (error) return `Fehler: ${error}`
    if (!status) return 'Kein Status verfügbar'

    const lastSync = status.last_sync
      ? formatDistanceToNow(new Date(status.last_sync), { addSuffix: true, locale: de })
      : 'Noch nie'

    if (!status.railway_healthy) {
      return `Railway Offline • Letzte Sync: ${lastSync}`
    }

    if (isStale) {
      return `Daten veraltet • Letzte Sync: ${lastSync}`
    }

    if (status.is_syncing) {
      return 'Synchronisiert...'
    }

    return `Synchronisiert • ${lastSync}`
  }

  return (
    <Link
      href="/settings?tab=sync"
      className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-accent transition-colors group"
      title={getTooltipText()}
    >
      {getStatusDot()}
      {getDirectionIcon()}
      <span className="text-sm text-muted-foreground hidden md:inline">
        {status?.last_sync
          ? formatDistanceToNow(new Date(status.last_sync), { addSuffix: true, locale: de })
          : 'Noch nie'}
      </span>
    </Link>
  )
}
