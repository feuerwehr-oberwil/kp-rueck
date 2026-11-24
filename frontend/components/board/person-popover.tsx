"use client"

/**
 * The person popover – left click on a person in the Personen-Leiste (owner picks 1B
 * «Eine Checkliste» and 7A «Im Popover», 24.11.2026; UX.1, UX.2, UX.11, UX.15).
 *
 * One list: what the person holds is ticked on top (Einsätze, Aufträge, then the functions),
 * the rest unticked below. Untick an Einsatz/Auftrag = release it (the board's undo toast,
 * `useReleaseUndo`); untick a function = end it (asks first); tick = take it. The functions
 * are `usePersonFunctions`' items – the right-click menu's – so both clicks show one thing.
 * No row is a dead end: an Einsatz/Auftrag opens, «Fahrer ›» picks the vehicle, a function
 * toggles.
 *
 * The footer: «Anwesend seit 17:08» + «Auschecken» (a person still bound gets the Appell's
 * own question first, `CheckOutAssignedDialog`; a free one goes at once – the server refuses
 * if they are bound after all, and the question comes then – with an undo of exactly that
 * departure), and the
 * plan («kommt um» / «geht um») with the Appell's picker and API call.
 *
 * Everything is read live from the board while the popover is open; a viewer sees the ticks
 * and times but changes nothing.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ArrowUpRight, Check, ChevronRight, LogOut, Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { PersonName } from "@/components/person-name"
import { CheckOutAssignedDialog } from "@/components/attendance/check-out-assigned-dialog"
import { PlannedTimeChip, PlannedTimePicker, type PlanKind } from "@/components/attendance/planned-time"
import { STATION_FUNCTION_ICONS, stationFunctionLabel } from "@/components/kanban/person-function-labels"
import { usePersonFunctions } from "@/components/kanban/use-person-functions"
import { apiClient } from "@/lib/api-client"
import { ApiError } from "@/lib/api/types"
import type { ResourceBinding } from "@/lib/board-sidebar"
import { useOperations, type Person } from "@/lib/contexts/operations-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { REKO_TARGET } from "@/lib/detail-target"
import { formatTime } from "@/lib/format-time"
import type { useReleaseUndo } from "@/lib/hooks/use-release-undo"
import { getIncidentRefLabel } from "@/lib/incident-types"
import { personChecklist, type ChecklistRow } from "@/lib/person-functions"
import { undoToast } from "@/lib/toast-undo"
import { cn } from "@/lib/utils"

export interface PersonPopoverBodyProps {
  /** The live roster row. */
  person: Person
  /** Its Einsätze and Aufträge (`collectPersonPlaces`). */
  places: ResourceBinding[]
  onGo: (binding: ResourceBinding) => void
  onClose: () => void
  /** Editors change things; a viewer reads. */
  canEdit: boolean
  eventId: string | null
  /** The board's own release-with-undo (app/page.tsx), so the toast outlives this popover. */
  release: Pick<ReturnType<typeof useReleaseUndo>, "releaseCrew" | "releaseRouteResource">
}

