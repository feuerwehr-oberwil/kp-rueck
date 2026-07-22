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
import { Users, Truck, Package, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
}

export function RouteResourceSections({ resources, onAssign, onUnassign, viaLabel, readOnly = false }: RouteResourceSectionsProps) {
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
              size="sm"
              variant="ghost"
              onClick={() => onAssign("crew")}
              className="h-7 gap-1 px-2"
              title={t("common.assignCrew")}
              tabIndex={0}
            >
              <Plus className="h-3 w-3" />
              {t("common.add")}
            </Button>
          ) : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {resources.personnel.length > 0 ? (
            resources.personnel.map((p) => (
              <Badge
                key={p.assignmentId}
                variant="secondary"
                className="group gap-1 pr-1 text-sm transition-colors hover:bg-destructive/20"
              >
                {p.name}
                {!readOnly && <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onUnassign(p.assignmentId)
                  }}
                  className="ml-1 opacity-70 transition-opacity hover:opacity-100 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  title={t("common.removeNamed", { name: p.name })}
                  tabIndex={0}
                >
                  <X className="h-3 w-3" />
                </button>}
              </Badge>
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
              size="sm"
              variant="ghost"
              onClick={() => onAssign("vehicles")}
              className="h-7 gap-1 px-2"
              title={t("common.assignVehicle")}
              tabIndex={0}
            >
              <Plus className="h-3 w-3" />
              {t("common.add")}
            </Button>
          ) : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {resources.vehicles.length > 0 ? (
            resources.vehicles.map((v) => (
              <Badge key={v.assignmentId} variant="default" className="group gap-1 pr-1 text-sm transition-colors">
                {v.name}
                {!readOnly && <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onUnassign(v.assignmentId)
                  }}
                  className="ml-0.5 cursor-pointer opacity-70 transition-opacity hover:text-white focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  title={t("common.removeNamed", { name: v.name })}
                  tabIndex={0}
                >
                  <X className="h-3 w-3" />
                </button>}
              </Badge>
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
              size="sm"
              variant="ghost"
              onClick={() => onAssign("materials")}
              className="h-7 gap-1 px-2"
              title={t("common.assignMaterial")}
              tabIndex={0}
            >
              <Plus className="h-3 w-3" />
              {t("common.add")}
            </Button>
          ) : undefined}
        />
        <div className="flex flex-wrap gap-2">
          {resources.materials.length > 0 ? (
            resources.materials.map((m) => (
              <Badge
                key={m.assignmentId}
                variant="outline"
                className="group gap-1 pr-1 text-sm transition-colors hover:bg-destructive/20"
              >
                {m.name}
                {!readOnly && <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onUnassign(m.assignmentId)
                  }}
                  className="ml-1 opacity-70 transition-opacity hover:opacity-100 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  title={t("common.removeNamed", { name: m.name })}
                  tabIndex={0}
                >
                  <X className="h-3 w-3" />
                </button>}
              </Badge>
            ))
          ) : (
            <p className="text-sm italic text-muted-foreground/60">{t("detail.noMaterial")}</p>
          )}
        </div>
      </div>
    </>
  )
}
