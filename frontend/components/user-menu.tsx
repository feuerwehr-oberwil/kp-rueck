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
import { Settings, User, LogOut, ArrowDown, ArrowUp, Loader2, Wifi, WifiOff, Radio, HelpCircle, Plus, QrCode, Search, Truck, Printer, Calendar, Monitor, Map, LayoutGrid, BarChart3 } from 'lucide-react';
import { getApiUrl } from '@/lib/env';
import { useSyncStatus } from '@/lib/hooks/use-sync-status';
import { useRailwayRecovery } from '@/lib/hooks/use-railway-recovery';
import { apiClient } from '@/lib/api-client';
import { wsClient, type WebSocketStatus } from '@/lib/websocket-client';
import type { SyncConfig } from '@/types/sync';
import { RoleBadge } from '@/components/auth/role-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [apiUrl] = useState(getApiUrl());
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [wsStatus, setWsStatus] = useState<WebSocketStatus>('disconnected');
  const [printerStatus, setPrinterStatus] = useState<{ enabled: boolean; ip: string; last_error: string | null } | null>(null);

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

  const getSyncDirectionIcon = () => {
    if (!syncStatus) return null;

    if (syncStatus.is_syncing) {
      return <Loader2 className="h-3 w-3 animate-spin" />;
    }

    if (syncStatus.direction === 'from_railway') {
      return <ArrowDown className="h-3 w-3" />;
    } else if (syncStatus.direction === 'to_railway') {
      return <ArrowUp className="h-3 w-3" />;
    }

    return null;
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

  const getWsStatusIcon = () => {
    switch (wsStatus) {
      case 'connecting':
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case 'connected':
        return <Wifi className="h-3 w-3" />;
      case 'disconnected':
      case 'error':
        return <WifiOff className="h-3 w-3" />;
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

          {/* CONNECTION STATUS GROUP */}
          <DropdownMenuLabel className="text-xs text-muted-foreground uppercase font-semibold px-2 py-1.5">
            Verbindung
          </DropdownMenuLabel>
          <DropdownMenuLabel className="font-normal">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Backend</span>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
                <span className="text-xs">{getStatusText()}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuLabel className="font-normal">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">WebSocket</span>
              <div className="flex items-center gap-2">
                {getWsStatusIcon()}
                <span className="text-xs">{getWsStatusText()}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href="/settings?section=sync" className={syncConfig?.is_production ? "cursor-pointer opacity-50" : "cursor-pointer"}>
              <div className="flex items-center justify-between w-full">
                <span className="text-xs text-muted-foreground">Sync</span>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getSyncStatusColor()}`} />
                  {getSyncDirectionIcon()}
                  <span className="text-xs">{syncConfig?.is_production ? "Deaktiviert" : getSyncStatusText()}</span>
                </div>
              </div>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings?section=printer" className="cursor-pointer">
              <div className="flex items-center justify-between w-full">
                <span className="text-xs text-muted-foreground">Drucker</span>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${getPrinterStatusColor()}`} />
                  <span className="text-xs">{getPrinterStatusText()}</span>
                </div>
              </div>
            </Link>
          </DropdownMenuItem>

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
          <DropdownMenuItem asChild>
            <Link href="/help" className="cursor-pointer">
              <HelpCircle className="mr-2 h-4 w-4" />
              <span>Hilfe</span>
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
