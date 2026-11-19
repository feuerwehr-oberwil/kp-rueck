"use client"

/**
 * RekoModusPanel — editor-only reko dispatching panel for the `/map` page; on a phone the order
 * is only shown (no dragging – the desk plans, as in the Routenplanung).
 *
 * Sibling of RoutenplanungPanel (same aside-swap pattern) and built the same way (owner,
 * 19.11.2026: «reko and auftrag behave the same but just show things differently», mock 2a):
 * ONE Reko person is picked in a dropdown – a single choice, so no tick boxes – each with their
 * map colour and open count. Their open Rekos follow as a timeline in their order, numbered like
 * their pins on the map and dragged to reorder (the shared `RouteStopList`, `kind="reko"`).
 * The order is real data: it is the order of the person's /feld list.
 *
 * Tapping a marker on the map still assigns the picked person (as the next number) or takes an
 * Einsatz already theirs off them – the page does that (`app/map/page.tsx`). «Person als Reko
 * markieren» opens the Reko candidate picker in place.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Binoculars, MousePointerClick, X, Plus, ArrowLeft, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { FormMessage } from "@/components/ui/form-message"
import { ShellLoader } from "@/components/ui/shell-loader"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useIsMobile } from "@/components/ui/use-mobile"
import { RESOURCE_FREE_TEXT_CLASS } from "@/lib/resource-status"
import { apiClient } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"
import { useRekoReorder } from "@/lib/hooks/use-reko-reorder"
import { REKO_PICK_MESSAGE_ID, useRekoCandidatePicker } from "@/components/incidents/assign-reko-dialog"
import { RouteStopList, RouteTimelineItem, TIMELINE_ROW, TimelineNode } from "./route-stop-list"

// The Reko list is never an optimise preview, so nothing is ever «changed».
const EMPTY_CHANGED: Set<string> = new Set()

interface RekoModusPanelProps {
  people: Person[]
  /** Open (assigned, reko not yet done) operations per reko person id, each in that person's order. */
  openByPerson: Map<string, Operation[]>
  /** Map colour per Reko person id (`rekoPersonColor`). */
  colors: Map<string, string>
  selectedPersonId: string | null
  onSelectPerson: (id: string | null) => void
  onExit: () => void
}

