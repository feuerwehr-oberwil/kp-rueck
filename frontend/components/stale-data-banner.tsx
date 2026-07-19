"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { de } from "date-fns/locale";

import { useOperations } from "@/lib/contexts/operations-context";
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client";
import { shouldShowStaleBanner } from "@/lib/stale-data";

/**
 * Top-of-app banner that warns operators when realtime updates have been
 * silent for long enough that on-screen data may be out of date. Triggered
 * when the WebSocket is not connected AND the last successful operations
 * load is older than the staleness threshold. Polling continues in the
 * background even when this is showing.
 */
export function StaleDataBanner() {
  const t = useTranslations('common.staleDataBanner');
  const { lastSyncAt } = useOperations();
  const [wsStatus, setWsStatus] = useState<WebSocketStatus>(wsClient.getStatus());
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    return wsClient.onStatusChange(setWsStatus);
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const visible = shouldShowStaleBanner({ wsStatus, lastSyncAt, now });

  if (!visible || !lastSyncAt) return null;

  const lastSyncRelative = formatDistanceToNowStrict(lastSyncAt, {
    addSuffix: false,
    locale: de,
  });

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground"
    >
      <WifiOff className="h-4 w-4 flex-shrink-0 text-warning" aria-hidden="true" />
      <div className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-medium">
          {t('connectionLost')}
        </span>
        <span className="text-muted-foreground">
          {t('lastUpdate', { time: lastSyncRelative })}
        </span>
      </div>
    </div>
  );
}
