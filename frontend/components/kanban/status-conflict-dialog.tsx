"use client"

import { useRef, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useOperations } from "@/lib/contexts/operations-context"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { dismissStatusConflict, formatStaleAgo, useStatusConflict } from "@/lib/status-conflict"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"

/**
 * «Gerade geändert» – the server refused a status move because somebody else had
 * moved the card first (lib/status-conflict.ts). Mounted once in the root layout;
 * every status path reports into it. Nothing has changed when it opens, and the
 * board already shows the card where the server has it.
 *
 * Who, what, «Jetzt» vs «Du wolltest». The ink button – focused, and what Esc
 * means – keeps the server's state. «Trotzdem …» names what it does and resends
 * the move with `override_status`; the server records it with the stale mark.
 */
export function StatusConflictDialog() {
  const conflict = useStatusConflict()
  const { operations, updateOperation } = useOperations()
  const t = useTranslations("kanban")
  const tStatus = useTranslations("incidents.status")
  const keepRef = useRef<HTMLButtonElement>(null)

  if (!conflict) return null

  const operation = operations.find((o) => o.id === conflict.operationId)
  const label = operation
    ? (operation.locationDisplay ?? formatLocationForDisplay(operation.location, getGlobalHomeCity())) ||
      getIncidentTypeLabel(operation.incidentType)
    : t("statusConflict.fallbackLabel")
  const ago = formatStaleAgo(conflict.secondsAgo, t)
  const current = tStatus(conflict.current)
  const action = t(`statusConflict.force.${conflict.wanted}`)
  const closed = conflict.current === "complete"
  const reopens = closed && conflict.wanted !== "complete"
  const bold = (chunks: ReactNode) => <span className="font-medium text-foreground">{chunks}</span>
  const what = { label, ago, statusLabel: current, b: bold }

  const force = () => {
    dismissStatusConflict()
    updateOperation(conflict.operationId, { status: conflict.wanted }, { seen: conflict.seen, override: conflict.current })
  }

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) dismissStatusConflict() }}>
      <AlertDialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          keepRef.current?.focus()
        }}
        data-testid="status-conflict-dialog"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertCircle className="size-5 shrink-0 text-warning-foreground" aria-hidden="true" />
            {t("statusConflict.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {conflict.changedBy
              ? t.rich(closed ? "statusConflict.byWhoComplete" : "statusConflict.byWho", { ...what, who: conflict.changedBy })
              : t.rich(closed ? "statusConflict.byNobodyComplete" : "statusConflict.byNobody", what)}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border px-3.5 py-3 text-sm">
          <dt className="text-muted-foreground">{t("statusConflict.now")}</dt>
          <dd className="min-w-0 break-words">
            <span className="font-medium">{current}</span>
            {reopens && conflict.released && (
              <span className="text-muted-foreground"> · {t("statusConflict.released", { names: conflict.released })}</span>
            )}
          </dd>
          <dt className="text-muted-foreground">{t("statusConflict.wanted")}</dt>
          <dd className="min-w-0 break-words">
            {tStatus(conflict.seen)} → {tStatus(conflict.wanted)}
          </dd>
        </dl>

        {(reopens || conflict.wanted === "complete") && (
          <p className="text-xs text-muted-foreground">
            {reopens
              ? conflict.released
                ? t("statusConflict.reopensAndAssigns", { action, names: conflict.released })
                : t("statusConflict.reopens", { action })
              : t("statusConflict.completes", { action })}
          </p>
        )}

        <AlertDialogFooter>
          <Button variant="outline" onClick={force}>
            {action}
          </Button>
          <Button ref={keepRef} onClick={dismissStatusConflict}>
            {t("statusConflict.keep", { status: current })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
