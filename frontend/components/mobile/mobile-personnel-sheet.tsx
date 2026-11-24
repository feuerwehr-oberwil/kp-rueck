"use client"

import { SearchEmptyState } from "@/components/ui/empty-state"
import { PersonName } from "@/components/person-name"
import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { SearchInput } from "@/components/ui/search-input"
import { compareByRankThenName } from "@/lib/roster-order"
import { ChevronRight } from "lucide-react"
import { type Person, type Operation } from "@/lib/contexts/operations-context"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { personResourceState, RESOURCE_STATE_DOT_CLASSES } from "@/lib/resource-status"
import { CrewDutyButton } from "@/components/kanban/crew-duty-sheet"

interface MobilePersonnelSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  personnel: Person[]
  operations: Operation[]
  /** Opens the Dienstzeiten overview (replaces this sheet). */
  onOpenCrewDuty?: () => void
  /** Opens an Einsatz: a person on exactly one open Einsatz is a row that goes there. */
  onOpenIncident?: (incidentId: string) => void
}

/**
 * The phone «Personal» sheet: the roster by Grad, a search, and per person where and what. Its
 * head and the search stay while the list scrolls (phone sweep 24.11.2026 #9). A person on one
 * open Einsatz is a row that opens it (#23, the Verlauf's pattern) – «where is X and who is with
 * him» is one tap; on several the row cannot know which one is meant and stays plain.
 */
export function MobilePersonnelSheet({
  open,
  onOpenChange,
  personnel,
  operations,
  onOpenCrewDuty,
  onOpenIncident,
}: MobilePersonnelSheetProps) {
  const t = useTranslations("incidents.mobilePersonnel")
  const [searchQuery, setSearchQuery] = useState("")

  // Filter personnel by search
  const filteredPersonnel = useMemo(() => {
    if (!searchQuery.trim()) return personnel
    const query = searchQuery.toLowerCase()
    return personnel.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.role.toLowerCase().includes(query) ||
        p.tags?.some((t) => t.toLowerCase().includes(query))
    )
  }, [personnel, searchQuery])

  // Grouped by Grad, in the station's own order, alphabetical inside a group —
  // the same rule the board's crew sidebar uses, so the phone and the desk do
  // not disagree about where a name sits.
  const groupedPersonnel = useMemo(() => {
    const groups: Record<string, Person[]> = {}
    ;[...filteredPersonnel].sort(compareByRankThenName).forEach((person) => {
      const role = person.role || t("roleOther")
      if (!groups[role]) groups[role] = []
      groups[role].push(person)
    })
    return groups
  }, [filteredPersonnel, t])

  /** The one open Einsatz this person is crew on, if there is exactly one. */
  const onlyIncidentOf = (person: Person): string | null => {
    const open = operations.filter((o) => o.status !== "complete" && o.crew.some((m) => m.personnelId === person.id))
    return open.length === 1 ? open[0].id : null
  }

  // Find which incident a person is assigned to
  const getAssignedIncident = (person: Person): string | null => {
    if (person.status !== "assigned") return null
    const op = operations.find((o) => o.crew.some((m) => m.personnelId === person.id))
    if (!op) return null
    return (op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())) || getIncidentTypeLabel(op.incidentType)
  }

  // Reko and Auftrag crews keep `status: "available"` – a route holds them on its group, which
  // the event reconciliation never sees – so count and dot go through the board's own rule.
  const availableCount = personnel.filter((p) => personResourceState(p) === "available").length

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // Head and search stay, the list scrolls. Covers the nav, so the list's foot pays only
        // the safe area (`pb-sheet-safe`).
        className="modal-h-tall gap-0 p-0"
      >
        <SheetHeader>
          {/* No icon in the title – no other sheet has one (owner, 10.10.2026). */}
          <SheetTitle>{t("title")}</SheetTitle>
          <div className="flex items-center justify-between gap-2">
            <SheetDescription>
              {t("availableCount", { available: availableCount, total: personnel.length })}
            </SheetDescription>
            {onOpenCrewDuty && personnel.length > 0 && (
              <CrewDutyButton onClick={onOpenCrewDuty} className="-my-2 min-h-11 px-2 text-sm" />
            )}
          </div>
        </SheetHeader>

        <div className="shrink-0 px-6 pb-3">
          <SearchInput
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onValueChange={setSearchQuery}
            className="h-10"
          />
        </div>

        <SheetBody className="space-y-5 px-6 pt-1 pb-sheet-safe">
          {Object.entries(groupedPersonnel).map(([role, people]) => (
            <div key={role}>
              <h3 className="text-xs font-semibold text-muted-foreground tracking-wide mb-2">
                {role} ({people.length})
              </h3>
              <div className="space-y-1.5">
                {people.map((person) => {
                  const assignedTo = getAssignedIncident(person)
                  const state = personResourceState(person)
                  // Line 2, the facts (the new Appell's pattern): where, the state in a word
                  // (the dot is never the only sign), Reko, the tags. It wraps; nothing beside the
                  // name takes its width any more – a badge there cut «Bendik-Dimitrijević …».
                  const facts = [assignedTo, t(`state.${state}`), person.isReko && t("rekoBadge"), ...(person.tags ?? [])]
                    .filter(Boolean)
                    .join(" · ")
                  const incidentId = onOpenIncident ? onlyIncidentOf(person) : null
                  const rowClass = "flex w-full items-start gap-3 rounded-lg border bg-card px-3 py-2.5 text-left"
                  const row = (
                    <>
                      {/* Status indicator, centred on the name's first line. Spans: the row may be a button. */}
                      <span
                        className={cn(
                          "mt-1.5 block h-2.5 w-2.5 rounded-full flex-shrink-0",
                          RESOURCE_STATE_DOT_CLASSES[state]
                        )}
                      />
                      <span className="block flex-1 min-w-0">
                        <span className="block text-sm font-medium break-words"><PersonName name={person.name} personnelId={person.id} /></span>
                        <span className="mt-0.5 block font-mono text-xs text-muted-foreground break-words">{facts}</span>
                      </span>
                      {incidentId && <ChevronRight aria-hidden className="size-4 shrink-0 self-center text-muted-foreground" />}
                    </>
                  )
                  return incidentId ? (
                    <button key={person.id} type="button" className={rowClass} onClick={() => onOpenIncident?.(incidentId)}>
                      {row}
                    </button>
                  ) : (
                    <div key={person.id} className={rowClass}>
                      {row}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {filteredPersonnel.length === 0 && (searchQuery.trim() ? (
            <SearchEmptyState query={searchQuery} onClear={() => setSearchQuery("")} />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("noResults")}</p>
          ))}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
