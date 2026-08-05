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
import { columns } from "@/lib/kanban-utils"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { formatClockTime } from "@/lib/incident-time"
import { telHref } from "@/lib/phone"
import { rekoPhotoUrl } from "@/lib/reko-photos"
import { getIncidentTypeLabel, getIncidentLocationLabel } from "@/lib/incident-types"
import { PRIORITY_ICONS, PRIORITY_LABELS, PRIORITY_TEXT_CLASSES } from "@/lib/priority"
import {
  Truck, Users, Siren, Package, AlertTriangle, FileText, Phone,
  MessageSquare, Building2, Timer, Footprints, FileCheck, Waypoints, Binoculars,
  Infinity as InfinityIcon,
} from "lucide-react"
import { type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Icons/labels/colors all sourced from the shared priority module.
export const priorityVisuals: Record<
  Operation["priority"],
  { Icon: LucideIcon; label: string; iconColor: string }
> = {
  high: { Icon: PRIORITY_ICONS.high, label: PRIORITY_LABELS.high, iconColor: PRIORITY_TEXT_CLASSES.high },
  medium: { Icon: PRIORITY_ICONS.medium, label: PRIORITY_LABELS.medium, iconColor: PRIORITY_TEXT_CLASSES.medium },
  low: { Icon: PRIORITY_ICONS.low, label: PRIORITY_LABELS.low, iconColor: PRIORITY_TEXT_CLASSES.low },
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

  // Carry `consumable` along: Verbrauchsmaterial is on this incident AND possibly
  // others at the same time, so it gets the ∞ marker it wears everywhere else.
  const assignedMaterials = operation.materials.map(id => {
    const mat = materials.find(m => m.id === id)
    return { id, name: mat?.name ?? id, consumable: mat?.consumable ?? false }
  })

  const personnelRoleByName = new Map<string, string | undefined>(
    personnel.map(p => [p.name, p.role]),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl modal-h-tall overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PriorityIcon
              className={cn("h-5 w-5 flex-shrink-0", priorityIconColor)}
              aria-label={t('board.priorityAria', { label: priorityLabel })}
            />
            <span className="break-words">{getIncidentLocationLabel(operation)}</span>
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
            {/* The board-wide time chip, read-only — this modal opens on the wall
                display, where there is nobody to work a dropdown. Its durations are
                dropped on a closed incident: they would only keep growing overnight,
                and the Verlauf carries the times that still matter. */}
            <IncidentTimeRow
              operation={operation}
              readOnly
              suppressDurations={operation.status === "complete"}
              className="gap-1.5 text-muted-foreground"
              chipClassName="text-sm"
            />
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
              <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400">
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
            <div className="space-y-1.5 rounded-md border border-border p-3">
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
                      {materials.find((mat) => mat.id === m.resourceId)?.consumable ? (
                        <InfinityIcon className="h-3 w-3" aria-label={tk('material.consumableUnlimited')} />
                      ) : (
                        <Package className="h-3 w-3" />
                      )}
                      {m.name}
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
                <p className="text-sm">
                  <span className="text-muted-foreground">{t('board.contactPhone')}:</span>{" "}
                  {/* A number you cannot dial or copy is a number you retype by hand at 3am.
                      tel: also makes it selectable, which the mono <p> quietly was not. */}
                  <a
                    href={telHref(operation.contactPhone) ?? undefined}
                    className="underline underline-offset-2 hover:text-primary"
                  >
                    {operation.contactPhone}
                  </a>
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
                      time: formatClockTime(operation.rekoArrivedAt),
                    })}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Crew / Vehicles / Materials — only for an incident that owns its resources.
              On a stop inside an Auftrag these are structurally empty (the route holds crew,
              vehicles and material), so all three printed «(0) — nichts zugewiesen» directly
              under an Auftrag block that had just listed the very same people. Not a missing
              assignment, a duplicate heading. */}
          {!auftrag && (
          <>
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
            {assignedMaterials.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {assignedMaterials.map((m, i) => (
                  <Badge key={`${m.id}-${i}`} variant="secondary" className="text-sm gap-1">
                    {m.consumable && (
                      <InfinityIcon className="h-3.5 w-3.5 shrink-0" aria-label={tk('material.consumableUnlimited')} />
                    )}
                    {m.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60 italic">{t('board.noMaterials')}</p>
            )}
          </div>
          </>
          )}

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
                    <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" />
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
                {operation.rekoSummary.summaryText && (
                  <p className="whitespace-pre-wrap">{operation.rekoSummary.summaryText}</p>
                )}
              </div>
              {/* The photos the Reko took on site. They existed all along but
                  only ever inside the Reko form — the one place the command post
                  does not look. A picture of the damage is the most useful part
                  of a Reko result; it belongs where the result is read. */}
              {operation.rekoSummary.photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2 pt-1 sm:grid-cols-4">
                  {operation.rekoSummary.photos.map((filename, index) => (
                    <a
                      key={filename}
                      href={rekoPhotoUrl(operation.id, filename)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block aspect-square overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-80"
                      title={t('board.rekoPhotoOpen')}
                    >
                      {/* Plain <img>: the endpoint is behind the login and needs
                          the session cookie, which next/image's optimiser
                          (fetching server-side) does not carry. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={rekoPhotoUrl(operation.id, filename)}
                        alt={t('board.rekoPhotoAlt', { index: index + 1 })}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
