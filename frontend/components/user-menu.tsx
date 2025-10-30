'use client';

/**
 * User menu component
 * Displays current user info and logout button in a settings dropdown
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Settings, User, FileText, LogOut, Users, FileSpreadsheet, BarChart3, ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { getApiUrl } from '@/lib/env';
import { useSyncStatus } from '@/lib/hooks/use-sync-status';
import { useRailwayRecovery } from '@/lib/hooks/use-railway-recovery';
import { apiClient } from '@/lib/api-client';
import type { SyncConfig } from '@/types/sync';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu() {
  const { user, logout, isEditor, isAuthenticated } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [apiUrl] = useState(getApiUrl());
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);

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
        return "bg-green-500";
      case "disconnected":
        return "bg-red-500";
      case "checking":
        return "bg-yellow-500";
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
      return "bg-gray-400";
    }

    if (syncError || !syncStatus) {
      return "bg-red-500";
    }

    if (syncStatus.is_syncing) {
      return "bg-yellow-500";
    }

    if (!syncStatus.railway_healthy) {
      return "bg-red-500";
    }

    if (isStale) {
      return "bg-orange-500";
    }

    return "bg-green-500";
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-lg">
          <User className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user.username}</p>
            <p className="text-xs leading-none text-muted-foreground">
              {isEditor ? 'Editor' : 'Betrachter'}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Backend</span>
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${getStatusColor()}`} />
              <span className="text-xs">{getStatusText()}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=sync" className={syncConfig?.is_production ? "cursor-pointer opacity-50" : "cursor-pointer"}>
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
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            <span>Einstellungen</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/stats" className="cursor-pointer">
            <BarChart3 className="mr-2 h-4 w-4" />
            <span>Statistiken</span>
          </Link>
        </DropdownMenuItem>
        {isEditor && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/resources" className="cursor-pointer">
                <Users className="mr-2 h-4 w-4" />
                <span>Ressourcen</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/admin/import" className="cursor-pointer">
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                <span>Daten Import/Export</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/admin/audit" className="cursor-pointer">
                <FileText className="mr-2 h-4 w-4" />
                <span>Audit-Protokoll</span>
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} variant="destructive">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Abmelden</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
