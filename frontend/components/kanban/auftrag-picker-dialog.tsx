"use client"

/**
 * AuftragPickerDialog — distribute a single incident into an Auftrag (route).
 *
 * Lists the current event's Aufträge (the incident's current route is marked and
 * disabled) plus an inline "Neuer Auftrag" create row. Choosing a route calls
 * `onChoose(groupId)`; the caller runs `addStops(groupId, [incidentId])` which
 * MOVES the incident into that route.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Route as RouteIcon, Plus, Check, Unlink } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { IncidentGroup } from "@/lib/contexts/groups-context"

interface AuftragPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: IncidentGroup[]
  /** The incident's current route (marked "already here", not selectable). */
  currentGroupId: string | null
  onChoose: (groupId: string) => void
  /** Create a new Auftrag, then distribute into it. Returns the new group. */
  onCreate: (name: string) => Promise<IncidentGroup | null>
  /** Detach the incident from its current route (only when it's already in one). */
  onRemoveFromCurrent?: () => void
}

export function AuftragPickerDialog({
  open,
  onOpenChange,
  groups,
  currentGroupId,
  onChoose,
  onCreate,
  onRemoveFromCurrent,
}: AuftragPickerDialogProps) {
  const t = useTranslations("kanban.auftragPicker")
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCreating(false)
      setNewName("")
    }
    onOpenChange(next)
  }

  const choose = (groupId: string) => {
    if (groupId === currentGroupId) return
    onChoose(groupId)
    handleOpenChange(false)
  }

  const removeFromCurrent = () => {
    onRemoveFromCurrent?.()
    handleOpenChange(false)
  }

  const confirmCreate = async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const created = await onCreate(name)
      if (created) {
        onChoose(created.id)
        handleOpenChange(false)
      }
    } finally {
      // Without the finally, a rejected onCreate stranded `busy` at true. This
      // component stays mounted while the dialog is closed, so the flag — and
      // the early return above that reads it — survived closing and reopening:
      // creating an Auftrag stayed impossible until a full page reload.
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex modal-h-tall sm:max-w-md flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
          {groups.length === 0 && !creating && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <RouteIcon className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </div>
          )}

          {groups.map((group) => {
            const isCurrent = group.id === currentGroupId
            return (
              <button
                key={group.id}
                type="button"
                disabled={isCurrent}
                onClick={() => choose(group.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                  isCurrent ? "cursor-default opacity-60" : "hover:bg-muted/50",
                )}
              >
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full border border-black/10"
                  style={{ backgroundColor: group.color ?? "var(--muted-foreground)" }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
                <span className="flex-shrink-0 text-xs text-muted-foreground">
                  {isCurrent ? t("alreadyHere") : t("stopCount", { count: group.stopIds.length })}
                </span>
                {isCurrent && <Check className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
              </button>
            )
          })}
        </div>

        {creating ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmCreate()
                if (e.key === "Escape") setCreating(false)
              }}
              placeholder={t("namePlaceholder")}
              className="h-9 flex-1"
            />
            <Button size="sm" onClick={confirmCreate} disabled={!newName.trim() || busy}>
              {t("createConfirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              {t("cancel")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              {t("newAuftrag")}
            </Button>
            {/* Already in a route → offer to detach it entirely. */}
            {currentGroupId && onRemoveFromCurrent && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-destructive hover:text-destructive"
                onClick={removeFromCurrent}
              >
                <Unlink className="size-3.5" />
                {t("removeFromAuftrag")}
              </Button>
            )}
          </div>
        )}

        {/* Explicit close — the inline create-row has its own ghost cancel, so the
            footer only shows outside create mode to avoid two "Abbrechen"s. */}
        {!creating && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
              {t("cancel")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
