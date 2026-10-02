"use client"

/**
 * The quiet line under a text field of the Einsatz detail — «Wird gespeichert
 * …», «Gespeichert – 09:41», «Nicht gespeichert» — and, on a failure, the kept
 * text's two ways out («Erneut speichern», «Text kopieren»).
 *
 * Option B of the save-status mockups (runde3-neu §3): the line sits under the
 * field being saved, because that is where the operator is looking and where
 * a failure has to be said anyway. One field's line follows only that field —
 * see `lib/field-save` for what «Gespeichert» is allowed to mean.
 *
 * «Gespeichert» does not stay. The Reko form's footer kept saying «Gespeichert
 * um 20:14» through twenty minutes of failed saves; a confirmation that lingers
 * turns into a claim about a later edit it never saw. So it shows for a few
 * seconds after the server answered and then the line is empty again — quiet
 * is the normal state. «Wird gespeichert» and «Nicht gespeichert» stay as long
 * as they are true.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Check, Copy, Loader2, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog"
import {
  getFieldSave,
  subscribeFieldSave,
  unsavedFieldDrafts,
  watchFieldSave,
  type FieldSaveEntry,
  type SavedTextField,
} from "@/lib/field-save"
import { formatClockTime } from "@/lib/incident-time"
import { cn, copyToClipboard } from "@/lib/utils"

/** How long «Gespeichert – hh:mm» stays before the line goes quiet. */
export const SAVED_LINE_MS = 5_000

/** The red edge a field gets while it holds text the server has not got. */
export const FIELD_UNSAVED_CLASS =
  "border-destructive ring-[3px] ring-destructive/20 hover:border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30 dark:ring-destructive/40"

export interface FieldSaveView {
  entry: FieldSaveEntry | undefined
  /** What the field shows: the operator's draft while one is held, else the board. */
  value: string
  failed: boolean
  /** The draft to send again, or null when there is nothing to retry. */
  draft: string | null
  /** The server's text moved away from where this run of edits started —
   *  somebody else changed the field. Said out loud next to the kept draft. */
  changedOnServer: boolean
  serverValue: string
}

/**
 * The save state of one text field of one incident. Registers the field as on
 * screen (the context then leaves the failure to it instead of toasting).
 */
export function useFieldSave(incidentId: string, field: SavedTextField, serverValue: string | null | undefined): FieldSaveView {
  const entry = useSyncExternalStore(
    subscribeFieldSave,
    () => getFieldSave(incidentId, field),
    () => undefined,
  )
  useEffect(() => watchFieldSave(incidentId), [incidentId])

  const server = serverValue ?? ""
  return useMemo(() => {
    const draft = entry?.draft ?? null
    const failed = entry?.status === "failed"
    return {
      entry,
      value: draft ?? server,
      failed,
      draft,
      changedOnServer: failed && draft !== null && server !== entry!.base && server !== draft,
      serverValue: server,
    }
  }, [entry, server])
}

export function FieldSaveStatus({
  view,
  onRetry,
  className,
}: {
  view: FieldSaveView
  /** Send the kept draft again — the caller's own update path. */
  onRetry: (draft: string) => void
  className?: string
}) {
  const t = useTranslations("kanban.fieldSave")
  const { entry } = view
  const savedAt = entry?.status === "saved" ? entry.savedAt : null
  // The savedAt whose line has run out — compared by identity, so a newer
  // confirmation shows at once without waiting for an effect to reset a flag.
  const [expiredSavedAt, setExpiredSavedAt] = useState<Date | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!savedAt) return
    const left = Math.max(0, SAVED_LINE_MS - (Date.now() - savedAt.getTime()))
    const id = window.setTimeout(() => setExpiredSavedAt(savedAt), left)
    return () => window.clearTimeout(id)
  }, [savedAt])

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2_000)
    return () => window.clearTimeout(id)
  }, [copied])

  const copy = useCallback(async () => {
    if (view.draft === null) return
    try {
      await copyToClipboard(view.draft)
      setCopied(true)
    } catch {
      // The text is still in the field to select by hand; nothing to add.
    }
  }, [view.draft])

  if (!entry) return null

  if (entry.status === "pending" || entry.status === "saving") {
    return (
      <p role="status" aria-live="polite" className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Loader2 className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {t("saving")}
      </p>
    )
  }

  if (entry.status === "saved") {
    if (!entry.savedAt || expiredSavedAt === entry.savedAt) return null
    return (
      <p role="status" aria-live="polite" className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <Check className="size-3 shrink-0 text-success" aria-hidden="true" />
        {t("savedAt", { time: formatClockTime(entry.savedAt) })}
      </p>
    )
  }

  // failed
  return (
    <div className={cn("space-y-2", className)}>
      <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
        <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-semibold">{t("failed")}</span>{" "}
          {t("failedBody", { reason: t(`reason.${entry.reason ?? "unknown"}`) })}
        </span>
      </p>
      {view.changedOnServer && (
        <p className="text-xs text-muted-foreground">
          {view.serverValue.trim()
            ? t("serverNow", { text: view.serverValue })
            : t("serverNowEmpty")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="xs" onClick={() => view.draft !== null && onRetry(view.draft)}>
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {t("retry")}
        </Button>
        <Button type="button" variant="secondary" size="xs" onClick={() => void copy()}>
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  )
}

/** The field names `unsavedFieldDrafts` reports, in the detail's own words. */
const FIELD_LABEL_KEY: Record<SavedTextField, string> = {
  notes: "common.meldung",
  contact: "common.contact",
  contactPhone: "common.contactPhone",
  internalNotes: "common.notes",
  nachbarhilfeNote: "common.nachbarhilfe",
  amWartenNote: "common.amWarten",
}

/**
 * «Leaving» an Einsatz whose text did not reach the server: ask first.
 *
 * Nothing is lost by closing — the draft is held for this user and Ereignis
 * until the page is reloaded, and the field shows it again on return — but an
 * operator who closes the detail stops seeing the red line, and a Meldung that
 * silently never arrived is exactly what this whole feature exists to prevent.
 * A reload or tab close is guarded by the context's `beforeunload`.
 */
export function useUnsavedDraftLeaveGuard(incidentId: string | null | undefined) {
  const t = useTranslations("kanban")
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const [fields, setFields] = useState<SavedTextField[]>([])

  const guard = useCallback(
    (leave: () => void) => {
      const drafts = incidentId ? unsavedFieldDrafts(incidentId) : []
      if (drafts.length === 0) {
        leave()
        return
      }
      setFields(drafts.map((d) => d.field))
      setPendingLeave(() => leave)
    },
    [incidentId],
  )

  const dialog = (
    <UnsavedChangesDialog
      open={pendingLeave !== null}
      onOpenChange={(open) => {
        if (!open) setPendingLeave(null)
      }}
      onConfirm={() => {
        const leave = pendingLeave
        setPendingLeave(null)
        leave?.()
      }}
      title={t("fieldSave.leave.title")}
      description={t("fieldSave.leave.description", {
        fields: fields.map((f) => `«${t(FIELD_LABEL_KEY[f])}»`).join(", "),
        count: fields.length,
      })}
      confirmText={t("fieldSave.leave.confirm")}
      cancelText={t("fieldSave.leave.cancel")}
    />
  )

  return { guard, dialog }
}
