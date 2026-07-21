"use client"

/**
 * IncidentPickerDialog — pick EXISTING incidents to add as stops to an Auftrag.
 *
 * A searchable, multi-select list of the current event's incidents. Picking an
 * incident that already belongs to another Auftrag MOVES it into the target
 * route (the backend `addStops` reassigns `group_id`), so those rows show a small
 * badge of their current route. Incidents already in the target route are hidden.
 */

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Search, Route as RouteIcon, Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { columns } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import type { Operation } from "@/lib/contexts/operations-context"
import type { IncidentGroup } from "@/lib/contexts/groups-context"

interface IncidentPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** All incidents of the current event (already event-scoped by the context). */
  operations: Operation[]
  groups: IncidentGroup[]
  /** The target route — its own stops are hidden (they're already members). */
  targetGroupId: string | null
  onConfirm: (incidentIds: string[]) => void
  /** Optional "Neuer Einsatz" affordance (opens the New-Emergency modal). */
  onCreateNew?: () => void
}

function statusLabel(op: Operation): string {
  const col = columns.find((c) => c.status.includes(op.status))
  return col?.title ?? op.status
}

export function IncidentPickerDialog({
  open,
  onOpenChange,
  operations,
  groups,
  targetGroupId,
  onConfirm,
  onCreateNew,
}: IncidentPickerDialogProps) {
  const t = useTranslations("kanban.incidentPicker")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g] as const)), [groups])

  // Candidates: every event incident that isn't already a stop of the target route.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return operations
      .filter((op) => op.groupId !== targetGroupId)
      .filter((op) => {
        if (!q) return true
        return (
          op.location.toLowerCase().includes(q) ||
          getIncidentTypeLabel(op.incidentType).toLowerCase().includes(q)
        )
      })
  }, [operations, targetGroupId, query])

  // Reset transient state whenever the dialog transitions closed.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("")
      setSelected(new Set())
    }
    onOpenChange(next)
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirm = () => {
    if (selected.size === 0) return
    onConfirm(Array.from(selected))
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-lg flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-9 pl-8"
          />
        </div>

        <div className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
          {candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <RouteIcon className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            </div>
          ) : (
            candidates.map((op) => {
              const otherGroup = op.groupId ? groupById.get(op.groupId) : undefined
              const isChecked = selected.has(op.id)
              return (
                <label
                  key={op.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50",
                    isChecked && "bg-primary/[0.06]",
                  )}
                >
                  <Checkbox checked={isChecked} onCheckedChange={() => toggle(op.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {op.location || getIncidentTypeLabel(op.incidentType)}
                      </span>
                      {otherGroup && (
                        <span
                          className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          title={t("inRoute", { name: otherGroup.name })}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: otherGroup.color ?? "var(--muted-foreground)" }}
                          />
                          {otherGroup.name}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {getIncidentTypeLabel(op.incidentType)} · {statusLabel(op)}
                    </p>
                  </div>
                </label>
              )
            })
          )}
        </div>

        <DialogFooter className="flex-shrink-0 sm:justify-between">
          {onCreateNew ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                handleOpenChange(false)
                onCreateNew()
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("createNew")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button size="sm" onClick={confirm} disabled={selected.size === 0}>
              {t("confirm", { count: selected.size })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
