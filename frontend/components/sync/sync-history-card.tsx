'use client'

import { useState, useEffect, Fragment } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

export function SyncHistoryCard() {
  const [history, setHistory] = useState<SyncHistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    try {
      setIsLoading(true)
      const data = await apiClient.getSyncHistory(10) // Last 10 syncs
      setHistory(data)
    } catch (error) {
      toast.error('Fehler beim Laden des Synchronisations-Verlaufs')
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
          <Badge variant="secondary" className="bg-green-500 text-white flex items-center gap-1 w-fit">
            <CheckCircle2 className="h-3 w-3" />
            Erfolgreich
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="destructive" className="flex items-center gap-1 w-fit">
            <XCircle className="h-3 w-3" />
            Fehlgeschlagen
          </Badge>
        )
      case 'partial':
        return (
          <Badge variant="secondary" className="bg-orange-500 text-white flex items-center gap-1 w-fit">
            <AlertTriangle className="h-3 w-3" />
            Teilweise
          </Badge>
        )
      case 'syncing':
        return (
          <Badge variant="secondary" className="bg-yellow-500 text-white flex items-center gap-1 w-fit">
            <Loader2 className="h-3 w-3 animate-spin" />
            Läuft...
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
    return direction === 'from_railway' ? 'Von Railway' : 'Zu Railway'
  }

  const formatTimestamp = (timestamp: string) => {
    try {
      return format(new Date(timestamp), 'dd.MM.yyyy HH:mm:ss', { locale: de })
    } catch {
      return 'Ungültig'
    }
  }

  const formatRecordsSynced = (records: SyncHistoryEntry['records_synced']) => {
    if (!records) return 'Keine'

    const entries = Object.entries(records).filter(([_, count]) => count && count > 0)
    if (entries.length === 0) return 'Keine'

    return entries.map(([type, count]) => {
      const typeNames: Record<string, string> = {
        incidents: 'Einsätze',
        personnel: 'Personal',
        vehicles: 'Fahrzeuge',
        materials: 'Materialien',
        settings: 'Einstellungen',
      }
      return `${count} ${typeNames[type] || type}`
    }).join(', ')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Synchronisations-Verlauf</CardTitle>
        <CardDescription>
          Letzte 10 Synchronisationen zwischen Railway und Local
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Keine Synchronisations-Historie verfügbar
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>Zeitstempel</TableHead>
                  <TableHead>Richtung</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Datensätze</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((entry) => {
                  const isExpanded = expandedRows.has(entry.id)
                  return (
                    <Fragment key={entry.id}>
                      <TableRow className="cursor-pointer" onClick={() => toggleRow(entry.id)}>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
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
                                  <span className="font-medium">Gestartet:</span>{' '}
                                  {formatTimestamp(entry.started_at)}
                                </div>
                                {entry.completed_at && (
                                  <div>
                                    <span className="font-medium">Abgeschlossen:</span>{' '}
                                    {formatTimestamp(entry.completed_at)}
                                  </div>
                                )}
                              </div>
                              {entry.records_synced && (
                                <div>
                                  <span className="font-medium text-sm">Details:</span>
                                  <div className="grid grid-cols-2 gap-2 mt-1 text-sm text-muted-foreground">
                                    {entry.records_synced.incidents !== undefined && (
                                      <div>Einsätze: {entry.records_synced.incidents}</div>
                                    )}
                                    {entry.records_synced.personnel !== undefined && (
                                      <div>Personal: {entry.records_synced.personnel}</div>
                                    )}
                                    {entry.records_synced.vehicles !== undefined && (
                                      <div>Fahrzeuge: {entry.records_synced.vehicles}</div>
                                    )}
                                    {entry.records_synced.materials !== undefined && (
                                      <div>Materialien: {entry.records_synced.materials}</div>
                                    )}
                                    {entry.records_synced.settings !== undefined && (
                                      <div>Einstellungen: {entry.records_synced.settings}</div>
                                    )}
                                  </div>
                                </div>
                              )}
                              {entry.errors && Object.keys(entry.errors).length > 0 && (
                                <div className="mt-2">
                                  <span className="font-medium text-sm text-red-600">Fehler:</span>
                                  <div className="mt-1 text-sm text-red-700 space-y-1">
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
      </CardContent>
    </Card>
  )
}
