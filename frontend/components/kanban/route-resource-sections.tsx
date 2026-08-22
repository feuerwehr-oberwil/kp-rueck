"use client"

/**
 * RouteResourceSections — the per-type resource sections (Mannschaft / Fahrzeuge /
 * Material) for a route-owned (Auftrag) resource roll-up. Extracted from the
 * operation detail modal so the detail modal AND the Aufträge sheet render the
 * exact same section UI (icon + count heading + add control + removable chips)
 * without duplicating markup.
 *
 * Behaviour is route-scoped: `onAssign` opens the resource dialog scoped to the
 * Auftrag and `onUnassign` detaches a route-owned resource by its assignment id.
 *
 * Provenance ("these belong to the Auftrag, not to this Schadenplatz") is NOT
 * said here any more. It used to be a `viaLabel` badge stamped into all three
 * section heads, which printed the Auftrag's name three times in a 372px column
 * and — sitting next to a `truncate`d label as a non-shrinkable span — pushed
 * the one genuinely new piece of information, the count in «Mannschaft (3)», out
 * of the heading. It is now said once, by the frame these sections sit in:
 * `ResourceSourceBlock` below.
 */

import type { ComponentType, ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Users, Truck, Package, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RemovableChip } from "@/components/ui/removable-chip"
import { LeaderBadge } from "@/components/kanban/leader-badge"
import { sortCrewByLeader } from "@/lib/crew-order"
import { cn } from "@/lib/utils"
import type { GroupResources } from "@/lib/types/groups"

/**
 * Shared section header — icon + "Label (N)" on the left, a trailing action on
 * the right. This is the single visual template for every peer sub-section of an
 * Auftrag (Mannschaft / Fahrzeuge / Material *and* Zugewiesene Einsätze), so all
 * four headers read as identical siblings. The Aufträge sheet imports this to
 * build its "Zugewiesene Einsätze" header from the same markup; the incident
 * detail builds its own three sections from it too.
 */
interface ResourceSectionHeaderProps {
  icon: ComponentType<{ className?: string }>
  /** The "Label (N)" text. */
  label: ReactNode
  /** Right-aligned control(s): the add button for resources, add/optimize for stops. */
  action?: ReactNode
}

export function ResourceSectionHeader({ icon: Icon, label, action }: ResourceSectionHeaderProps) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
      {action}
    </div>
  )
}

/**
 * The add control of one resource section.
 *
 * `compact` drops the word «Hinzufügen» and leaves the glyph. Where several
 * sections stand under one provenance heading — the incident detail — the word
 * was said once per section for something that is a possibility, not
 * information, while the content below it is what the operator came for. The
 * name survives as the accessible name AND as the hover title, so nothing is
 * lost for a screen reader or for somebody who does not know the glyph.
 */
export function ResourceAddButton({
  label,
  onClick,
  compact = false,
}: {
  /** What this adds, e.g. «Fahrzeug zuweisen» — accessible name and hover title. */
  label: string
  onClick: () => void
  compact?: boolean
}) {
  const t = useTranslations("kanban")

  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={onClick}
      className={compact ? "px-1.5" : "gap-1 px-2"}
      title={label}
      aria-label={label}
      tabIndex={0}
    >
      <Plus className="size-3.5" />
      {!compact && t("common.add")}
    </Button>
  )
}

interface ResourceSourceBlockProps {
  /** Which side of the boundary this block is: the route's, or the stop's own. */
  variant: "route" | "incident"
  /**
   * The provenance heading — «Auftrag «Sturmholz Nord»» / «Nur dieser Einsatz».
   *
   * Left OUT for an incident that has only one source: with nothing to tell
   * apart, a frame that never gets a sibling is decoration, and the sections
   * render bare exactly as they always did.
   */
  title?: ReactNode
  /** One line saying what happens to what is in here on completion. */
  hint?: ReactNode
  /** The Auftrag's colour, for the edge and the dot. Route blocks only. */
  accentColor?: string | null
  children: ReactNode
}

/**
 * A provenance frame around resource sections — Variante A of mockup 08.
 *
 * «Fährt mit dem Auftrag weiter» and «gehört nur diesem Schadenplatz» are two
 * different things (completing a stop releases the second and not the first), so
 * the difference has to be visible. It is shown by POSITION: everything under
 * one edge has one origin, said once at the top, instead of a sentence repeated
 * into every section head.
 *
 * The two blocks never differ by colour alone — the route's dot is filled and
 * carries the Auftrag's colour, the incident's is a hollow ring on the neutral
 * border, and each block names itself in words.
 */
export function ResourceSourceBlock({ variant, title, hint, accentColor, children }: ResourceSourceBlockProps) {
  if (!title) return <>{children}</>

  const isRoute = variant === "route"

  return (
    <div
      data-resource-source={variant}
      className="mt-4 border-l-2 border-border pl-3"
      style={isRoute && accentColor ? { borderColor: accentColor } : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            // 8px, not 6: the incident's marker is a RING, and a 1px border on
            // a 6px dot reads as a smudge rather than as "hollow".
            "size-2 shrink-0 rounded-full",
            isRoute ? "bg-muted-foreground" : "border border-muted-foreground",
          )}
          style={isRoute && accentColor ? { backgroundColor: accentColor } : undefined}
        />
        <span className="truncate text-xs font-semibold text-muted-foreground">{title}</span>
      </div>
      {hint && <p className="text-2xs text-muted-foreground/80">{hint}</p>}
      {children}
    </div>
  )
}

