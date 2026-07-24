"use client"

import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { type Operation } from "@/lib/contexts/operations-context"
import { usePersonnel, type Person } from "@/lib/contexts/personnel-context"
import { useMaterials, type Material } from "@/lib/contexts/materials-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { type IncidentGroup } from "@/lib/types/groups"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { columns, getTimeSince } from "@/lib/kanban-utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { PRIORITY_ICONS, PRIORITY_LABELS } from "@/lib/priority"
import {
  Clock, Truck, Users, Siren, Package, AlertTriangle, FileText, Phone,
  MessageSquare, Building2, Timer, Footprints, FileCheck, Waypoints, Binoculars,
} from "lucide-react"
import { type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Icons/labels from the shared priority module; only the tailwind tint is local.
export const priorityVisuals: Record<
  Operation["priority"],
  { Icon: LucideIcon; label: string; iconColor: string }
> = {
  high: { Icon: PRIORITY_ICONS.high, label: PRIORITY_LABELS.high, iconColor: "text-red-500" },
  medium: { Icon: PRIORITY_ICONS.medium, label: PRIORITY_LABELS.medium, iconColor: "text-amber-500" },
  low: { Icon: PRIORITY_ICONS.low, label: PRIORITY_LABELS.low, iconColor: "text-green-600 dark:text-green-500" },
}

/**
 * Read-only incident detail dialog shared by all /display views (board, status,
 * map). In the logged-in displays the resource contexts provide the lookup
 * data; token displays pass the payload-derived lists via the *Override props
 * (the contexts are empty without a login).
 */
export function IncidentDetailModal({
  operation,
  open,
  onOpenChange,
  personnelOverride,
  materialsOverride,
  groupsOverride,
}: {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  personnelOverride?: Person[]
  materialsOverride?: Material[]
  groupsOverride?: IncidentGroup[]
}) {
  const t = useTranslations('display')
  const tk = useTranslations('kanban')
  const { materials: contextMaterials } = useMaterials()
  const { personnel: contextPersonnel } = usePersonnel()
  const { selectedEvent } = useEvent()
  const { groups: contextGroups, getGroupResources } = useGroups()
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id, open && !!operation)

  const materials = materialsOverride ?? contextMaterials
  const personnel = personnelOverride ?? contextPersonnel
  const groups = groupsOverride ?? contextGroups

  const auftrag = operation?.groupId ? groups.find((g) => g.id === operation.groupId) : undefined
  // Route-owned resources come from the groups context; the token payload
  // doesn't carry them, so the roll-up is auth-only.
  const auftragResources = auftrag && !groupsOverride ? getGroupResources(auftrag.id) : null

  if (!operation) return null

  const { Icon: PriorityIcon, label: priorityLabel, iconColor: priorityIconColor } =
    priorityVisuals[operation.priority]

  const statusColumnId = columns.find((c) => c.status.includes(operation.status))?.id

  const materialNames = operation.materials.map(id => {
    const mat = materials.find(m => m.id === id)
    return mat?.name ?? id
  })

  const personnelRoleByName = new Map<string, string | undefined>(
    personnel.map(p => [p.name, p.role]),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PriorityIcon
              className={cn("h-5 w-5 flex-shrink-0", priorityIconColor)}
              aria-label={t('board.priorityAria', { label: priorityLabel })}
            />
            <span className="break-words">{formatLocationForDisplay(operation.location, getGlobalHomeCity()) || getIncidentTypeLabel(operation.incidentType)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Type, Priority, Time */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="flex items-center gap-1.5">
              <Siren className="h-4 w-4 text-muted-foreground" />
              <span>{getIncidentTypeLabel(operation.incidentType)}</span>
            </div>
            <Badge variant="outline">{priorityLabel}</Badge>
            {statusColumnId && <Badge variant="secondary">{tk(`columns.${statusColumnId}`)}</Badge>}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-mono">
                {operation.dispatchTime.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span>·</span>
              <span className="font-mono">{getTimeSince(operation.statusChangedAt || operation.dispatchTime)}</span>
            </div>
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-2">
            {operation.source === 'intake' && (
              <Badge variant="outline" className="gap-1 border-sky-500/50 text-sky-600 dark:text-sky-400">
                <Phone className="h-3 w-3" /> {t('board.intakeBadge')}
              </Badge>
            )}
            {operation.nachbarhilfe && (
              <Badge variant="outline" className="gap-1">
                <Building2 className="h-3 w-3" /> {t('board.nachbarhilfe')}
              </Badge>
            )}
            {operation.amWarten && (
              <Badge variant="outline" className="gap-1 border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
                <Timer className="h-3 w-3" /> {t('board.amWarten')}
              </Badge>
            )}
            {operation.zuFuss && (
              <Badge variant="outline" className="gap-1">
                <Footprints className="h-3 w-3" /> {t('board.zuFuss')}
              </Badge>
            )}
          </div>

          {/* Auftrag (route) — read-only: name, this stop's position, and the
              route-owned resource roll-up (resources live on the route, not the stop). */}
          {auftrag && (
            <div className="space-y-1.5 rounded-md border border-border/60 p-3">
              <div className="flex items-center gap-2">
                <Waypoints className="h-4 w-4 flex-shrink-0" style={{ color: auftrag.color ?? "var(--muted-foreground)" }} />
                <span className="text-sm font-bold uppercase tracking-wide" style={{ color: auftrag.color ?? "var(--muted-foreground)" }}>
                  {auftrag.name}
                </span>
                <span className="ml-auto text-xs font-mono uppercase tabular-nums text-muted-foreground">
                  {tk('card.auftragStopPosition', {
                    pos: (() => {
                      const idx = auftrag.stopIds.indexOf(operation.id)
                      return idx >= 0 ? idx + 1 : operation.groupPosition + 1
                    })(),
                    total: auftrag.stopIds.length,
                  })}
                </span>
              </div>
              {auftragResources && (auftragResources.vehicles.length > 0 || auftragResources.personnel.length > 0 || auftragResources.materials.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {auftragResources.vehicles.map((v) => (
                    <Badge key={v.assignmentId} variant="default" className="text-xs gap-1">
                      <Truck className="h-3 w-3" /> {v.name}
                    </Badge>
                  ))}
                  {auftragResources.personnel.map((p) => (
                    <Badge key={p.assignmentId} variant="secondary" className="text-xs gap-1">
                      <Users className="h-3 w-3" /> {p.name}
                    </Badge>
                  ))}
                  {auftragResources.materials.map((m) => (
                    <Badge key={m.assignmentId} variant="secondary" className="text-xs gap-1">
                      <Package className="h-3 w-3" /> {m.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Description */}
          {operation.notes && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <FileText className="h-4 w-4" /> {t('board.report')}
              </div>
              <p className="text-sm whitespace-pre-wrap">{operation.notes}</p>
            </div>
          )}

          {/* Contact (name and/or phone) */}
          {(operation.contact || operation.contactPhone) && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Phone className="h-4 w-4" /> {t('board.contact')}
              </div>
              {operation.contact && <p className="text-sm">{operation.contact}</p>}
              {operation.contactPhone && (
                <p className="text-sm font-mono">
                  <span className="text-muted-foreground">{t('board.contactPhone')}:</span> {operation.contactPhone}
                </p>
              )}
            </div>
          )}

          {/* Internal Notes */}
          {operation.internalNotes && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <MessageSquare className="h-4 w-4" /> {t('board.notes')}
              </div>
              <p className="text-sm whitespace-pre-wrap">{operation.internalNotes}</p>
            </div>
          )}

          {/* Nachbarhilfe Note */}
          {operation.nachbarhilfe && operation.nachbarhilfeNote && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Building2 className="h-4 w-4" /> {t('board.nachbarhilfeNote')}
              </div>
              <p className="text-sm">{operation.nachbarhilfeNote}</p>
            </div>
          )}

          {/* Am Warten Note */}
          {operation.amWarten && operation.amWartenNote && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Timer className="h-4 w-4" /> {t('board.waitReason')}
              </div>
              <p className="text-sm">{operation.amWartenNote}</p>
            </div>
          )}

          {/* Reko assignment (who scouts, since when on site) */}
          {(operation.assignedReko || operation.rekoArrivedAt) && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Binoculars className="h-4 w-4" /> {t('board.rekoHeading')}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {operation.assignedReko && (
                  <Badge variant="secondary" className="text-sm">{operation.assignedReko.name}</Badge>
                )}
                {operation.rekoArrivedAt && (
                  <span className="text-xs text-muted-foreground">
                    {t('board.rekoOnSite', {
                      time: operation.rekoArrivedAt.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }),
                    })}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Crew */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Users className="h-4 w-4" /> {t('board.crewHeading', { count: operation.crew.length })}
            </div>
            {operation.crew.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {operation.crew.map((name) => {
                  const role = personnelRoleByName.get(name)
                  return (
                    <Badge key={name} variant="secondary" className="text-sm">
                      {name}
                      {role && <span className="ml-1 opacity-70">· {role}</span>}
                    </Badge>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">{t('board.noCrew')}</p>
            )}
          </div>

          {/* Vehicles */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Truck className="h-4 w-4" /> {t('board.vehiclesHeading', { count: operation.vehicles.length })}
            </div>
            {operation.vehicles.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {operation.vehicles.map((vehicleName) => {
                  const callsign = operation.vehicleCallsigns.get(vehicleName)
                  const driverStay = operation.vehicleDriverStay.get(vehicleName)
                  const driverName = vehicleDrivers.get(vehicleName)
                  return (
                    <Badge key={vehicleName} variant="default" className="text-sm gap-1">
                      {vehicleName}
                      {callsign && <span className="opacity-70">· {callsign}</span>}
                      {driverName && <span className="opacity-70">{t('board.driver', { name: driverName })}</span>}
                      {driverStay !== undefined && (
                        <span className="opacity-70 ml-0.5">
                          {driverStay ? t('board.driverStays') : t('board.driverReturns')}
                        </span>
                      )}
                    </Badge>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">{t('board.noVehicles')}</p>
            )}
          </div>

          {/* Materials */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Package className="h-4 w-4" /> {t('board.materialsHeading', { count: operation.materials.length })}
            </div>
            {materialNames.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {materialNames.map((name, i) => (
                  <Badge key={i} variant="secondary" className="text-sm">{name}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">{t('board.noMaterials')}</p>
            )}
          </div>

          {/* Reko Summary */}
          {operation.hasCompletedReko && operation.rekoSummary && (
            <div className="space-y-1.5 border-t pt-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <FileCheck className="h-4 w-4" /> {t('board.rekoResult')}
              </div>
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">{t('board.relevant')}</span>{" "}
                  {operation.rekoSummary.isRelevant ? t('common.yes') : t('common.no')}
                </p>
                {operation.rekoSummary.hasDangers && (
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span>{t('board.dangers', { types: operation.rekoSummary.dangerTypes.join(", ") })}</span>
                  </div>
                )}
                {operation.rekoSummary.personnelCount !== null && (
                  <p>
                    <span className="text-muted-foreground">{t('board.personnelNeed')}</span>{" "}
                    {t('common.personCount', { count: operation.rekoSummary.personnelCount })}
                  </p>
                )}
                {operation.rekoSummary.estimatedDuration !== null && (
                  <p>
                    <span className="text-muted-foreground">{t('board.estimatedDuration')}</span>{" "}
                    {t('board.durationHours', { hours: operation.rekoSummary.estimatedDuration })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
