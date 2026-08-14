"use client"

/**
 * RouteResourceSections — the per-type resource sections (Mannschaft / Fahrzeuge /
 * Material) for a route-owned (Auftrag) resource roll-up. Extracted from the
 * operation detail modal so the detail modal AND the Aufträge sheet render the
 * exact same section UI (icon + count heading + optional "über Auftrag" badge +
 * "+ Hinzufügen" + removable chips) without duplicating markup.
 *
 * Behaviour is route-scoped: `onAssign` opens the resource dialog scoped to the
 * Auftrag and `onUnassign` detaches a route-owned resource by its assignment id.
 */

import type { ComponentType, ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Users, Truck, Package, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RemovableChip } from "@/components/ui/removable-chip"
import { LeaderBadge } from "@/components/kanban/leader-badge"
import { sortCrewByLeader } from "@/lib/crew-order"
import type { GroupResources } from "@/lib/types/groups"

/**
 * Shared section header — icon + "Label (N)" on the left, a trailing action on
 * the right. This is the single visual template for every peer sub-section of an
 * Auftrag (Mannschaft / Fahrzeuge / Material *and* Zugewiesene Einsätze), so all
 * four headers read as identical siblings. The Aufträge sheet imports this to
 * build its "Zugewiesene Einsätze" header from the same markup.
 */
interface ResourceSectionHeaderProps {
  icon: ComponentType<{ className?: string }>
  /** The "Label (N)" text. */
  label: ReactNode
  /** Optional badge rendered after the label (e.g. "über Auftrag «…»"). */
  viaLabel?: ReactNode
  /** Right-aligned control(s): "+ Hinzufügen" for resources, add/optimize for stops. */
  action?: ReactNode
}

export function ResourceSectionHeader({ icon: Icon, label, viaLabel, action }: ResourceSectionHeaderProps) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{label}</span>
        {viaLabel}
      </div>
      {action}
    </div>
  )
}

interface RouteResourceSectionsProps {
  resources: GroupResources
  /** Opens the resource dialog scoped to the ROUTE (works with 0 stops). */
  onAssign: (resourceType: "crew" | "vehicles" | "materials") => void
  /** Detach a route-owned resource by its group-assignment id. */
  onUnassign: (assignmentId: string) => void
  /** Optional badge rendered after each section count (e.g. "über Auftrag «…»"). */
  viaLabel?: ReactNode
  readOnly?: boolean
  /** Promote a route-owned person to Einsatzleiter. A stop owns no resources,
   *  so for a grouped incident this is where the leader is set — one squad on
   *  one route has one leader, not one per stop. */
  onPromoteLeader?: (assignmentId: string) => void
}

export function RouteResourceSections({ resources, onAssign, onUnassign, viaLabel, readOnly = false, onPromoteLeader }: RouteResourceSectionsProps) {
  const t = useTranslations("kanban")

  return (
    <>
      {/* Mannschaft */}
      <div className="mt-4">
        <ResourceSectionHeader
          icon={Users}
          label={t("common.crewCount", { count: resources.personnel.length })}
          viaLabel={viaLabel}
          action={!readOnly ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onAssign("crew")}
              className="gap-1 px-2"
              title={t("common.assignCrew")}
              tabIndex={0}
            >
              <Plus className="size-3.5" />
              {t("common.add")}
            </Button>
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
          viaLabel={viaLabel}
          action={!readOnly ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onAssign("vehicles")}
              className="gap-1 px-2"
              title={t("common.assignVehicle")}
              tabIndex={0}
            >
              <Plus className="size-3.5" />
              {t("common.add")}
            </Button>
          ) : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {resources.vehicles.length > 0 ? (
            resources.vehicles.map((v) => (
              <RemovableChip
                key={v.assignmentId}
                variant="default"
                className="gap-1 pr-1 text-sm"
                onRemove={!readOnly ? () => onUnassign(v.assignmentId) : undefined}
                removeTitle={t("common.removeNamed", { name: v.name })}
                removeButtonClassName="ml-0.5 cursor-pointer hover:text-white"
              >
                {v.name}
              </RemovableChip>
            ))
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
          viaLabel={viaLabel}
          action={!readOnly ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => onAssign("materials")}
              className="gap-1 px-2"
              title={t("common.assignMaterial")}
              tabIndex={0}
            >
              <Plus className="size-3.5" />
              {t("common.add")}
            </Button>
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
