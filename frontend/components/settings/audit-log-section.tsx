"use client";

import { useTranslations } from 'next-intl';
import { Download, User, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SettingCard } from '@/components/settings/setting-row';
import { AUDIT_ACTION_TYPES, AUDIT_RESOURCE_TYPES, type AuditLog } from '@/components/settings/use-audit-log';
import type { useEvent } from '@/lib/contexts/event-context';

/**
 * «Audit»: the per-Ereignis protocol export, then the log — search, resource
 * and action filters, table on desktop and cards on a phone.
 *
 * The JSX of the settings page's `audit` section, moved verbatim
 * (2026-09-23); the state and handlers come from `useAuditLog`.
 */
export function AuditLogSection({
  audit,
  events,
  eventsLoading,
}: {
  audit: AuditLog;
  events: ReturnType<typeof useEvent>['events'];
  eventsLoading: boolean;
}) {
  const t = useTranslations('settings');
  const {
    auditExportEventId,
    setAuditExportEventId,
    auditExportLoading,
    handleAuditExport,
    auditSearchQuery,
    setAuditSearchQuery,
    auditResourceFilter,
    setAuditResourceFilter,
    auditActionFilter,
    setAuditActionFilter,
    hasActiveAuditFilters,
    clearAuditFilters,
    filteredAuditEntries,
    auditLoading,
    auditError,
    fetchAuditLogs,
    formatAuditTimestamp,
    getAuditBadgeVariant,
  } = audit;
  return (
    <div className="space-y-6">
      {/* Audit Export */}
      <SettingCard
        title={t('page.audit.exportTitle')}
        subtitle={t('page.audit.exportDescription')}
      >
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex-1 w-full sm:w-auto">
              <Select
                value={auditExportEventId}
                onValueChange={setAuditExportEventId}
                disabled={eventsLoading || auditExportLoading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('page.audit.selectEventPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {events
                    .filter(e => !e.archived_at)
                    .map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {event.name}
                        {event.training_flag && (
                          <span className="ml-2 text-xs text-muted-foreground">{t('page.audit.trainingTag')}</span>
                        )}
                      </SelectItem>
                    ))}
                  {events.filter(e => e.archived_at).length > 0 && (
                    <>
                      <SelectItem value="_divider" disabled>
                        {t('page.audit.archivedDivider')}
                      </SelectItem>
                      {events
                        .filter(e => e.archived_at)
                        .map((event) => (
                          <SelectItem key={event.id} value={event.id}>
                            {event.name}
                            {event.training_flag && (
                              <span className="ml-2 text-xs text-muted-foreground">{t('page.audit.trainingTag')}</span>
                            )}
                          </SelectItem>
                        ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleAuditExport}
              disabled={!auditExportEventId || auditExportLoading || eventsLoading}
              className="w-full sm:w-auto"
            >
              <Download className="size-4" />
              {auditExportLoading ? t('page.audit.exporting') : t('page.audit.exportButton')}
            </Button>
          </div>
        </div>
      </SettingCard>

      {/* Suche, Filter und Treffer in EINER Karte – wie die Bestandslisten:
          die Bedienleiste oben, die Tabelle darunter, alles auf derselben
          Fläche. Vorher stand die Leiste nackt auf dem Seitenhintergrund und
          jeder Zustand darunter (Laden / Fehler / leer / Tabelle) brachte
          seine eigene Karte mit. */}
      <SettingCard>
      <SearchInput
        placeholder={t('page.audit.searchPlaceholder')}
        value={auditSearchQuery}
        onValueChange={setAuditSearchQuery}
        className="w-full"
      />

      {/* Filters - Compact row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={auditResourceFilter} onValueChange={setAuditResourceFilter}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder={t('page.audit.resource')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('page.audit.allResources')}</SelectItem>
            {AUDIT_RESOURCE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>{type}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={auditActionFilter} onValueChange={setAuditActionFilter}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder={t('page.audit.action')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('page.audit.allActions')}</SelectItem>
            {AUDIT_ACTION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>{type}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveAuditFilters && (
          <Button variant="ghost" size="sm" onClick={clearAuditFilters} className="h-9">
            <X className="size-3.5" />
            {t('page.audit.clearFilters')}
          </Button>
        )}
        <span className="text-sm text-muted-foreground ml-auto">
          {t('common.entriesCount', { count: filteredAuditEntries.length })}
        </span>
      </div>

      {/* Content */}
      <div className="mt-4">
      {auditLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : auditError ? (
        <>
          <p className="text-destructive">{auditError}</p>
          <Button onClick={fetchAuditLogs} className="mt-4">{t('common.retry')}</Button>
        </>
      ) : filteredAuditEntries.length === 0 ? (
        <p className="py-4 text-center text-muted-foreground">
          {hasActiveAuditFilters ? t('page.audit.noEntriesFiltered') : t('page.audit.noEntries')}
        </p>
      ) : (
        <>
          {/* Desktop Table - Hidden on mobile */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">{t('page.audit.timeHead')}</TableHead>
                  <TableHead>{t('page.audit.action')}</TableHead>
                  <TableHead>{t('page.audit.resource')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('page.audit.userHead')}</TableHead>
                  <TableHead>{t('page.audit.detailsHead')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAuditEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">
                      {formatAuditTimestamp(entry.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getAuditBadgeVariant(entry.action_type)}>
                        {entry.action_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.resource_type}</Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                      {entry.user_id ? `${entry.user_id.substring(0, 8)}...` : <em>{t('page.audit.system')}</em>}
                    </TableCell>
                    <TableCell>
                      {entry.changes_json ? (
                        <details className="cursor-pointer">
                          <summary className="text-xs text-primary hover:text-primary/80">{t('page.audit.show')}</summary>
                          <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(entry.changes_json, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards - Shown only on mobile */}
          <div className="md:hidden space-y-3">
            {filteredAuditEntries.map((entry) => (
              <Card key={entry.id} className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <Badge variant={getAuditBadgeVariant(entry.action_type)}>
                    {entry.action_type}
                  </Badge>
                  <Badge variant="outline">{entry.resource_type}</Badge>
                </div>
                <p className="font-mono text-xs text-muted-foreground mb-2">
                  {formatAuditTimestamp(entry.timestamp)}
                </p>
                {entry.user_id && (
                  <p className="text-xs text-muted-foreground">
                    <User className="h-3 w-3 inline mr-1" />
                    {entry.user_id.substring(0, 8)}...
                  </p>
                )}
                {entry.changes_json && (
                  <details className="mt-2 cursor-pointer">
                    <summary className="text-xs text-primary">{t('page.audit.showDetails')}</summary>
                    <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                      {JSON.stringify(entry.changes_json, null, 2)}
                    </pre>
                  </details>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
      </div>
      </SettingCard>
    </div>
  );
}
