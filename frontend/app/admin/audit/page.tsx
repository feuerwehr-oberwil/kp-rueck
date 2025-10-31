'use client';

/**
 * Audit Log Viewer
 * Displays comprehensive audit trail of all system actions
 * Only accessible to users with Editor role
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/auth-context';
import { useEvent } from '@/lib/contexts/event-context';
import { apiClient, type ApiAuditLog } from '@/lib/api-client';
import { ProtectedRoute } from '@/components/protected-route';
import { PageNavigation } from '@/components/page-navigation';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Filter, X, FileText, User, Calendar } from 'lucide-react';
import Link from 'next/link';

const ACTION_TYPES = [
  'create',
  'update',
  'delete',
  'assign',
  'login_success',
  'login_failure',
  'logout',
];

const RESOURCE_TYPES = [
  'incident',
  'personnel',
  'vehicle',
  'material',
  'user',
  'api',
];

export default function AuditLogPage() {
  const { isEditor } = useAuth();
  const { selectedEvent } = useEvent();
  const router = useRouter();
  const [entries, setEntries] = useState<ApiAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>('all');
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [limit, setLimit] = useState(100);

  // Redirect non-editors
  useEffect(() => {
    if (!isEditor) {
      router.push('/');
    }
  }, [isEditor, router]);

  // Fetch audit logs
  const fetchAuditLogs = async () => {
    setLoading(true);
    setError(null);

    try {
      const params: any = { limit };

      if (resourceTypeFilter !== 'all') {
        params.resource_type = resourceTypeFilter;
      }

      if (actionTypeFilter !== 'all') {
        params.action_type = actionTypeFilter;
      }

      const data = await apiClient.getAuditLogs(params);
      setEntries(data);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
      // Show actual error message for debugging
      const errorMessage = err instanceof Error ? err.message : 'Fehler beim Laden der Audit-Protokolle';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isEditor) {
      fetchAuditLogs();
    }
  }, [isEditor, resourceTypeFilter, actionTypeFilter, limit]);

  // Filter entries by search query (client-side) and exclude get_request
  const filteredEntries = entries.filter((entry) => {
    // Exclude get_request entries
    if (entry.action_type === 'get_request') return false;

    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      entry.action_type.toLowerCase().includes(query) ||
      entry.resource_type.toLowerCase().includes(query) ||
      (entry.resource_id && entry.resource_id.toLowerCase().includes(query)) ||
      (entry.user_id && entry.user_id.toLowerCase().includes(query)) ||
      (entry.ip_address && entry.ip_address.toLowerCase().includes(query))
    );
  });

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getActionTypeBadgeVariant = (actionType: string) => {
    if (actionType.includes('delete')) return 'destructive';
    if (actionType.includes('create')) return 'default';
    if (actionType.includes('update')) return 'secondary';
    if (actionType.includes('login')) return 'outline';
    return 'secondary';
  };

  const clearFilters = () => {
    setResourceTypeFilter('all');
    setActionTypeFilter('all');
    setSearchQuery('');
  };

  const hasActiveFilters = resourceTypeFilter !== 'all' || actionTypeFilter !== 'all' || searchQuery !== '';

  if (!isEditor) {
    return null;
  }

  return (
    <ProtectedRoute>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 text-2xl shadow-lg">
                📋
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Audit-Protokoll</h1>
                <p className="text-sm text-muted-foreground">
                  Systemweite Aktionsübersicht
                </p>
              </div>
            </div>
          </div>

          <PageNavigation currentPage="settings" hasSelectedEvent={!!selectedEvent} />
        </header>

        {/* Filters */}
        <div className="border-b border-border/50 bg-card/30 backdrop-blur-sm px-6 py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filter:</span>
            </div>

            <div className="flex-1 min-w-[200px] max-w-md">
              <Input
                placeholder="Suche nach Aktion, Ressource, ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9"
              />
            </div>

            <Select value={resourceTypeFilter} onValueChange={setResourceTypeFilter}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Ressourcentyp" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Ressourcen</SelectItem>
                {RESOURCE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={actionTypeFilter} onValueChange={setActionTypeFilter}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Aktionstyp" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Aktionen</SelectItem>
                {ACTION_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={limit.toString()} onValueChange={(val) => setLimit(parseInt(val))}>
              <SelectTrigger className="w-[120px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50 Einträge</SelectItem>
                <SelectItem value="100">100 Einträge</SelectItem>
                <SelectItem value="250">250 Einträge</SelectItem>
                <SelectItem value="500">500 Einträge</SelectItem>
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="gap-2"
              >
                <X className="h-4 w-4" />
                Zurücksetzen
              </Button>
            )}

            <div className="ml-auto text-sm text-muted-foreground">
              {filteredEntries.length} von {entries.length} Einträgen
            </div>
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-muted-foreground">Lade Audit-Protokolle...</div>
            </div>
          ) : error ? (
            <Card className="p-8">
              <div className="text-center">
                <p className="text-destructive font-medium">{error}</p>
                <Button onClick={fetchAuditLogs} className="mt-4">
                  Erneut versuchen
                </Button>
              </div>
            </Card>
          ) : filteredEntries.length === 0 ? (
            <Card className="p-8">
              <div className="text-center text-muted-foreground">
                {hasActiveFilters
                  ? 'Keine Einträge gefunden, die den Filterkriterien entsprechen.'
                  : 'Noch keine Audit-Protokolle vorhanden.'}
              </div>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[180px]">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Zeitstempel
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Aktion
                      </div>
                    </TableHead>
                    <TableHead>Ressource</TableHead>
                    <TableHead>Ressourcen-ID</TableHead>
                    <TableHead>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        Benutzer
                      </div>
                    </TableHead>
                    <TableHead>IP-Adresse</TableHead>
                    <TableHead>Änderungen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs">
                        {formatTimestamp(entry.timestamp)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getActionTypeBadgeVariant(entry.action_type)}>
                          {entry.action_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{entry.resource_type}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.resource_id ? (
                          <span className="text-muted-foreground">
                            {entry.resource_id.substring(0, 8)}...
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.user_id ? (
                          <span className="text-muted-foreground">
                            {entry.user_id.substring(0, 8)}...
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">System</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.ip_address || '-'}
                      </TableCell>
                      <TableCell>
                        {entry.changes_json ? (
                          <details className="cursor-pointer">
                            <summary className="text-xs text-blue-600 hover:text-blue-800">
                              Änderungen anzeigen
                            </summary>
                            <pre className="mt-2 text-xs bg-secondary/50 p-2 rounded overflow-auto max-h-32">
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
            </Card>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}
