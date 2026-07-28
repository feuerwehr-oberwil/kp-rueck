'use client'

import { useState, useEffect, Fragment } from 'react'
import { useTranslations } from 'next-intl'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ArrowDown, ArrowUp, CheckCircle2, XCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import type { SyncHistoryEntry } from '@/types/sync'
import { Button } from '@/components/ui/button'

interface SyncHistoryCardProps {
  refreshTrigger?: number
}

export function SyncHistoryCard({ refreshTrigger }: SyncHistoryCardProps) {
  const t = useTranslations('sync.history')
  const tCommon = useTranslations('sync.common')
  const [history, setHistory] = useState<SyncHistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadHistory()
  }, [refreshTrigger])

  const loadHistory = async () => {
    try {
      setIsLoading(true)
      const data = await apiClient.getSyncHistory(10) // Last 10 syncs
      setHistory(data)
    } catch (error) {
      toast.error(t('loadFailed'))
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedRows(newExpanded)
  }

  const getStatusBadge = (status: SyncHistoryEntry['status']) => {
    switch (status) {
      case 'success':
        return (
          <Badge variant="secondary" className="bg-success text-success-foreground flex items-center gap-1 w-fit">
            <CheckCircle2 className="h-3 w-3" />
            {t('statusSuccess')}
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="destructive" className="flex items-center gap-1 w-fit">
            <XCircle className="h-3 w-3" />
            {t('statusFailed')}
          </Badge>
        )
      case 'partial':
        return (
          <Badge variant="secondary" className="bg-warning text-warning-foreground flex items-center gap-1 w-fit">
            <AlertTriangle className="h-3 w-3" />
            {t('statusPartial')}
          </Badge>
        )
      case 'syncing':
        return (
          <Badge variant="secondary" className="bg-warning text-warning-foreground flex items-center gap-1 w-fit">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('statusRunning')}
          </Badge>
        )
    }
  }

  const getDirectionIcon = (direction: SyncHistoryEntry['sync_direction']) => {
    return direction === 'from_railway' ? (
      <ArrowDown className="h-4 w-4" />
    ) : (
      <ArrowUp className="h-4 w-4" />
    )
  }

  const getDirectionText = (direction: SyncHistoryEntry['sync_direction']) => {
    return direction === 'from_railway' ? tCommon('fromRailway') : tCommon('toRailway')
  }

  const formatTimestamp = (timestamp: string) => {
    try {
      return format(new Date(timestamp), 'dd.MM.yyyy HH:mm:ss', { locale: de })
    } catch {
      return tCommon('invalid')
    }
  }

  const formatRecordsSynced = (records: SyncHistoryEntry['records_synced']) => {
    if (!records) return t('none')

    const entries = Object.entries(records).filter(([_, count]) => count && count > 0)
    if (entries.length === 0) return t('none')

    return entries.map(([type, count]) => {
      const typeNames: Record<string, string> = {
        incidents: t('typeNames.incidents'),
        personnel: t('typeNames.personnel'),
        vehicles: t('typeNames.vehicles'),
        materials: t('typeNames.materials'),
        settings: t('typeNames.settings'),
      }
      return `${count} ${typeNames[type] || type}`
    }).join(', ')
  }

  return (
    <Card className="p-6">
      <div className="space-y-1 mb-4">
        <p className="font-medium">{t('title')}</p>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {t('empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>{t('colTimestamp')}</TableHead>
                  <TableHead>{t('colDirection')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colRecords')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((entry) => {
                  const isExpanded = expandedRows.has(entry.id)
                  return (
                    <Fragment key={entry.id}>
                      <TableRow className="cursor-pointer" onClick={() => toggleRow(entry.id)}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={isExpanded ? t('collapseRow') : t('expandRow')}
                          >
                            {isExpanded ? (
                              <ChevronUp className="size-3.5" />
                            ) : (
                              <ChevronDown className="size-3.5" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">
                          {formatTimestamp(entry.started_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getDirectionIcon(entry.sync_direction)}
                            <span>{getDirectionText(entry.sync_direction)}</span>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(entry.status)}</TableCell>
                        <TableCell className="text-sm">
                          {formatRecordsSynced(entry.records_synced)}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={5} className="bg-muted/50">
                            <div className="py-3 px-4 space-y-2">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <span className="font-medium">{t('startedAt')}</span>{' '}
                                  {formatTimestamp(entry.started_at)}
                                </div>
                                {entry.completed_at && (
                                  <div>
                                    <span className="font-medium">{t('completedAt')}</span>{' '}
                                    {formatTimestamp(entry.completed_at)}
                                  </div>
                                )}
                              </div>
                              {entry.records_synced && (
                                <div>
                                  <span className="font-medium text-sm">{t('details')}</span>
                                  <div className="grid grid-cols-2 gap-2 mt-1 text-sm text-muted-foreground">
                                    {entry.records_synced.incidents !== undefined && (
                                      <div>{t('typeNames.incidents')}: {entry.records_synced.incidents}</div>
                                    )}
                                    {entry.records_synced.personnel !== undefined && (
                                      <div>{t('typeNames.personnel')}: {entry.records_synced.personnel}</div>
                                    )}
                                    {entry.records_synced.vehicles !== undefined && (
                                      <div>{t('typeNames.vehicles')}: {entry.records_synced.vehicles}</div>
                                    )}
                                    {entry.records_synced.materials !== undefined && (
                                      <div>{t('typeNames.materials')}: {entry.records_synced.materials}</div>
                                    )}
                                    {entry.records_synced.settings !== undefined && (
                                      <div>{t('typeNames.settings')}: {entry.records_synced.settings}</div>
                                    )}
                                  </div>
                                </div>
                              )}
                              {entry.errors && Object.keys(entry.errors).length > 0 && (
                                <div className="mt-2">
                                  <span className="font-medium text-sm text-destructive">{t('errors')}</span>
                                  <div className="mt-1 text-sm text-destructive/80 space-y-1">
                                    {Object.entries(entry.errors).map(([key, value]) => (
                                      <div key={key}>
                                        <span className="font-medium">{key}:</span> {value}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Card>
  )
}
