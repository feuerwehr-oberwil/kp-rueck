"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { CloudOff, RefreshCw, WifiOff } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";

import { Button } from "@/components/ui/button";
import { useBoardSyncStatus, useOperations } from "@/lib/contexts/operations-context";
import { wsClient, type WebSocketStatus } from "@/lib/websocket-client";
import { getRestReachable, onRestReachableChange } from "@/lib/api-client";
import { shouldShowStaleBanner } from "@/lib/stale-data";
import { formatClockTime } from "@/lib/incident-time";
import { cn } from "@/lib/utils";

/**
 * Top-of-app banner that warns operators when realtime updates have been
 * silent for long enough that on-screen data may be out of date. Triggered
 * when the WebSocket is not connected AND the last successful operations
 * load is older than the staleness threshold — or immediately when the
 * api-client reports REST unreachable (repeated connection failures), even
 * if the WebSocket still claims to be connected. Polling continues in the
 * background even when this is showing.
 *
 * Carries a "Neu verbinden" action because socket.io gives up permanently
 * after its reconnect budget and latches the status at 'error'. Without an
 * action here the only route back to realtime was a page reload, which
 * nothing on screen suggested.
 *
 * Two voices (decision 26 A, 2026-09-23):
 *  - a board LOAD failed (`loadError`): red, «Stand 09:55 – Aktualisierung
 *    fehlgeschlagen · Das Board zeigt den letzten geladenen Stand.» The clock
 *    time rather than «vor 4 Min.»: it is what gets compared with the wall
 *    clock and read out on the radio. The wording covers a dead network AND a
 *    server that answered 500 — the banner used to say «Verbindung verloren»
 *    for both, and for the second that is simply untrue;
 *  - otherwise (socket down and the data ageing, or REST unreachable): the
 *    amber «Verbindung verloren», which is then what actually happened.
 * A board that never loaded at all is the board page's own error panel
 * (`BoardLoadErrorPanel`); on that page the banner stands back, elsewhere
 * (map, settings, …) it is the only place that says so.
 */
export function StaleDataBanner() {
  const t = useTranslations('common.staleDataBanner');
  const tLoad = useTranslations('common.boardLoadError');
  const pathname = usePathname();
  const dateLocale = useDateFnsLocale();
  const { refreshOperations } = useOperations();
  const { lastSyncAt, loadError } = useBoardSyncStatus();
  const [wsStatus, setWsStatus] = useState<WebSocketStatus>(wsClient.getStatus());
  const [restReachable, setRestReachable] = useState<boolean>(getRestReachable());
  const [now, setNow] = useState<Date>(() => new Date());
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    return wsClient.onStatusChange(setWsStatus);
  }, []);

  useEffect(() => {
    return onRestReachableChange(setRestReachable);
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const visible = shouldShowStaleBanner({
    wsStatus,
    lastSyncAt,
    now,
    restReachable,
    loadFailed: loadError !== null,
  });

  const handleReconnect = async () => {
    setReconnecting(true);
    wsClient.reconnect();
    try {
      // Pull fresh data straight away rather than making the operator wait on
      // the socket handshake — the board being stale is the actual complaint.
      await refreshOperations();
    } finally {
      setReconnecting(false);
    }
  };

  if (!visible) return null;

  if (loadError !== null) {
    // Never loaded, on the board: the error panel in the board area says it,
    // bigger and with its own retry — two red notices for one fact is noise.
    if (lastSyncAt === null && pathname === '/') return null;
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-foreground"
      >
        <CloudOff className="h-4 w-4 flex-shrink-0 text-destructive" aria-hidden="true" />
        <div className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-semibold">
            {lastSyncAt ? t('loadFailedAt', { time: formatClockTime(lastSyncAt) }) : tLoad('title')}
          </span>
          {lastSyncAt && <span className="text-muted-foreground">{t('showsLastLoaded')}</span>}
        </div>
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 border-destructive/30 bg-background/60 hover:bg-background"
          onClick={handleReconnect}
          disabled={reconnecting}
        >
          <RefreshCw className={cn("size-3.5", reconnecting && "animate-spin")} aria-hidden="true" />
          {t('reload')}
        </Button>
      </div>
    );
  }

  // Defensive: this branch needs a good sync to have happened (see
  // shouldShowStaleBanner), but it must never name a «last update» that wasn't.
  const lastSyncRelative = lastSyncAt
    ? formatDistanceToNowStrict(lastSyncAt, { addSuffix: false, locale: dateLocale })
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground"
    >
      <WifiOff className="h-4 w-4 flex-shrink-0 text-warning-foreground" aria-hidden="true" />
      <div className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="font-medium">
          {t('connectionLost')}
        </span>
        {lastSyncRelative && (
          <span className="text-muted-foreground">
            {t('lastUpdate', { time: lastSyncRelative })}
          </span>
        )}
      </div>
      <Button
        variant="outline"
        size="xs"
        className="shrink-0 border-warning/40 bg-transparent hover:bg-warning/20"
        onClick={handleReconnect}
        disabled={reconnecting}
      >
        <RefreshCw className={cn("size-3.5", reconnecting && "animate-spin")} aria-hidden="true" />
        {t('reconnect')}
      </Button>
    </div>
  );
}