export function RekoModusPanel({
  people,
  openByPerson,
  colors,
  selectedPersonId,
  onSelectPerson,
  onExit,
}: RekoModusPanelProps) {
  const t = useTranslations("map.rekoMode")
  const tAssign = useTranslations("incidents.assignReko")
  const tPick = useTranslations("common.personPick")
  const { selectedEvent } = useEvent()
  const { personnel, operations, refreshOperations } = useOperations()
  const reorder = useRekoReorder()
  // Read-only on a phone, like the Routenplanung: the order is shown, not dragged.
  const isPhone = useIsMobile()
  const [markMode, setMarkMode] = useState(false)
  const [marking, setMarking] = useState(false)
  const [pickMessage, setPickMessage] = useState<string | null>(null)
  const mark = useRekoCandidatePicker({ personnel, operations, disabled: marking })
  const selectedPerson = people.find((p) => p.id === selectedPersonId) ?? null
  const open = selectedPerson ? openByPerson.get(selectedPerson.id) ?? [] : []
  const openIds = open.map((op) => op.id)
  const operationsById = new Map(open.map((op) => [op.id, op]))

  const openMarkMode = (next: boolean) => {
    setMarkMode(next)
    setPickMessage(null)
    mark.reset()
  }

  // Mark the ticked checked-in person as event Reko, then pre-select them for tapping.
  const handleMarkPerson = async (person: Person | null) => {
    if (!person) {
      setPickMessage(tPick("noneChosen"))
      return
    }
    if (!selectedEvent) return
    setMarking(true)
    try {
      await apiClient.assignSpecialFunction(selectedEvent.id, {
        personnel_id: person.id,
        function_type: "reko",
        vehicle_id: null,
      })
      await refreshOperations()
      onSelectPerson(person.id)
      setMarkMode(false)
    } catch (err) {
      console.error("Failed to mark Reko personnel:", err)
      toast.error(tAssign("assignErrorTitle"), { description: tAssign("markError") })
    } finally {
      setMarking(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Binoculars className="h-5 w-5" />
          {t("title")}
        </h2>
        <Button variant="ghost" size="sm" onClick={onExit}>
          <X className="size-3.5" />
          {t("exit")}
        </Button>
      </div>

      {markMode ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="self-start mb-2 -ml-2"
            onClick={() => openMarkMode(false)}
          >
            <ArrowLeft className="size-3.5" />
            {t("back")}
          </Button>
          <div className="mb-3 space-y-2">
            {mark.searchField}
            <FormMessage id={REKO_PICK_MESSAGE_ID}>{pickMessage}</FormMessage>
          </div>
          <div role="radiogroup" aria-label={t("addPerson")} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">{mark.list}</div>
          <Button className="mt-3" onClick={() => void handleMarkPerson(mark.chosen)} disabled={marking}>
            {marking ? <ShellLoader className="size-4" /> : <Binoculars className="size-4" />}
            {t("addPerson")}
          </Button>
        </>
      ) : people.length === 0 ? (
        <EmptyState
          title={t("empty")}
          description={t("emptyHint")}
          action={{ label: t("addPerson"), icon: Plus, onClick: () => openMarkMode(true) }}
        />
      ) : (
        <>
          {/* The person the map taps assign – ONE of them, so a dropdown like the
              Routenplanung's Auftrag picker. The dot is the person's colour on the map. */}
          <div className="mb-3 flex items-center gap-2">
            <Select value={selectedPersonId ?? undefined} onValueChange={(id) => onSelectPerson(id)}>
              <SelectTrigger className="h-9 min-w-[7rem] flex-1" aria-label={t("personLabel")}>
                <SelectValue placeholder={t("selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {people.map((person) => {
                  const count = openByPerson.get(person.id)?.length ?? 0
                  return (
                    <SelectItem key={person.id} value={person.id}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colors.get(person.id) }}
                        />
                        <span className="truncate">{person.name}</span>
                        {count > 0 ? (
                          <span className="whitespace-nowrap text-xs text-muted-foreground">· {t("openCount", { count })}</span>
                        ) : (
                          <span className={`whitespace-nowrap text-xs ${RESOURCE_FREE_TEXT_CLASS}`}>· {t("free")}</span>
                        )}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="outline"
                  className="shrink-0 max-md:size-11"
                  onClick={() => openMarkMode(true)}
                  aria-label={t("addPerson")}
                >
                  <UserPlus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("addPerson")}</TooltipContent>
            </Tooltip>
          </div>

          {selectedPerson && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold">{t("order")}</span>
                <span className="text-xs text-muted-foreground">{t("rekoCount", { count: open.length })}</span>
              </div>
              {/* The timeline: the person's open Rekos in their order, then where more come
                  from. Only as tall as its rows; it scrolls once they outgrow the panel
                  (`relative`: the rows' sr-only status words stay inside the scroller). */}
              <div className="relative -mx-1 min-h-0 overflow-y-auto overscroll-contain px-1 max-md:pb-nav-reserve">
                <ol className="@container">
                  <RouteStopList
                    listId={selectedPerson.id}
                    kind="reko"
                    stopIds={openIds}
                    displayOrder={openIds}
                    operationsById={operationsById}
                    changedPositions={EMPTY_CHANGED}
                    reorderDisabled={isPhone}
                    onReorder={(ids) => void reorder(selectedPerson.id, ids)}
                    focusStopId={null}
                    onSelectStop={() => {}}
                    showStatusControl={false}
                    readOnly={isPhone}
                    timelineColor={colors.get(selectedPerson.id)}
                  />
                  {/* The last node says how a Reko joins: a tap on the map, as the next number. */}
                  <RouteTimelineItem>
                    <div className={TIMELINE_ROW}>
                      <TimelineNode className="border-dashed border-muted-foreground/70 bg-transparent text-muted-foreground shadow-none">
                        <Plus className="size-3.5" />
                      </TimelineNode>
                      <span className="min-w-0 flex-1 pt-1 leading-tight">
                        <span className="block text-sm font-medium">{t("addReko")}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{t("addRekoHint")}</span>
                      </span>
                    </div>
                  </RouteTimelineItem>
                </ol>
              </div>
            </>
          )}

          {/* How the mode works – below the list, there when needed, not in the way (sign-off 19.11.). */}
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-2.5 text-xs text-muted-foreground">
            <MousePointerClick className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <p>
              {selectedPerson ? t("hintAssign", { name: selectedPerson.name }) : t("hintSelect")}
              {/* Only where the order can be dragged. */}
              {selectedPerson && !isPhone && <> {t("hintOrder", { name: selectedPerson.name })}</>}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
