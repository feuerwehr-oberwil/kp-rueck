"use client"

import { useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { SearchInput } from "@/components/ui/search-input"
import { Badge } from "@/components/ui/badge"
import { Users } from "lucide-react"
import { type Person, type Operation } from "@/lib/contexts/operations-context"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { RESOURCE_STATE_DOT_CLASSES, RESOURCE_STATE_BADGE_CLASSES } from "@/lib/resource-status"

interface MobilePersonnelSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  personnel: Person[]
  operations: Operation[]
}

export function MobilePersonnelSheet({
  open,
  onOpenChange,
  personnel,
  operations,
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

  // Group by role
  const groupedPersonnel = useMemo(() => {
    const groups: Record<string, Person[]> = {}
    filteredPersonnel.forEach((person) => {
      const role = person.role || t("roleOther")
      if (!groups[role]) groups[role] = []
      groups[role].push(person)
    })
    return groups
  }, [filteredPersonnel, t])

  // Find which incident a person is assigned to
  const getAssignedIncident = (person: Person): string | null => {
    if (person.status !== "assigned") return null
    const op = operations.find((o) => o.crew.includes(person.name))
    if (!op) return null
    return (op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())) || getIncidentTypeLabel(op.incidentType)
  }

  const availableCount = personnel.filter((p) => p.status === "available").length

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="modal-h-tall overflow-y-auto px-4"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
        }}
      >
        <SheetHeader className="pb-4 border-b mb-4">
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("title")}
          </SheetTitle>
          <SheetDescription>
            {t("availableCount", { available: availableCount, total: personnel.length })}
          </SheetDescription>
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
                  return (
                    <div
                      key={person.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-card border"
                    >
                      {/* Status indicator */}
                      <div
                        className={cn(
                          "h-2.5 w-2.5 rounded-full flex-shrink-0",
                          RESOURCE_STATE_DOT_CLASSES[person.status]
                        )}
                      />

                      {/* Name and info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {person.name}
                          </span>
                          {person.isReko && (
                            <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
                              {t("rekoBadge")}
                            </Badge>
                          )}
                        </div>
                        {assignedTo && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5" title={assignedTo}>
                            {assignedTo}
                          </p>
                        )}
                      </div>

                      {/* Tags */}
                      {person.tags && person.tags.length > 0 && (
                        <div className="flex gap-1 flex-shrink-0">
                          {person.tags.map((tag, idx) => (
                            <Badge
                              key={idx}
                              variant="secondary"
                              className="text-xs px-1.5 py-0 h-5"
                            >
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Status badge */}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs flex-shrink-0",
                          RESOURCE_STATE_BADGE_CLASSES[person.status]
                        )}
                      >
                        {person.status === "available" ? t("available") : t("assigned")}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {filteredPersonnel.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {t("noResults")}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
