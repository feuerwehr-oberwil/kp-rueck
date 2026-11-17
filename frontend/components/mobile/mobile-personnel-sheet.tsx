"use client"

import { SearchEmptyState } from "@/components/ui/empty-state"
import { PersonName } from "@/components/person-name"
import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { SearchInput } from "@/components/ui/search-input"
import { compareByRankThenName } from "@/lib/roster-order"
import { Users } from "lucide-react"
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
}

export function MobilePersonnelSheet({
  open,
  onOpenChange,
  personnel,
  operations,
  onOpenCrewDuty,
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
        // Covers the nav, so the foot pays only the safe area (`pb-sheet-safe`).
        className="modal-h-tall overflow-y-auto px-4 pb-sheet-safe"
      >
        <SheetHeader className="pb-4 border-b mb-4">
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("title")}
          </SheetTitle>
          <div className="flex items-center justify-between gap-2">
            <SheetDescription>
              {t("availableCount", { available: availableCount, total: personnel.length })}
            </SheetDescription>
            {onOpenCrewDuty && personnel.length > 0 && (
              <CrewDutyButton onClick={onOpenCrewDuty} className="-my-2 min-h-11 px-2 text-sm" />
            )}
          </div>
        </SheetHeader>

        {/* Search */}
        <SearchInput
          containerClassName="mb-4"
          placeholder={t("searchPlaceholder")}
          value={searchQuery}
          onValueChange={setSearchQuery}
          className="h-10"
        />

        {/* Personnel List */}
        <div className="space-y-5">
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
                  return (
                    <div
                      key={person.id}
                      className="flex items-start gap-3 rounded-lg px-3 py-2.5 bg-card border"
                    >
                      {/* Status indicator, centred on the name's first line */}
                      <div
                        className={cn(
                          "mt-1.5 h-2.5 w-2.5 rounded-full flex-shrink-0",
                          RESOURCE_STATE_DOT_CLASSES[state]
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium break-words"><PersonName name={person.name} personnelId={person.id} /></p>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground break-words">{facts}</p>
                      </div>
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
        </div>
      </SheetContent>
    </Sheet>
  )
}