interface RouteResourceSectionsProps {
  resources: GroupResources
  /** Opens the resource dialog scoped to the ROUTE (works with 0 stops). */
  onAssign: (resourceType: "crew" | "vehicles" | "materials") => void
  /** Detach a route-owned resource by its group-assignment id. */
  onUnassign: (assignmentId: string) => void
  /** Glyph-only add buttons — for callers that already head these sections with
   *  a provenance block (the incident detail). See `ResourceAddButton`. */
  compactAdd?: boolean
  /** vehicle name → driver name, so a Fahrzeug chip names who is behind the
   *  wheel. Passed in rather than fetched here: this component stays
   *  presentational, and every caller already holds the live map from
   *  `useVehicleDrivers`. */
  vehicleDrivers?: ReadonlyMap<string, string>
  readOnly?: boolean
  /** Promote a route-owned person to Einsatzleiter. A stop owns no resources,
   *  so for a grouped incident this is where the leader is set — one squad on
   *  one route has one leader, not one per stop. */
  onPromoteLeader?: (assignmentId: string) => void
}

export function RouteResourceSections({ resources, onAssign, onUnassign, compactAdd = false, vehicleDrivers, readOnly = false, onPromoteLeader }: RouteResourceSectionsProps) {
  const t = useTranslations("kanban")
  return (
    <>
      {/* Mannschaft */}
      <div className="mt-4">
        <ResourceSectionHeader
          icon={Users}
          label={t("common.crewCount", { count: resources.personnel.length })}
          action={!readOnly ? (
            <ResourceAddButton compact={compactAdd} label={t("common.assignCrew")} onClick={() => onAssign("crew")} />
          ) : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {resources.personnel.length > 0 ? (
            // EL first (decision 23) — the route's leader heads the route's crew.
            sortCrewByLeader(resources.personnel, (p) => Boolean(p.isLeader)).map((p) => (
              <RemovableChip
                key={p.assignmentId}
                variant="secondary"
                className="group gap-1 pr-1 text-sm hover:bg-destructive/20"
                onRemove={!readOnly ? () => onUnassign(p.assignmentId) : undefined}
                removeTitle={t("common.removeNamed", { name: p.name })}
                removeButtonClassName="ml-1"
              >
                <LeaderBadge
                  isLeader={Boolean(p.isLeader)}
                  onPromote={!readOnly && onPromoteLeader ? () => onPromoteLeader(p.assignmentId) : undefined}
                />
                {p.name}
              </RemovableChip>
            ))
          ) : (
            <p className="text-sm italic text-muted-foreground/60">{t("detail.noCrew")}</p>
          )}
        </div>
      </div>

      {/* Fahrzeuge */}
      <div className="mt-4">
        <ResourceSectionHeader
          icon={Truck}
          label={t("common.vehiclesCount", { count: resources.vehicles.length })}
          action={!readOnly ? (
            <ResourceAddButton compact={compactAdd} label={t("common.assignVehicle")} onClick={() => onAssign("vehicles")} />
          ) : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {resources.vehicles.length > 0 ? (
            resources.vehicles.map((v) => {
              // «TLF 1 (M. Muster)» — the same chip wording the incident detail
              // uses for a standalone Einsatz, so a route reads the same way.
              const driverName = vehicleDrivers?.get(v.name)
              return (
                <RemovableChip
                  key={v.assignmentId}
                  variant="default"
                  className="gap-1 pr-1 text-sm"
                  onRemove={!readOnly ? () => onUnassign(v.assignmentId) : undefined}
                  removeTitle={t("common.removeNamed", { name: v.name })}
                  removeButtonClassName="ml-0.5 cursor-pointer hover:text-white"
                >
                  {v.name}{driverName ? ` (${driverName})` : ""}
                </RemovableChip>
              )
            })
          ) : (
            <p className="text-sm italic text-muted-foreground/60">{t("detail.noVehicles")}</p>
          )}
        </div>
      </div>

      {/* Material */}
      <div className="mt-4">
        <ResourceSectionHeader
          icon={Package}
          label={t("common.materialsCount", { count: resources.materials.length })}
          action={!readOnly ? (
            <ResourceAddButton compact={compactAdd} label={t("common.assignMaterial")} onClick={() => onAssign("materials")} />
          ) : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {resources.materials.length > 0 ? (
            resources.materials.map((m) => (
              <RemovableChip
                key={m.assignmentId}
                variant="outline"
                className="gap-1 pr-1 text-sm hover:bg-destructive/20"
                onRemove={!readOnly ? () => onUnassign(m.assignmentId) : undefined}
                removeTitle={t("common.removeNamed", { name: m.name })}
                removeButtonClassName="ml-1"
              >
                {m.name}
                {/* «Motorsäge» alone never said where to fetch it from. The
                    sidebar shows the depot only because it groups by Standort;
                    here the chip has to say it. */}
                {m.location && <span className="text-xs text-muted-foreground">{m.location}</span>}
              </RemovableChip>
            ))
          ) : (
            <p className="text-sm italic text-muted-foreground/60">{t("detail.noMaterial")}</p>
          )}
        </div>
      </div>
    </>
  )
}
