'use client';

/**
 * User menu component
 * Displays current user info and logout button in a settings dropdown
 * Enhanced with visual grouping for better navigation organization
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Settings, User, LogOut, Inbox, Plus, QrCode, Search, Truck, Printer, Calendar, Monitor, Keyboard, Download, FileText, FileSpreadsheet, CircleHelp, ClipboardList, ChartColumn } from 'lucide-react';
import { toast } from 'sonner';
import { useEvent } from '@/lib/contexts/event-context';
import { getApiUrl } from '@/lib/env';
import { apiClient } from '@/lib/api-client';
import type { ApiDiveraPollingStatus } from '@/lib/api/types';
import { wsClient, type WebSocketStatus } from '@/lib/websocket-client';
import { AccountBlock } from '@/components/auth/account-block';
import { VersionLabel } from '@/components/version-label';
import { useLogout } from '@/lib/hooks/use-logout';
import { usePolling } from '@/lib/hooks/use-polling';
import { openCommandPalette } from '@/components/ui/command-palette';
import { openAlarmInbox } from '@/components/alarm-inbox/alarm-inbox-store';
import { FiguresDialog, toggleFigures } from '@/components/figures-dialog';
import { useCommandPaletteHint } from '@/lib/hooks/use-is-mac';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import {
  LAGEBLATT_AUTODOWNLOAD_EVENT,
  LAGEBLATT_AUTODOWNLOAD_KEY,
  readLageblattInterval,
} from '@/lib/lageblatt';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';

interface UserMenuProps {
  // Quick action callbacks (optional, for pages that support them)
  onNewIncident?: () => void;
  onCheckIn?: () => void;
  onReko?: () => void;
  onVehicleStatus?: () => void;
  onPrint?: () => void;
}

/** How often the menu's printer, Divera and server dots are refreshed. */
const STATUS_POLL_MS = 30_000

