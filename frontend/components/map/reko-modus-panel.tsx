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
import { Binoculars, MousePointerClick, X, User, Plus, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { apiClient } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations, type Operation } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"
import { MarkExistingRekoPersonnel } from "@/components/incidents/assign-reko-dialog"

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
  const { selectedEvent } = useEvent()
  const { personnel, refreshOperations } = useOperations()
  const [markMode, setMarkMode] = useState(false)
  const selectedPerson = people.find((p) => p.id === selectedPersonId) ?? null

  // Mark a checked-in person as event Reko, then pre-select them for tapping.
  const handleMarkPerson = async (person: Person) => {
    if (!selectedEvent) return
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
          <X className="h-4 w-4" />
          {t("exit")}
        </Button>
      </div>

      {markMode ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="self-start mb-2 -ml-2"
            onClick={() => setMarkMode(false)}
          >
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Button>
          <MarkExistingRekoPersonnel personnel={personnel} onSelect={handleMarkPerson} />
        </>
      ) : (
        <>
      <div className="flex items-start gap-2 rounded-md border border-border/50 bg-secondary/30 p-2.5 mb-3 text-xs text-muted-foreground">
        <MousePointerClick className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <p>
          {selectedPerson
            ? t("hintAssign", { name: selectedPerson.name })
            : t("hintSelect")}
        </p>
      </div>

      {people.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 px-4 text-center">
          <User className="h-10 w-10 text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium mb-1">{t("empty")}</p>
          <Button size="sm" className="my-3" onClick={() => setMarkMode(true)}>
            <Plus className="h-4 w-4" />
            {t("addPerson")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto">
          {people.map((person) => {
            const openOps = openByPerson.get(person.id) ?? []
            const isSelected = person.id === selectedPersonId
            const swatch = legendColors.get(person.id)
            return (
              <button
                key={person.id}
                onClick={() => onSelectPerson(isSelected ? null : person.id)}
                className={cn(
                  "w-full flex items-center justify-between gap-2 p-3 rounded-lg border transition-all text-left",
                  isSelected
                    ? "border-primary ring-2 ring-primary/20 bg-secondary/40"
                    : "border-border/50 hover:border-primary/50 hover:bg-secondary/30"
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={cn(
                      "h-3 w-3 rounded-full flex-shrink-0",
                      !swatch && "bg-muted-foreground/30"
                    )}
                    style={swatch ? { backgroundColor: swatch } : undefined}
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{person.name}</p>
                    {person.role && (
                      <p className="text-xs text-muted-foreground truncate">{person.role}</p>
                    )}
                  </div>
                </div>
                <span
                  className={cn(
                    "text-xs font-medium whitespace-nowrap flex-shrink-0",
                    openOps.length > 0
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  {openOps.length > 0 ? t("openCount", { count: openOps.length }) : t("free")}
                </span>
              </button>
            )
          })}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-muted-foreground"
            onClick={() => setMarkMode(true)}
          >
            <Plus className="h-4 w-4" />
            {t("addPerson")}
          </Button>
        </div>
      )}
        </>
      )}
    </div>
  )
}