export function PersonPopoverBody({ person, places, onGo, onClose, canEdit, eventId, release }: PersonPopoverBodyProps) {
  const t = useTranslations("kanban")
  const tp = useTranslations("kanban.personPopover")
  const tCommon = useTranslations("kanban.common")
  const tAttendance = useTranslations("kanban.attendance")
  const tPlan = useTranslations("common.attendancePlan")
  const { operations, removeReko, refreshOperations } = useOperations()
  const { getGroupResources } = useGroups()
  const { items, toggle, busy, dialogs } = usePersonFunctions({
    personnelId: person.id,
    personnelName: person.name,
    enabled: true,
  })
  const [vehicleMenuOpen, setVehicleMenuOpen] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)

  const driven = items.find((item) => item.kind === "driver" && item.held)
  const drivenOp = driven?.kind === "driver"
    ? operations.find((op) => op.status !== "complete" && op.vehicles.some((v) => v.vehicleId === driven.vehicleId))
    : undefined
  const checklist = personChecklist(places, items, drivenOp ? { id: drivenOp.id, label: getIncidentRefLabel(drivenOp, 60) } : null)
  const editable = canEdit && !!eventId

  const releasePlace = (binding: ResourceBinding) => {
    if (!binding.targetId) return
    if (binding.kind === "incident") {
      // Reko on an Einsatz: the card chip's ✕, which has no undo either.
      if (binding.target === REKO_TARGET) removeReko(binding.targetId)
      else void release.releaseCrew(binding.targetId, person.id)
    } else if (binding.kind === "route") {
      const assignmentId = getGroupResources(binding.targetId).personnel.find((p) => p.resourceId === person.id)?.assignmentId
      if (assignmentId) void release.releaseRouteResource(binding.targetId, assignmentId)
    }
  }

  /** What the check-out question names: every held row, as it reads here. */
  const heldLabel = (row: ChecklistRow): string => {
    switch (row.kind) {
      case "place":
        return row.binding.label
      case "driver":
        return row.held ? t("person.driverFunction", { vehicle: row.held.vehicleName }) : t("personMenu.driver")
      case "station":
        return stationFunctionLabel(t, row.item.functionType)
    }
  }

  /**
   * `onlyIfFree`: the button's own call for a person shown free – the server refuses (409) when
   * they are bound after all (this board had not caught up), and the popover asks instead.
   * The confirmed call after the question goes without it.
   */
  const checkOut = async ({ onlyIfFree = false }: { onlyIfFree?: boolean } = {}) => {
    if (!eventId) return
    const name = person.name
    let checkedOutAt: string | null
    try {
      checkedOutAt = (await apiClient.checkOutPersonnelForEvent(person.id, eventId, { onlyIfFree })).checked_out_at
    } catch (error) {
      if (onlyIfFree && ApiError.isConflictError(error)) {
        // The question names what binds them once the board has the new state.
        void refreshOperations()
        setConfirmOut(true)
        return
      }
      console.error("Check-out failed:", error)
      toast.error(tAttendance("writeFailed"))
      return
    }
    onClose()
    void refreshOperations()
    undoToast(tp("checkedOut", { name }), {
      onUndo: async () => {
        try {
          // The same stint again: «anwesend seit» and the plan stay (backend `resume`) – but
          // only this departure; a later check-in or check-out answers 409.
          if (!checkedOutAt) throw new Error("check-out answered no checked_out_at")
          await apiClient.checkInPersonnelForEvent(person.id, eventId, { resume: checkedOutAt })
          void refreshOperations()
        } catch (error) {
          if (ApiError.isConflictError(error)) {
            toast.error(tp("undoGone", { name }))
            void refreshOperations()
            return
          }
          console.error("Undo check-out failed:", error)
          toast.error(tAttendance("writeFailed"))
        }
      },
    })
  }

  const setPlan = async (kind: PlanKind, iso: string | null) => {
    if (!eventId) return
    await apiClient.setAttendancePlan(person.id, { eventId }, kind === "until" ? { planned_until: iso } : { planned_from: iso })
    void refreshOperations()
  }

  const row = (entry: ChecklistRow, held: boolean) => {
    switch (entry.kind) {
      case "place": {
        const { binding } = entry
        const detail = [binding.detail, entry.drives ? tp("drives", { vehicle: entry.drives }) : null].filter(Boolean).join(" · ")
        return (
          <ChecklistLine
            key={binding.key}
            checked
            label={binding.label}
            disabled={!editable}
            onCheckedChange={() => releasePlace(binding)}
          >
            <button
              type="button"
              onClick={() => {
                onGo(binding)
                onClose()
              }}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold" title={binding.label}>{binding.label}</span>
                {detail && <span className="block truncate text-2xs text-muted-foreground">{detail}</span>}
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </ChecklistLine>
        )
      }
      case "driver": {
        const label = t("personMenu.driver")
        const detail = entry.held
          ? [entry.held.vehicleName, entry.where].filter(Boolean).join(" · ")
          : tp("driverPick")
        return (
          <ChecklistLine
            key="driver"
            checked={held}
            label={label}
            disabled={!editable || busy}
            // A tick needs a vehicle: it opens the choice. Untick ends the held one (asks).
            onCheckedChange={() => (entry.held ? toggle(entry.held) : setVehicleMenuOpen(true))}
          >
            <DropdownMenu open={vehicleMenuOpen} onOpenChange={setVehicleMenuOpen}>
              <DropdownMenuTrigger asChild disabled={!editable}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
                  <Truck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className={cn("text-sm", held && "font-semibold")}>{label}</span>
                  <span className="ml-auto flex min-w-0 items-center gap-0.5 text-2xs text-muted-foreground">
                    <span className="truncate">{detail}</span>
                    {editable && <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" className="w-56">
                {entry.vehicles.map((vehicle) => (
                  <DropdownMenuItem key={vehicle.key} onSelect={() => toggle(vehicle)} className="justify-between">
                    <span className="flex items-center gap-2">
                      <Check className={cn("size-4", !vehicle.held && "invisible")} aria-hidden />
                      {vehicle.vehicleName}
                    </span>
                    {vehicle.holder && (
                      <span className="text-xs text-muted-foreground">
                        <PersonName name={vehicle.holder.name} personnelId={vehicle.holder.personnelId} />
                      </span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </ChecklistLine>
        )
      }
      case "station": {
        const Icon = STATION_FUNCTION_ICONS[entry.item.functionType]
        const label = stationFunctionLabel(t, entry.item.functionType)
        return (
          <ChecklistLine
            key={entry.item.key}
            checked={held}
            label={label}
            disabled={!editable || busy}
            onCheckedChange={() => toggle(entry.item)}
          >
            <button
              type="button"
              disabled={!editable || busy}
              onClick={() => toggle(entry.item)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className={cn("text-sm", held && "font-semibold")}>{label}</span>
              {held && <span className="ml-auto text-2xs text-muted-foreground">{tp("noIncident")}</span>}
            </button>
          </ChecklistLine>
        )
      }
    }
  }

  const since = formatTime(person.checkedInAt)

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            <PersonName name={person.name} personnelId={person.id} kennung={person.kennung} />
          </p>
          {person.role && <p className="truncate text-2xs text-muted-foreground">{person.role}</p>}
        </div>
        {checklist.count > 0 && (
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            {tCommon("bindingsCount", { count: checklist.count })}
          </Badge>
        )}
      </div>

      <div>
        {checklist.held.map((entry) => row(entry, true))}
        {checklist.held.length > 0 && checklist.free.length > 0 && <div className="my-1 border-t border-border" />}
        {checklist.free.map((entry) => row(entry, false))}
      </div>
      {editable && <p className="px-1 text-2xs text-muted-foreground">{tp("hint")}</p>}

      <div className="space-y-2 border-t border-border px-1 pt-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
            {since ? tp("presentSince", { time: since }) : null}
          </span>
          {editable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => (checklist.count > 0 ? setConfirmOut(true) : void checkOut({ onlyIfFree: true }))}
            >
              <LogOut className="size-3.5" aria-hidden />
              {tp("checkOut")}
            </Button>
          )}
        </div>
        {/* The plan, at the bottom (owner, 24.11.2026): the Appell's picker and call. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(["from", "until"] as const).map((kind) => {
            const value = kind === "until" ? person.plannedUntil : person.plannedFrom
            const chip = <PlannedTimeChip kind={kind} at={value} disabled={!editable} />
            return editable ? (
              <PlannedTimePicker
                key={kind}
                kind={kind}
                value={value}
                other={kind === "until" ? person.plannedFrom : person.plannedUntil}
                title={tPlan(kind === "until" ? "titleUntil" : "titleFrom", { name: person.name })}
                hint={tPlan("hintKp")}
                fieldLabel={tPlan(kind === "until" ? "fieldUntil" : "fieldFrom")}
                onSave={(iso) => setPlan(kind, iso)}
                trigger={chip}
              />
            ) : value ? (
              <span key={kind}>{chip}</span>
            ) : null
          })}
        </div>
      </div>

      {dialogs}
      <CheckOutAssignedDialog
        open={confirmOut}
        onOpenChange={setConfirmOut}
        name={person.name}
        where={checklist.held.map(heldLabel).join(", ")}
        onConfirm={() => checkOut()}
      />
    </div>
  )
}

/** One checklist line: the tick (its own target), then the row's main action. */
function ChecklistLine({
  checked,
  label,
  disabled,
  onCheckedChange,
  children,
}: {
  checked: boolean
  label: string
  disabled: boolean
  onCheckedChange: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-8 items-center gap-2.5 rounded-sm px-2 py-1 hover:bg-muted">
      <Checkbox checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onCheckedChange} />
      {children}
    </div>
  )
}
