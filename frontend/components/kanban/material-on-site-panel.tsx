"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, ChevronRight, MapPin } from "lucide-react"

import type { Material } from "@/lib/contexts/materials-context"
import { getTimeSince } from "@/lib/kanban-utils"

/** Where one unit is standing — the shape `operations-context` keys by material id. */
export interface MaterialOnSiteLocation {
  incidentId: string
  address: string | null
  since: string | null
}

/** One line of the overview: which unit, at which Schadenplatz, since when. */
export interface MaterialOnSiteEntry {
  materialId: string
  name: string
  incidentId: string
  /** Address of the Schadenplatz, already falling back to the incident title. */
  address: string | null
  /** Null when the rapport carried no usable timestamp — unknown, not "just now". */
  since: Date | null
}

/**
 * The board's answer to "what of ours is still lying around out there".
 *
 * Reads the same `materialOnSite` map the sidebar cards and the card chips read
 * (fed by `/restliste`, so there is ONE computation of "still out there"), and
 * joins it against the depot to get names. Units the map cannot be joined to —
 * a material that no longer exists — are dropped: a row that cannot say WHICH
 * pump is useless, and the Restliste on the events page still counts it.
 *
 * Sorted longest-standing first: that is the one everybody has stopped thinking
 * about. Entries whose `since` is unknown go last rather than first — an unknown
 * age is not evidence of an old one.
 */
export function selectMaterialOnSite(
  onSite: ReadonlyMap<string, MaterialOnSiteLocation>,
  materials: readonly Material[],
): MaterialOnSiteEntry[] {
  const byId = new Map(materials.map((material) => [material.id, material]))
  const entries: MaterialOnSiteEntry[] = []

  for (const [materialId, location] of onSite) {
    const material = byId.get(materialId)
    if (!material) continue
    const parsed = location.since ? new Date(location.since) : null
    entries.push({
      materialId,
      name: material.name,
      incidentId: location.incidentId,
      address: location.address,
      since: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
    })
  }

  return entries.sort((a, b) => {
    if (a.since && b.since) return a.since.getTime() - b.since.getTime()
    if (a.since) return -1
    if (b.since) return 1
    return a.name.localeCompare(b.name)
  })
}

interface MaterialOnSitePanelProps {
  /** Already selected + sorted by `selectMaterialOnSite`. */
  entries: readonly MaterialOnSiteEntry[]
  /** Opens the Schadenplatz the unit is standing at. */
  onOpenIncident: (incidentId: string) => void
}

/**
 * The «vor Ort» roll-up at the head of the Material-Leiste.
 *
 * It lives here rather than in the footer for three reasons: the footer row is
 * width-constrained (see the long note in `app/page.tsx`) and a tenth pill would
 * spend the width the print merge just gave back; the Material-Leiste is already
 * the surface that answers "where is our material", down to the per-unit «vor
 * Ort» chip on each card; and a roll-up next to those chips cannot disagree with
 * them. It sits ABOVE the scroll list on purpose — search and «nur verfügbare»
 * must not be able to filter away the answer to "what is still out there".
 *
 * Collapsed by default and absent at zero: the count is the whole headline, and
 * a board with nothing on site must not carry a permanent empty row. Read-only,
 * so a viewer sees it too — knowing where a pump is standing is not an edit.
 */
export function MaterialOnSitePanel({ entries, onOpenIncident }: MaterialOnSitePanelProps) {
  const t = useTranslations("kanban.dashboard.materialOnSite")
  const [expanded, setExpanded] = useState(false)

  if (entries.length === 0) return null

  return (
    <div className="border-b border-border/60 px-3 pb-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        title={t("toggleTitle", { count: entries.length })}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <MapPin className="size-3.5 shrink-0 text-warning" />
        <span className="truncate">{t("toggle", { count: entries.length })}</span>
      </button>

      {expanded && (
        <ul className="mt-0.5 max-h-44 space-y-0.5 overflow-y-auto overscroll-y-contain pl-2">
          {entries.map((entry) => (
            <li key={entry.materialId}>
              <button
                type="button"
                onClick={() => onOpenIncident(entry.incidentId)}
                title={t("rowTitle", { name: entry.name, address: entry.address ?? "–" })}
                className="flex w-full flex-col gap-0.5 rounded px-1.5 py-1 text-left hover:bg-muted/60"
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    {entry.name}
                  </span>
                  {/* Age, not a clock time: "seit 6h 12'" is the number that
                      decides whether somebody drives out tonight. */}
                  {entry.since && (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {t("since", { duration: getTimeSince(entry.since) })}
                    </span>
                  )}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {entry.address ?? t("unknownAddress")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
