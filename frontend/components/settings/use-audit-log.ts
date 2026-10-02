"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { apiClient, type ApiAuditLog } from '@/lib/api-client';
import type { useEvent } from '@/lib/contexts/event-context';
import { useIntlLocale } from '@/lib/date-locale';

// Audit log constants
export const AUDIT_ACTION_TYPES = ['create', 'update', 'delete', 'assign', 'login_success', 'login_failure', 'logout'];
export const AUDIT_RESOURCE_TYPES = ['incident', 'personnel', 'vehicle', 'material', 'user', 'api'];
/** How many audit rows the page asks for. Was component state, but nothing ever changed it. */
const AUDIT_LOG_LIMIT = 100;

/**
 * The audit section's state: the per-Ereignis Excel export, and the log with
 * its server-side resource/action filters and local search.
 *
 * Moved out of `app/settings/page.tsx` verbatim (2026-09-23). ⚠️ The export
 * still reports a failure through `setImportError` — the IMPORT section's
 * banner, which is not on screen here. Preserved in the move; it needs a fix
 * of its own (the audit section has nowhere to show it yet).
 */
export function useAuditLog({
  activeSection,
  isEditor,
  events,
  setImportError,
}: {
  activeSection: string;
  isEditor: boolean;
  events: ReturnType<typeof useEvent>['events'];
  setImportError: (message: string | null) => void;
}) {
  const t = useTranslations('settings');
  const intlLocale = useIntlLocale();
  // Audit export state
  const [auditExportEventId, setAuditExportEventId] = useState<string>('');
  const [auditExportLoading, setAuditExportLoading] = useState(false);

  // Audit log state
  const [auditEntries, setAuditEntries] = useState<ApiAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditResourceFilter, setAuditResourceFilter] = useState<string>('all');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('all');
  const [auditSearchQuery, setAuditSearchQuery] = useState('');

  // Fetch audit logs
  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const params: { limit: number; resource_type?: string; action_type?: string } = { limit: AUDIT_LOG_LIMIT };
      if (auditResourceFilter !== 'all') params.resource_type = auditResourceFilter;
      if (auditActionFilter !== 'all') params.action_type = auditActionFilter;
      const data = await apiClient.getAuditLogs(params);
      setAuditEntries(data);
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
      setAuditError(err instanceof Error ? err.message : t('common.loadError'));
    } finally {
      setAuditLoading(false);
    }
  };

  // Fetch audit logs when on audit section
  useEffect(() => {
    if (activeSection === 'audit' && isEditor) {
      fetchAuditLogs();
    }
  }, [activeSection, isEditor, auditResourceFilter, auditActionFilter]);

  const handleAuditExport = async () => {
    if (!auditExportEventId) {
      toast.error(t('page.toasts.selectEvent'));
      return;
    }
    setAuditExportLoading(true);
    setImportError(null);
    try {
      const blob = await apiClient.exportEventAudit(auditExportEventId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const selectedEvent = events.find(e => e.id === auditExportEventId);
      const eventName = selectedEvent?.name || 'event';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const sanitizedName = eventName.replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `audit_${sanitizedName}_${timestamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(t('page.toasts.auditExportSuccess'));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t('page.errors.auditExportFailed'));
    } finally {
      setAuditExportLoading(false);
    }
  };

  // Audit log helpers
  const filteredAuditEntries = auditEntries.filter((entry) => {
    if (entry.action_type === 'get_request') return false;
    if (!auditSearchQuery) return true;
    const query = auditSearchQuery.toLowerCase();
    return (
      entry.action_type.toLowerCase().includes(query) ||
      entry.resource_type.toLowerCase().includes(query) ||
      (entry.resource_id && entry.resource_id.toLowerCase().includes(query)) ||
      (entry.user_id && entry.user_id.toLowerCase().includes(query)) ||
      (entry.ip_address && entry.ip_address.toLowerCase().includes(query))
    );
  });

  const formatAuditTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString(intlLocale, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const getAuditBadgeVariant = (actionType: string) => {
    if (actionType.includes('delete')) return 'destructive' as const;
    if (actionType.includes('create')) return 'default' as const;
    if (actionType.includes('update')) return 'secondary' as const;
    return 'outline' as const;
  };

  const clearAuditFilters = () => {
    setAuditResourceFilter('all');
    setAuditActionFilter('all');
    setAuditSearchQuery('');
  };

  const hasActiveAuditFilters = auditResourceFilter !== 'all' || auditActionFilter !== 'all' || auditSearchQuery !== '';

  return {
    auditExportEventId,
    setAuditExportEventId,
    auditExportLoading,
    auditEntries,
    auditLoading,
    auditError,
    auditResourceFilter,
    setAuditResourceFilter,
    auditActionFilter,
    setAuditActionFilter,
    auditSearchQuery,
    setAuditSearchQuery,
    fetchAuditLogs,
    handleAuditExport,
    filteredAuditEntries,
    formatAuditTimestamp,
    getAuditBadgeVariant,
    clearAuditFilters,
    hasActiveAuditFilters,
  };
}

export type AuditLog = ReturnType<typeof useAuditLog>;
