"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { WifiOff } from "lucide-react";

import { displayStaleLevel } from "@/lib/display-staleness";
import { cn } from "@/lib/utils";

/**
 * Staleness banner for the wall/TV displays (`/display/board`, `/display/status`,
 * `/display/map` — token mode and logged-in alike).
 *
 * Owns its own 1s ticker so callers only have to hand over the timestamp of their last
 * successful poll. Before this existed, `token-board.tsx` reimplemented a flat 30s version
 * inline while the other two displays had no staleness signal at all.
 *
 * Renders nothing while fresh, so it costs a caller one line and no layout when healthy.
 */
export function DisplayStaleBanner({ lastRefresh }: { lastRefresh: Date | null }) {
  const t = useTranslations("display.common");
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const level = displayStaleLevel({ lastRefresh, now });
  if (level === "fresh" || !lastRefresh) return null;

  const time = lastRefresh.toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const alert = level === "alert";

  return (
    <div
      role="status"
      aria-live={alert ? "assertive" : "polite"}
      className={cn(
        "flex items-center justify-center gap-2 border-b px-4 font-medium",
        alert
          // Sized to be legible from across the room, because at this point the screen is
          // actively misleading anyone who glances at it.
          ? "border-destructive/50 bg-destructive/20 py-3 text-destructive-foreground text-lg md:text-2xl tracking-wide uppercase"
          : "border-warning/30 bg-warning/15 py-1.5 text-sm text-warning-foreground",
      )}
    >
      <WifiOff className={cn("flex-shrink-0", alert ? "h-6 w-6 md:h-7 md:w-7" : "h-4 w-4")} aria-hidden="true" />
      <span>{alert ? t("staleAlert", { time }) : t("staleWarn", { time })}</span>
    </div>
  );
}
