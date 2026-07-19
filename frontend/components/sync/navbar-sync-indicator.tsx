'use client'

import { ArrowDown, ArrowUp, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { getDateFnsLocale } from '@/lib/date-locale'
import { useSyncStatus } from '@/lib/hooks/use-sync-status'
import { useRailwayRecovery } from '@/lib/hooks/use-railway-recovery'

/**
 * Compact sync status indicator for the navbar.
 * Shows a colored dot, direction arrow, and last sync time on hover.
 */
export function NavbarSyncIndicator() {
  const t = useTranslations('sync')
  const { status, isLoading, error, isStale } = useSyncStatus()
  useRailwayRecovery(status)

  // Determine status color and icon
  const getStatusDot = () => {
    if (isLoading) {
      return <div className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
    }

    if (error || !status) {
      return <div className="h-2 w-2 rounded-full bg-destructive" />
    }

    if (status.is_syncing) {
      return <div className="h-2 w-2 rounded-full bg-warning animate-pulse" />
    }

    if (!status.railway_healthy) {
      return <div className="h-2 w-2 rounded-full bg-destructive" />
    }

    if (isStale) {
      return <div className="h-2 w-2 rounded-full bg-warning" />
    }

    return <div className="h-2 w-2 rounded-full bg-success" />
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
    if (isLoading) return t('navbar.loadingStatus')
    if (error) return t('navbar.error', { error })
    if (!status) return t('navbar.noStatus')

    const lastSync = status.last_sync
      ? formatDistanceToNow(new Date(status.last_sync), { addSuffix: true, locale: getDateFnsLocale() })
      : t('common.never')

    if (!status.railway_healthy) {
      return t('navbar.offlineLastSync', { lastSync })
    }

    if (isStale) {
      return t('navbar.staleLastSync', { lastSync })
    }

    if (status.is_syncing) {
      return t('common.syncing')
    }

    return t('navbar.syncedAt', { lastSync })
  }

  return (
    <Link
      href="/settings?section=sync"
      className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-muted transition-colors group"
      title={getTooltipText()}
    >
      {getStatusDot()}
      {getDirectionIcon()}
      <span className="text-sm text-muted-foreground hidden md:inline">
        {status?.last_sync
          ? formatDistanceToNow(new Date(status.last_sync), { addSuffix: true, locale: getDateFnsLocale() })
          : t('common.never')}
      </span>
    </Link>
  )
}
