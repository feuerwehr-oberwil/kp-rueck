'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowDown, ArrowUp, RefreshCw, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { de } from 'date-fns/locale'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import type { SyncStatusResponse } from '@/types/sync'

interface SyncStatusCardProps {
  status: SyncStatusResponse | null
  isLoading: boolean
  error: string | null
  isStale: boolean
  onSyncComplete?: () => void
}

export function SyncStatusCard({ status, isLoading, error, isStale, onSyncComplete }: SyncStatusCardProps) {
  const [isSyncing, setIsSyncing] = useState(false)

  const handleSyncFromRailway = async () => {
    try {
      setIsSyncing(true)
      const toastId = toast.loading('Synchronisiere von Railway...')
      await apiClient.triggerSyncFromRailway()
      toast.dismiss(toastId)
      toast.success('Erfolgreich von Railway synchronisiert')
      onSyncComplete?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Synchronisation fehlgeschlagen')
    } finally {
      setIsSyncing(false)
    }
  }

  const handleSyncToRailway = async () => {
    try {
      setIsSyncing(true)
      const toastId = toast.loading('Synchronisiere zu Railway...')
      await apiClient.triggerSyncToRailway()
      toast.dismiss(toastId)
      toast.success('Erfolgreich zu Railway synchronisiert')
      onSyncComplete?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Synchronisation fehlgeschlagen')
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
          Lädt...
        </Badge>
      )
    }

    if (error || !status) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Fehler
        </Badge>
      )
    }

    if (status.is_syncing || isSyncing) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1 bg-yellow-500 text-white">
          <Loader2 className="h-3 w-3 animate-spin" />
          Synchronisiert...
        </Badge>
      )
    }

    if (!status.railway_healthy) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Railway Offline
        </Badge>
      )
    }

    if (isStale) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1 bg-orange-500 text-white">
          <AlertTriangle className="h-3 w-3" />
          Daten veraltet
        </Badge>
      )
    }

    return (
      <Badge variant="secondary" className="flex items-center gap-1 bg-green-500 text-white">
        <CheckCircle2 className="h-3 w-3" />
        Synchronisiert
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
    if (!status) return 'Unbekannt'
    return status.direction === 'from_railway' ? 'Von Railway' : 'Zu Railway'
  }

  const getLastSyncText = () => {
    if (!status?.last_sync) return 'Noch nie'

    try {
      return formatDistanceToNow(new Date(status.last_sync), {
        addSuffix: true,
        locale: de,
      })
    } catch {
      return 'Ungültig'
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Synchronisations-Status</CardTitle>
            <CardDescription>
              Live-Status der Datensynchronisation zwischen Railway und Local
            </CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Details */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Richtung</p>
            <div className="flex items-center gap-2 mt-1">
              {getDirectionIcon()}
              <span className="font-medium">{getDirectionText()}</span>
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Letzte Synchronisation</p>
            <p className="font-medium mt-1">{getLastSyncText()}</p>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Last error display */}
        {status?.last_error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">Letzter Fehler:</p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{status.last_error}</p>
            </div>
          </div>
        )}

        {/* Pending records */}
        {status && status.records_pending > 0 && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md">
            <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              {status.records_pending} Datensätze warten auf Synchronisation
            </p>
          </div>
        )}

        {/* Manual Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={handleSyncFromRailway}
            disabled={isSyncing || !status?.railway_healthy || isLoading}
            className="flex items-center gap-2"
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Von Railway synchronisieren
          </Button>

          {!status?.railway_healthy && (
            <Button
              variant="default"
              onClick={handleSyncToRailway}
              disabled={isSyncing || isLoading}
              className="flex items-center gap-2"
            >
              {isSyncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
              Zu Railway synchronisieren
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
