"use client";

import { useTranslations } from "next-intl";
import { ListFilter } from "lucide-react";

import { useOperations } from "@/lib/contexts/operations-context";

/**
 * Warns when the board is not showing every incident in the event.
 *
 * The server caps `GET /api/incidents` and no production caller has ever passed a limit, so
 * a busy event silently rendered an arbitrary subset — a plain array looks the same whether
 * it is complete or cut off. During a storm, which is the only time the cap is reachable,
 * the operator had no way to know incidents existed that the board was not drawing.
 *
 * The cap has been raised well above realistic use; this exists so that if it is ever hit
 * again, it is visible rather than silent. A ceiling nobody can see is the actual defect.
 */
export function IncidentTruncationBanner() {
  const t = useTranslations("common.incidentTruncation");
  const { operations, incidentTotal } = useOperations();

  // null = unknown (older backend, or a proxy stripping the header). Unknown must never be
  // read as "truncated", or every such deployment would show a permanent false warning.
  if (incidentTotal === null) return null;
  const shown = operations.length;
  if (incidentTotal <= shown) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning-foreground"
    >
      <ListFilter className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span className="font-medium">{t("message", { shown, total: incidentTotal })}</span>
    </div>
  );
}
