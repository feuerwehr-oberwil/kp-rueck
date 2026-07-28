'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowDown, ArrowUp, RefreshCw, AlertTriangle, CheckCircle2, Loader2, Copy, Check } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { copyToClipboard } from '@/lib/utils'
import type { SyncStatusResponse, SyncConfig } from '@/types/sync'

interface SyncStatusCardProps {
  status: SyncStatusResponse | null
  isLoading: boolean
  error: string | null
  isStale: boolean
  onSyncComplete?: () => void
}

export function SyncStatusCard({ status, isLoading, error, isStale, onSyncComplete }: SyncStatusCardProps) {
  const t = useTranslations('sync.status')
  const tCommon = useTranslations('sync.common')
  const [isSyncing, setIsSyncing] = useState(false)
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [copied, setCopied] = useState(false)

  // Load config to check if we're on Railway
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const data = await apiClient.getSyncConfig()
        setConfig(data)
      } catch (err) {
        // Ignore errors - config is optional for status display
      }
    }
    loadConfig()
  }, [])

  const handleSyncFromRailway = async () => {
    try {
      setIsSyncing(true)
      const toastId = toast.loading(t('syncingFrom'))
      await apiClient.triggerSyncFromRailway()
      toast.dismiss(toastId)
      toast.success(t('syncFromSuccess'))
      onSyncComplete?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('syncFailed'))
    } finally {
      setIsSyncing(false)
    }
  }

  const handleSyncToRailway = async () => {
    try {
      setIsSyncing(true)
      const toastId = toast.loading(t('syncingTo'))
      await apiClient.triggerSyncToRailway()
      toast.dismiss(toastId)
      toast.success(t('syncToSuccess'))
      onSyncComplete?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('syncFailed'))
    } finally {
      setIsSyncing(false)
    }
  }

  // Determine status badge
  const getStatusBadge = () => {
    if (isLoading) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('loading')}
        </Badge>
      )
    }

    if (error || !status) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {t('error')}
        </Badge>
      )
    }

    if (status.is_syncing || isSyncing) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1 bg-warning text-warning-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {tCommon('syncing')}
        </Badge>
      )
    }

    if (!status.railway_healthy) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {tCommon('railwayOffline')}
        </Badge>
      )
    }

    if (isStale) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1 bg-warning text-warning-foreground">
          <AlertTriangle className="h-3 w-3" />
          {tCommon('stale')}
        </Badge>
      )
    }

    return (
      <Badge variant="secondary" className="flex items-center gap-1 bg-success text-success-foreground">
        <CheckCircle2 className="h-3 w-3" />
        {t('synced')}
      </Badge>
    )
  }

  // Determine direction icon
  const getDirectionIcon = () => {
    if (!status) return null

    if (status.direction === 'from_railway') {
      return <ArrowDown className="h-4 w-4" />
    } else {
      return <ArrowUp className="h-4 w-4" />
    }
  }

  const getDirectionText = () => {
    if (!status) return t('unknown')
    return status.direction === 'from_railway' ? tCommon('fromRailway') : tCommon('toRailway')
  }

  const getLastSyncText = () => {
    if (!status?.last_sync) return tCommon('never')

    try {
      return formatDistanceToNow(new Date(status.last_sync), {
        addSuffix: true,
        locale: de,
      })
    } catch {
      return tCommon('invalid')
    }
  }

  const handleCopyConnectionString = async () => {
    if (!config?.railway_database_url) return

    try {
      await copyToClipboard(config.railway_database_url)
      setCopied(true)
      toast.success(t('copied'))
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      toast.error(t('copyFailed'))
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-medium">{t('title')}</p>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        {getStatusBadge()}
      </div>
      <div className="space-y-4">
        {/* Status Details */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{t('direction')}</p>
            <div className="flex items-center gap-2 mt-1">
              {getDirectionIcon()}
              <span className="font-medium">{getDirectionText()}</span>
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{t('lastSync')}</p>
            <p className="font-medium mt-1">{getLastSyncText()}</p>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Last error display */}
        {status?.last_error && (
          <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">{t('lastError')}</p>
              <p className="text-sm text-destructive mt-1">{status.last_error}</p>
            </div>
          </div>
        )}

        {/* Pending records */}
        {status && status.records_pending > 0 && (
          <div className="flex items-center gap-2 p-3 bg-info/10 border border-info/30 rounded-md">
            <AlertTriangle className="h-4 w-4 text-info" />
            <p className="text-sm text-info">
              {t('pendingRecords', { count: status.records_pending })}
            </p>
          </div>
        )}

        {/* Railway Database Connection String */}
        {config?.railway_database_url && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{t('connectionString')}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 p-2 bg-muted rounded-md font-mono text-xs overflow-hidden">
                <code className="block truncate">{config.railway_database_url}</code>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyConnectionString}
                className="flex-shrink-0"
              >
                {copied ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Manual Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={handleSyncFromRailway}
            disabled={isSyncing || !status?.railway_healthy || isLoading || config?.is_production}
          >
            {isSyncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('syncFromButton')}
          </Button>

          {!status?.railway_healthy && (
            <Button
              variant="default"
              onClick={handleSyncToRailway}
              disabled={isSyncing || isLoading || config?.is_production}
            >
              {isSyncing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
              {t('syncToButton')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
