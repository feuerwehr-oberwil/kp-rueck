"use client"

/**
 * RekoModusPanel — editor-only reko dispatching panel for the `/map` page.
 *
 * Sibling of RoutenplanungPanel (same aside-swap pattern): pick a reko person
 * here, then tap incident markers on the map to assign them — tap an incident
 * already theirs to unassign. The map itself is the proximity display: the
 * selected person's open incidents are highlighted, so handing them nearby
 * work (instead of zigzag across town) is a matter of looking at the map.
 */

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Binoculars, MousePointerClick, X, Plus, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { FormMessage } from "@/components/ui/form-message"
import { ShellLoader } from "@/components/ui/shell-loader"
import { PersonPickTile } from "@/components/kanban/assignment-list-section"
import { RESOURCE_STATE_BADGE_CLASSES } from "@/lib/resource-status"
import { cn } from "@/lib/utils"
import { apiClient } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"
import { REKO_PICK_MESSAGE_ID, useRekoCandidatePicker } from "@/components/incidents/assign-reko-dialog"

interface RekoModusPanelProps {
  people: Person[]
  /** Open (assigned, reko not yet done) operations per reko person id. */
  openByPerson: Map<string, Operation[]>
  /** Marker colour per person id from the active "Färben nach Reko" legend. */
  legendColors: Map<string, string>
  selectedPersonId: string | null
  onSelectPerson: (id: string | null) => void
  onExit: () => void
}

export function RekoModusPanel({
  people,
  openByPerson,
  legendColors,
  selectedPersonId,
  onSelectPerson,
  onExit,
}: RekoModusPanelProps) {
  const t = useTranslations("map.rekoMode")
  const tAssign = useTranslations("incidents.assignReko")
  const tPick = useTranslations("common.personPick")
  const { selectedEvent } = useEvent()
  const { personnel, refreshOperations } = useOperations()
  const [markMode, setMarkMode] = useState(false)
  const [marking, setMarking] = useState(false)
  const [pickMessage, setPickMessage] = useState<string | null>(null)
  const mark = useRekoCandidatePicker({ personnel, disabled: marking })
  const selectedPerson = people.find((p) => p.id === selectedPersonId) ?? null

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
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain">{mark.list}</div>
          <Button className="mt-3" onClick={() => void handleMarkPerson(mark.chosen)} disabled={marking}>
            {marking ? <ShellLoader className="size-4" /> : <Binoculars className="size-4" />}
            {t("addPerson")}
          </Button>
        </>
      ) : (
        <>
      <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-2.5 mb-3 text-xs text-muted-foreground">
        <MousePointerClick className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <p>
          {selectedPerson
            ? t("hintAssign", { name: selectedPerson.name })
            : t("hintSelect")}
        </p>
      </div>

      {people.length === 0 ? (
        <EmptyState
          title={t("empty")}
          description={t("emptyHint")}
          action={{ label: t("addPerson"), icon: Plus, onClick: () => openMarkMode(true) }}
        />
      ) : (
        <div className="space-y-2 overflow-y-auto overscroll-contain flex-1 min-h-0">
          {/* The person the map taps assign – ONE ticked tile, the pickers' tile (ENT-10 A).
              The dot is the person's colour on the map («Färben nach Reko»). */}
          {people.map((person) => {
            const openOps = openByPerson.get(person.id) ?? []
            const isSelected = person.id === selectedPersonId
            const swatch = legendColors.get(person.id)
            return (
              <PersonPickTile
                key={person.id}
                name={person.name}
                personnelId={person.id}
                rank={person.role}
                checked={isSelected}
                onClick={() => onSelectPerson(isSelected ? null : person.id)}
                aside={
                  <span className="flex items-center gap-2">
                    {openOps.length > 0 ? (
                      <span className="whitespace-nowrap font-medium text-muted-foreground">{t("openCount", { count: openOps.length })}</span>
                    ) : (
                      <Badge variant="outline" className={cn("text-xs", RESOURCE_STATE_BADGE_CLASSES.available)}>{t("free")}</Badge>
                    )}
                    <span
                      aria-hidden
                      className={cn("size-3 shrink-0 rounded-full", !swatch && "bg-muted-foreground/30")}
                      style={swatch ? { backgroundColor: swatch } : undefined}
                    />
                  </span>
                }
              />
            )
          })}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => openMarkMode(true)}
          >
            <Plus className="size-3.5" />
            {t("addPerson")}
          </Button>
        </div>
      )}
        </>
      )}
    </div>
  )
}
