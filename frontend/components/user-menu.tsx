'use client';

/**
 * User menu component
 * Displays current user info and logout button in a settings dropdown
 * Enhanced with visual grouping for better navigation organization
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Settings, User, LogOut, Radio, Plus, QrCode, Search, Truck, Printer, Calendar, Monitor, Map, LayoutGrid, BarChart3, Keyboard, Download, FileText, FileSpreadsheet, CircleHelp } from 'lucide-react';
import { toast } from 'sonner';
import { useEvent } from '@/lib/contexts/event-context';
import { getApiUrl } from '@/lib/env';
import { useSyncStatus } from '@/lib/hooks/use-sync-status';
import { useRailwayRecovery } from '@/lib/hooks/use-railway-recovery';
import { apiClient } from '@/lib/api-client';
import type { ApiDiveraPollingStatus } from '@/lib/api/types';
import { wsClient, type WebSocketStatus } from '@/lib/websocket-client';
import type { SyncConfig } from '@/types/sync';
import { RoleBadge } from '@/components/auth/role-badge';
import { openCommandPalette } from '@/components/ui/command-palette';
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
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';

interface UserMenuProps {
  // Quick action callbacks (optional, for pages that support them)
  onNewIncident?: () => void;
  onCheckIn?: () => void;
  onReko?: () => void;
  onVehicleStatus?: () => void;
  onPrint?: () => void;
}

export function UserMenu({
  onNewIncident,
  onCheckIn,
  onReko,
  onVehicleStatus,
  onPrint,
}: UserMenuProps = {}) {
  const { user, logout, isEditor, isAuthenticated } = useAuth();
  const { selectedEvent } = useEvent();
  const router = useRouter();

  // Quick per-event export of the currently selected event (Verwaltung → Export).
  const downloadEventExport = async (kind: 'pdf' | 'xlsx') => {
    if (!selectedEvent) return;
    try {
      const blob = kind === 'pdf'
        ? await apiClient.exportEventReport(selectedEvent.id)
        : await apiClient.exportEventAudit(selectedEvent.id);
      // Mirror backend slug: lowercase, umlauts transliterated, non-alnum -> "-"
      const slug = selectedEvent.name
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ereignis';
      const date = new Date().toISOString().slice(0, 10);
      const filename = kind === 'pdf'
        ? `einsatzbericht-${slug}-${date}.pdf`
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
      toast.error(err instanceof Error ? err.message : (kind === 'pdf' ? 'Bericht-Export fehlgeschlagen' : 'Audit-Export fehlgeschlagen'));
    }
  };
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [apiUrl] = useState(getApiUrl());
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [wsStatus, setWsStatus] = useState<WebSocketStatus>('disconnected');
  const [printerStatus, setPrinterStatus] = useState<{ enabled: boolean; ip: string; last_error: string | null } | null>(null);
  const [diveraStatus, setDiveraStatus] = useState<ApiDiveraPollingStatus | null>(null);

  // Sync status
  const { status: syncStatus, isLoading: syncLoading, error: syncError, isStale } = useSyncStatus();
  useRailwayRecovery(syncStatus);

  // Load config to check if we're on Railway
  useEffect(() => {
    if (!isAuthenticated) return;

    const loadConfig = async () => {
      try {
        const data = await apiClient.getSyncConfig();
        setSyncConfig(data);
      } catch (err) {
        // Ignore errors - config is optional
      }
    };
    loadConfig();
  }, [isAuthenticated]);

  // Subscribe to WebSocket status changes
  useEffect(() => {
    const unsubscribe = wsClient.onStatusChange(setWsStatus);
    return unsubscribe;
  }, []);

  // Fetch printer status
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchPrinterStatus = async () => {
      try {
        const status = await apiClient.getPrinterStatus();
        setPrinterStatus(status);
      } catch {
        // Printer API might not be available (e.g., Railway deployment)
        setPrinterStatus(null);
      }
    };
    fetchPrinterStatus();
    // Refresh printer status every 30 seconds
    const interval = setInterval(fetchPrinterStatus, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Fetch Divera connection status
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchDiveraStatus = async () => {
      try {
        setDiveraStatus(await apiClient.getDiveraPollingStatus());
      } catch {
        // Divera API might not be available — leave status unknown.
        setDiveraStatus(null);
      }
    };
    fetchDiveraStatus();
    const interval = setInterval(fetchDiveraStatus, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const checkConnection = async () => {
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) {
        setStatus("connected");
      } else {
        setStatus("disconnected");
      }
    } catch (error) {
      setStatus("disconnected");
    }
  };

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!isAuthenticated || !user) {
    return null;
  }

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

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
        return "Verbunden";
      case "disconnected":
        return "Offline";
      case "checking":
        return "Prüfen...";
    }
  };

  const getSyncStatusColor = () => {
    if (syncLoading) {
      return "bg-muted-foreground";
    }

    if (syncError || !syncStatus) {
      return "bg-destructive";
    }

    if (syncStatus.is_syncing) {
      return "bg-warning";
    }

    if (!syncStatus.railway_healthy) {
      return "bg-destructive";
    }

    if (isStale) {
      return "bg-warning";
    }

    return "bg-success";
  };

  const getSyncStatusText = () => {
    if (syncLoading) return "Prüfen...";
    if (syncError) return "Fehler";
    if (!syncStatus) return "Unbekannt";

    if (!syncStatus.railway_healthy) {
      return "Offline";
    }

    if (syncStatus.is_syncing) {
      return "Synchronisiert...";
    }

    if (isStale) {
      return "Veraltet";
    }

    return "Synchronisiert";
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
        return 'Verbindet';
      case 'connected':
        return 'Echtzeit';
      case 'disconnected':
        return 'Offline';
      case 'error':
        return 'Fehlgeschlagen';
    }
  };

  const getPrinterStatusColor = () => {
    if (!printerStatus) return "bg-muted-foreground";
    if (!printerStatus.enabled) return "bg-muted-foreground";
    if (printerStatus.last_error) return "bg-destructive";
    return "bg-success";
  };

  const getPrinterStatusText = () => {
    if (!printerStatus) return "Nicht verfügbar";
    if (!printerStatus.enabled) return "Deaktiviert";
    if (printerStatus.last_error) return "Fehler";
    return "Bereit";
  };

  const getDiveraStatusColor = () => {
    if (!diveraStatus?.configured) return "bg-muted-foreground";
    // Errors with no successful poll yet = the connection is genuinely broken.
    if (diveraStatus.error_count && !diveraStatus.poll_count) return "bg-destructive";
    return "bg-success";
  };

  const getDiveraStatusText = () => {
    if (!diveraStatus?.configured) return "Nicht konfiguriert";
    if (diveraStatus.error_count && !diveraStatus.poll_count) return "Fehler";
    return "Verbunden";
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-lg">
          <User className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
          {/* User Info with Role Badge */}
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-2">
              <p className="text-sm font-medium leading-none">{user.username}</p>
              <RoleBadge />
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {/* QUICK ACTIONS GROUP - only shown when callbacks provided */}
          {(onNewIncident || onCheckIn || onReko || onVehicleStatus || onPrint) && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground uppercase font-semibold px-2 py-1.5">
                Schnellzugriff
              </DropdownMenuLabel>
              {onNewIncident && (
                <DropdownMenuItem onClick={onNewIncident} className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4" />
                  <span>Neuer Einsatz</span>
                </DropdownMenuItem>
              )}
              {onCheckIn && (
                <DropdownMenuItem onClick={onCheckIn} className="cursor-pointer">
                  <QrCode className="mr-2 h-4 w-4" />
                  <span>Check-In</span>
                </DropdownMenuItem>
              )}
              {onReko && (
                <DropdownMenuItem onClick={onReko} className="cursor-pointer">
                  <Search className="mr-2 h-4 w-4" />
                  <span>Reko</span>
                </DropdownMenuItem>
              )}
              {onVehicleStatus && (
                <DropdownMenuItem onClick={onVehicleStatus} className="cursor-pointer">
                  <Truck className="mr-2 h-4 w-4" />
                  <span>Fahrzeugstatus</span>
                </DropdownMenuItem>
              )}
              {onPrint && (
                <DropdownMenuItem onClick={onPrint} className="cursor-pointer">
                  <Printer className="mr-2 h-4 w-4" />
                  <span>Drucken</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}

          {/* CONNECTION STATUS - dots only, rich popover on hover */}
          <HoverCard openDelay={80} closeDelay={120}>
            <HoverCardTrigger asChild>
              <DropdownMenuItem asChild>
                <Link href="/settings?section=sync" className="cursor-pointer">
                  <div className="flex items-center justify-between w-full">
                    <span className="text-xs text-muted-foreground">Verbindung</span>
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
                      <div className={`h-2 w-2 rounded-full ${getWsStatusColor()}`} />
                      {!syncConfig?.is_production && (
                        <div className={`h-2 w-2 rounded-full ${getSyncStatusColor()}`} />
                      )}
                      <div className={`h-2 w-2 rounded-full ${getPrinterStatusColor()}`} />
                      <div className={`h-2 w-2 rounded-full ${getDiveraStatusColor()}`} />
                    </div>
                  </div>
                </Link>
              </DropdownMenuItem>
            </HoverCardTrigger>
            <HoverCardContent side="left" sideOffset={8} align="start" className="w-56">
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
                  <span>API: {getStatusText()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getWsStatusColor()}`} />
                  <span>WebSocket: {getWsStatusText()}</span>
                </div>
                {!syncConfig?.is_production && (
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${getSyncStatusColor()}`} />
                    <span>Sync: {getSyncStatusText()}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getPrinterStatusColor()}`} />
                  <span>Drucker: {getPrinterStatusText()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getDiveraStatusColor()}`} />
                  <span>Divera: {getDiveraStatusText()}</span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>

          <DropdownMenuSeparator />

          {/* DISPLAY GROUP */}
          <DropdownMenuLabel className="text-xs text-muted-foreground uppercase font-semibold px-2 py-1.5">
            Anzeige
          </DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/display" target="_blank" className="cursor-pointer">
              <Monitor className="mr-2 h-4 w-4" />
              <span>Display-Übersicht</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/display/map" target="_blank" className="cursor-pointer">
              <Map className="mr-2 h-4 w-4" />
              <span>Lagekarte</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/display/board" target="_blank" className="cursor-pointer">
              <LayoutGrid className="mr-2 h-4 w-4" />
              <span>Board</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/display/status" target="_blank" className="cursor-pointer">
              <BarChart3 className="mr-2 h-4 w-4" />
              <span>Status</span>
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* MANAGEMENT GROUP */}
          <DropdownMenuLabel className="text-xs text-muted-foreground uppercase font-semibold px-2 py-1.5">
            Verwaltung
          </DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/events" className="cursor-pointer">
              <Calendar className="mr-2 h-4 w-4" />
              <span>Ereignisse</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings" className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              <span>Einstellungen</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/divera-pool" className="cursor-pointer">
              <Radio className="mr-2 h-4 w-4" />
              <span>Divera Notfälle</span>
            </Link>
          </DropdownMenuItem>

          {isEditor && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <Download className="mr-2 h-4 w-4" />
                <span>Export</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  {!selectedEvent && (
                    <DropdownMenuItem disabled>
                      <span className="text-muted-foreground">Kein Ereignis ausgewählt</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => downloadEventExport('pdf')}
                    disabled={!selectedEvent}
                    className="cursor-pointer"
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    <span>Bericht (PDF)</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => downloadEventExport('xlsx')}
                    disabled={!selectedEvent}
                    className="cursor-pointer"
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    <span>Audit-Export (XLSX)</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          )}

          <DropdownMenuItem onClick={openCommandPalette} className="cursor-pointer">
            <Keyboard className="mr-2 h-4 w-4" />
            <span>Befehle &amp; Tastaturkürzel</span>
            <span className="ml-auto text-xs text-muted-foreground">⌘K</span>
          </DropdownMenuItem>

          <DropdownMenuItem asChild>
            <Link href="/help" className="cursor-pointer">
              <CircleHelp className="mr-2 h-4 w-4" />
              <span>Hilfe &amp; Tastenkürzel</span>
            </Link>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
            <LogOut className="mr-2 h-4 w-4" />
            <span>Abmelden</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
  );
}