export function UserMenu({
  onNewIncident,
  onCheckIn,
  onReko,
  onVehicleStatus,
  onPrint,
}: UserMenuProps = {}) {
  const t = useTranslations('nav.userMenu');
  const { user, isEditor, isAuthenticated } = useAuth();
  const tAccount = useTranslations('nav.account');
  const { requestLogout, logoutDialog } = useLogout();
  const { selectedEvent } = useEvent();
  const cmdHint = useCommandPaletteHint();

  // Quick per-event export of the currently selected event (Verwaltung → Export).
  const downloadEventExport = async (kind: 'pdf' | 'xlsx' | 'lageblatt') => {
    if (!selectedEvent) return;
    try {
      const blob = kind === 'pdf'
        ? await apiClient.exportEventReport(selectedEvent.id)
        : kind === 'lageblatt'
          ? await apiClient.exportEventLageblatt(selectedEvent.id)
          : await apiClient.exportEventAudit(selectedEvent.id);
      // Mirror backend slug: lowercase, umlauts transliterated, non-alnum -> "-"
      const slug = selectedEvent.name
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ereignis';
      const date = new Date().toISOString().slice(0, 10);
      const time = new Date().toTimeString().slice(0, 5).replace(':', '');
      const filename = kind === 'pdf'
        ? `einsatzbericht-${slug}-${date}.pdf`
        : kind === 'lageblatt'
          ? `lageblatt-${slug}-${date}-${time}.pdf`
          : `audit-${slug}-${date}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('exportFailed'));
    }
  };

  // Paper fallback: periodically auto-download the Lageblatt to THIS device so a
  // current printable snapshot exists even if the connection dies later.
  // Toggled in Einstellungen → Ausfallsicherheit; the interval runs here because
  // the UserMenu is mounted on every page.
  const [lageblattAutoDownload, setLageblattAutoDownload] = useState(false);
  const [lageblattIntervalMin, setLageblattIntervalMin] = useState(15);
  useEffect(() => {
    const read = () => {
      setLageblattAutoDownload(localStorage.getItem(LAGEBLATT_AUTODOWNLOAD_KEY) === 'true');
      setLageblattIntervalMin(readLageblattInterval());
    };
    read();
    window.addEventListener(LAGEBLATT_AUTODOWNLOAD_EVENT, read);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener(LAGEBLATT_AUTODOWNLOAD_EVENT, read);
      window.removeEventListener('storage', read);
    };
  }, []);
  const downloadEventExportRef = useRef(downloadEventExport);
  downloadEventExportRef.current = downloadEventExport;
  useEffect(() => {
    if (!lageblattAutoDownload || !selectedEvent || !isEditor) return;
    const id = window.setInterval(() => downloadEventExportRef.current('lageblatt'), lageblattIntervalMin * 60 * 1000);
    return () => window.clearInterval(id);
  }, [lageblattAutoDownload, lageblattIntervalMin, selectedEvent, isEditor]);
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [apiUrl] = useState(getApiUrl());
  const [wsStatus, setWsStatus] = useState<WebSocketStatus>('disconnected');
  const [printerStatus, setPrinterStatus] = useState<{ enabled: boolean; ip: string; last_error: string | null } | null>(null);
  const [diveraStatus, setDiveraStatus] = useState<ApiDiveraPollingStatus | null>(null);

  // Subscribe to WebSocket status changes
  useEffect(() => {
    const unsubscribe = wsClient.onStatusChange(setWsStatus);
    return unsubscribe;
  }, []);

  // Three status probes behind the menu's dots. On `usePolling` so they pause in a hidden
  // tab like every other timer – a board left open overnight asked thrice every 30 s.
  const fetchPrinterStatus = useCallback(async () => {
    try {
      setPrinterStatus(await apiClient.getPrinterStatus());
    } catch {
      // Printer API might not be available (e.g., Railway deployment)
      setPrinterStatus(null);
    }
  }, []);
  usePolling(fetchPrinterStatus, { intervalMs: STATUS_POLL_MS, enabled: isAuthenticated });

  const fetchDiveraStatus = useCallback(async () => {
    try {
      setDiveraStatus(await apiClient.getDiveraPollingStatus());
    } catch {
      // Divera API might not be available — leave status unknown.
      setDiveraStatus(null);
    }
  }, []);
  usePolling(fetchDiveraStatus, { intervalMs: STATUS_POLL_MS, enabled: isAuthenticated });

  // One health poll for the whole mount (`apiUrl` is fixed at mount).
  const checkConnection = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/health`);
      setStatus(response.ok ? "connected" : "disconnected");
    } catch {
      setStatus("disconnected");
    }
  }, [apiUrl]);
  usePolling(checkConnection, { intervalMs: STATUS_POLL_MS });

  if (!isAuthenticated || !user) {
    return null;
  }


  const getStatusColor = () => {
    switch (status) {
      case "connected":
        return "bg-success";
      case "disconnected":
        return "bg-destructive";
      case "checking":
        return "bg-warning";
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return t('statusConnected');
      case "disconnected":
        return t('statusOffline');
      case "checking":
        return t('statusChecking');
    }
  };

  const getWsStatusColor = () => {
    switch (wsStatus) {
      case 'connecting':
        return 'bg-warning';
      case 'connected':
        return 'bg-success';
      case 'disconnected':
        return 'bg-muted-foreground';
      case 'error':
        return 'bg-destructive';
    }
  };

  const getWsStatusText = () => {
    switch (wsStatus) {
      case 'connecting':
        return t('wsConnecting');
      case 'connected':
        return t('wsRealtime');
      case 'disconnected':
        return t('statusOffline');
      case 'error':
        return t('wsFailed');
    }
  };

  const getPrinterStatusColor = () => {
    if (!printerStatus) return "bg-muted-foreground";
    if (!printerStatus.enabled) return "bg-muted-foreground";
    if (printerStatus.last_error) return "bg-destructive";
    return "bg-success";
  };

  const getPrinterStatusText = () => {
    if (!printerStatus) return t('printerUnavailable');
    if (!printerStatus.enabled) return t('printerDisabled');
    if (printerStatus.last_error) return t('statusError');
    return t('printerReady');
  };

  const getDiveraStatusColor = () => {
    if (!diveraStatus?.configured) return "bg-muted-foreground";
    // Errors with no successful poll yet = the connection is genuinely broken.
    if (diveraStatus.error_count && !diveraStatus.poll_count) return "bg-destructive";
    return "bg-success";
  };

  const getDiveraStatusText = () => {
    if (!diveraStatus?.configured) return t('diveraNotConfigured');
    if (diveraStatus.error_count && !diveraStatus.poll_count) return t('statusError');
    return t('statusConnected');
  };

  const connectionRow = (
    <div className="flex items-center justify-between w-full">
      <span className="text-xs text-muted-foreground">{t('connection')}</span>
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
        <div className={`h-2 w-2 rounded-full ${getWsStatusColor()}`} />
        <div className={`h-2 w-2 rounded-full ${getPrinterStatusColor()}`} />
        <div className={`h-2 w-2 rounded-full ${getDiveraStatusColor()}`} />
      </div>
    </div>
  );

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('openMenu')}>
          <User className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
          {/* Who is logged in — the same block as the phone's Mehr sheet. */}
          <DropdownMenuLabel className="font-normal">
            <AccountBlock />
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {/* QUICK ACTIONS GROUP - only shown when callbacks provided */}
          {(onNewIncident || onCheckIn || onReko || onVehicleStatus || onPrint) && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1.5">
                {t('quickActions')}
              </DropdownMenuLabel>
              {onNewIncident && (
                <DropdownMenuItem onClick={onNewIncident} className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4" />
                  <span>{t('newIncident')}</span>
                </DropdownMenuItem>
              )}
              {onCheckIn && (
                <DropdownMenuItem onClick={onCheckIn} className="cursor-pointer">
                  <QrCode className="mr-2 h-4 w-4" />
                  <span>{t('checkIn')}</span>
                </DropdownMenuItem>
              )}
              {onReko && (
                <DropdownMenuItem onClick={onReko} className="cursor-pointer">
                  <Search className="mr-2 h-4 w-4" />
                  <span>{t('reko')}</span>
                </DropdownMenuItem>
              )}
              {onVehicleStatus && (
                <DropdownMenuItem onClick={onVehicleStatus} className="cursor-pointer">
                  <Truck className="mr-2 h-4 w-4" />
                  <span>{t('vehicleStatus')}</span>
                </DropdownMenuItem>
              )}
              {onPrint && (
                <DropdownMenuItem onClick={onPrint} className="cursor-pointer">
                  <Printer className="mr-2 h-4 w-4" />
                  <span>{t('print')}</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}

          {/* CONNECTION STATUS - dots only, rich popover on hover. A plain row that keeps
              the menu open. */}
          <HoverCard openDelay={80} closeDelay={120}>
            <HoverCardTrigger asChild>
              <DropdownMenuItem className="cursor-default" onSelect={(e) => e.preventDefault()}>
                {connectionRow}
              </DropdownMenuItem>
            </HoverCardTrigger>
            <HoverCardContent side="left" sideOffset={8} align="start" className="w-56">
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
                  <span>{t('apiLabel')}: {getStatusText()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getWsStatusColor()}`} />
                  <span>{t('websocketLabel')}: {getWsStatusText()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getPrinterStatusColor()}`} />
                  <span>{t('printerLabel')}: {getPrinterStatusText()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getDiveraStatusColor()}`} />
                  <span>{t('diveraLabel')}: {getDiveraStatusText()}</span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>

          <DropdownMenuSeparator />

          {/* DISPLAY GROUP */}
          <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1.5">
            {t('display')}
          </DropdownMenuLabel>
          {/* Kennzahlen: a modal over this page, not a display of its own (was a footer pill). */}
          <DropdownMenuItem onClick={toggleFigures} className="cursor-pointer">
            <ChartColumn className="mr-2 h-4 w-4" />
            <span>{t('figures')}</span>
            <span className="ml-auto text-xs text-muted-foreground">Z</span>
          </DropdownMenuItem>
          {/* The three walls are one click away on /display (and its tabs) – listed here too they
              made «Anzeige» the longest group of the menu (owner, 08.11.). */}
          <DropdownMenuItem asChild>
            <Link href="/display" target="_blank" className="cursor-pointer">
              <Monitor className="mr-2 h-4 w-4" />
              <span>{t('displayOverview')}</span>
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* MANAGEMENT GROUP */}
          <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1.5">
            {t('management')}
          </DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/events" className="cursor-pointer">
              <Calendar className="mr-2 h-4 w-4" />
              <span>{t('events')}</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings" className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              <span>{t('settings')}</span>
            </Link>
          </DropdownMenuItem>
          {/* The sheet over this page – the header's inbox icon opens the same one. */}
          <DropdownMenuItem onClick={openAlarmInbox} className="cursor-pointer">
            <Inbox className="mr-2 h-4 w-4" />
            <span>{t('diveraPool')}</span>
          </DropdownMenuItem>

          {isEditor && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <Download className="mr-2 h-4 w-4" />
                <span>{t('export')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {!selectedEvent && (
                    <DropdownMenuItem disabled>
                      <span className="text-muted-foreground">{t('noEventSelected')}</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => downloadEventExport('pdf')}
                    disabled={!selectedEvent}
                    className="cursor-pointer"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    <span>{t('reportPdf')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => downloadEventExport('xlsx')}
                    disabled={!selectedEvent}
                    className="cursor-pointer"
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    <span>{t('auditXlsx')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => downloadEventExport('lageblatt')}
                    disabled={!selectedEvent}
                    className="cursor-pointer"
                  >
                    <ClipboardList className="mr-2 h-4 w-4" />
                    <span>{t('lageblattA4')}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

          <DropdownMenuItem onClick={openCommandPalette} className="cursor-pointer">
            <Keyboard className="mr-2 h-4 w-4" />
            <span>{t('commands')}</span>
            <span className="ml-auto shrink-0 whitespace-nowrap pl-2 text-xs text-muted-foreground">{cmdHint} · ?</span>
          </DropdownMenuItem>

          <DropdownMenuItem asChild>
            <Link href="/help" className="cursor-pointer">
              <CircleHelp className="mr-2 h-4 w-4" />
              <span>{t('help')}</span>
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={requestLogout} className="text-destructive focus:text-destructive">
            <LogOut className="mr-2 h-4 w-4" />
            <span>{tAccount('logout')}</span>
          </DropdownMenuItem>
          {/* The one version line, under the account actions (phone: same place). */}
          <VersionLabel className="px-2 pb-1.5 pt-1" />
        </DropdownMenuContent>
    </DropdownMenu>
    {logoutDialog}
    <FiguresDialog />
    </>
  );
}
