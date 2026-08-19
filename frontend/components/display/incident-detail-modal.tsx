"use client"

import { useEffect, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { type Operation } from "@/lib/contexts/operations-context"
import { usePersonnel, type Person } from "@/lib/contexts/personnel-context"
import { useMaterials, type Material } from "@/lib/contexts/materials-context"
import { useEvent } from "@/lib/contexts/event-context"
import { useAuth } from "@/lib/contexts/auth-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { type IncidentGroup, type GroupResources } from "@/lib/types/groups"
import { useVehicleDrivers } from "@/lib/hooks/use-vehicle-drivers"
import { columns } from "@/lib/kanban-utils"
import { IncidentTimeRow } from "@/components/ui/incident-time"
import { formatClockTime } from "@/lib/incident-time"
import { telHref } from "@/lib/phone"
import { rekoPhotoUrl } from "@/lib/reko-photos"
import { getIncidentTypeLabel, getIncidentLocationLabel } from "@/lib/incident-types"
import { sortCrewByLeader } from "@/lib/crew-order"
import { PRIORITY_ICONS, PRIORITY_LABELS, PRIORITY_TEXT_CLASSES } from "@/lib/priority"
import {
  Truck, Users, Siren, Package, AlertTriangle, FileText, Phone, Axe,
  MessageSquare, Building2, Timer, Footprints, FileCheck, Waypoints, Binoculars,
  ChevronDown, ChevronRight, ClipboardList, History,
  Infinity as InfinityIcon,
} from "lucide-react"
import { type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { rapportApplies } from "@/lib/rapport-visibility"
import { useIncidentTimeline, type IncidentTimelineState } from "@/lib/hooks/use-incident-timeline"
import { PickupBadge } from "@/components/kanban/pickup-badge"
import RekoReportSection from "@/components/reko/reko-report-section"
import { FieldMessageThread } from "@/components/kanban/field-reports-row"
import { SchadenplatzRapportSection } from "@/components/kanban/schadenplatz-rapport-section"
import { IncidentTimeline } from "@/components/kanban/incident-timeline"
import { IncidentParticipants } from "@/components/kanban/incident-participants"

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
 *
 * With `showReports` it also carries the things the command post's own detail
 * keeps behind tabs — the Reko-Bericht in full, the Funkmeldungen, the
 * Schadenplatz-Rapport and the Verlauf. Read-only throughout: the same
 * components the editor mounts, with `canEdit={false}`, rather than a second
 * rendering that drifts.
 *
 * Reko-Bericht and Rapport open by themselves **when there is one filed**:
 * nobody stands at a wall display to click a chevron, so a report behind a fold
 * is a report the command post does not read. Empty stays folded — an unfilled
 * form and a «kein Bericht» placeholder are not information, and folded means
 * unmounted, so they cost no request either. The Verlauf stays folded on
 * purpose: it is the one section that is a log rather than a picture of now.
 *
 * It is off by default because those endpoints need a session: a share-token
 * display has no cookie, and offering a section that can only answer 401 is
 * worse than not offering it.
 *
 * A **session is not the same as the right to read all of it**. Reko-Bericht,
 * Funkmeldungen and Verlauf are `CurrentUser` and answer a viewer; the
 * Schadenplatz-Rapport is `CurrentEditor` by design, because its response
 * carries the owner block — the first citizen PII in kp-rueck. So the rapport
 * is gated on `isEditor` rather than on having logged in at all. Without that,
 * a logged-in viewer's home screen — ProtectedRoute sends viewers straight to
 * /display/board — sat on a red «Rapport konnte nicht geladen werden», an
 * «Erneut laden» button that re-fired the 403 forever, and one sonner toast per
 * attempt, on a screen with nobody in front of it.
 */
export function IncidentDetailModal({
  operation,
  open,
  onOpenChange,
  personnelOverride,
  materialsOverride,
  groupsOverride,
  groupResourcesOverride,
  viewerToken,
  showReports = false,
}: {
  operation: Operation | null
  open: boolean
  onOpenChange: (open: boolean) => void
  personnelOverride?: Person[]
  materialsOverride?: Material[]
  groupsOverride?: IncidentGroup[]
  /** groupId → route-owned resources, for token displays that have no groups context. */
  groupResourcesOverride?: Map<string, GroupResources>
  /**
   * The share token this display was opened with, if any. Only the Reko photos
   * need it: their `<img>` carries no session cookie, so without the token the
   * endpoint answers 401 and the grid draws broken images.
   */
  viewerToken?: string
  showReports?: boolean
}) {
  const t = useTranslations('display')
  const tk = useTranslations('kanban')
  const tr = useTranslations('reko.reportSection')
  const tf = useTranslations('feld.kp')
  // Only an editor may read the Schadenplatz-Rapport (citizen PII) — see the
  // component doc. False for a viewer and for a share-token display alike.
  const { isEditor } = useAuth()
  const { materials: contextMaterials } = useMaterials()
  const { personnel: contextPersonnel } = usePersonnel()
  const { selectedEvent } = useEvent()
  const { groups: contextGroups, getGroupResources } = useGroups()
  const vehicleDrivers = useVehicleDrivers(selectedEvent?.id, open && !!operation)
  // ONE fetch of the incident's history for the whole dialog — the Funkmeldungen
  // thread and the Verlauf read the same feed, exactly as the command post's two
  // tabs do. Only with `showReports`: a share-token display has no session and
  // the endpoint would answer 401.
  const timeline = useIncidentTimeline(operation?.id ?? null, open && showReports && !!operation)

  const materials = materialsOverride ?? contextMaterials
  const personnel = personnelOverride ?? contextPersonnel
  const groups = groupsOverride ?? contextGroups

  const auftrag = operation?.groupId ? groups.find((g) => g.id === operation.groupId) : undefined
  // Route-owned resources: from the groups context when logged in, from the
  // caller's map on a share-token display (whose payload carries the raw
  // Auftrag assignments but has no groups context to resolve them).
  const auftragResources = auftrag
    ? (groupsOverride ? groupResourcesOverride?.get(auftrag.id) ?? null : getGroupResources(auftrag.id))
    : null

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

  // What the Reko reported. It rides along on the event-wide Reko-Summaries the
  // board already loads — no request of its own. A share-token display gets the
  // same summaries in its payload, photo filenames included; the pictures then
  // come from the photo endpoint with `viewerToken` appended (see `rekoPhotoUrl`).
  const rekoSummary = operation.hasCompletedReko ? operation.rekoSummary : null

  // Anything the Schadenplatz reported — a tapped «angekommen»/«beendet», or a
  // Freitext-Meldung in the feed. It decides whether the Rapport block opens by
  // itself: on a wall, folded means unread.
  const hasFieldReports =
    Boolean(operation.fieldArrivedAt || operation.fieldCompleteReportedAt)
    || (timeline.events?.some((event) => event.event_type === 'field_message' && event.message) ?? false)

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
            {operation.source === 'feld' && (
              <Badge variant="outline" className="gap-1 border-violet-500/50 text-violet-600 dark:text-violet-400">
                <Axe className="h-3 w-3" /> {t('board.feldBadge')}
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
            {/* «Abholung nötig» — the Funkmeldung the command post's Rapport tab
                sets and this screen only reads. A crew standing in the rain is
                the last thing a wall display may keep to itself. No
                `incidentId`: without it the shared chip is a label, not the
                KP's «erledigt» button. */}
            {operation.pickupNeeded && (
              <PickupBadge
                requestedAt={operation.pickupRequestedAt}
                note={operation.pickupNote}
                className="py-1"
              />
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
                  {tk('card.auftragStopLine', {
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
                  {/* EL first (decision 23) — the route's leader heads the route's crew. */}
                  {sortCrewByLeader(auftragResources.personnel, (p) => Boolean(p.isLeader)).map((p) => (
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

          {/* REKO — who went, since when, and above all WHAT THEY FOUND.
              Those were two blocks with the three resource lists between them:
              the top of the dialog said a Reko was running, the result turned up
              somewhere below the Material. One block now, and the finding — the
              free text the Reko dictated — leads it, because that is the
              sentence somebody walks up to the wall to read. */}
          {(operation.assignedReko || operation.rekoArrivedAt || rekoSummary) && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Binoculars className="h-4 w-4" /> {t('board.rekoHeading')}
                </div>
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
                {/* «Einsatz relevant» / «Kein Einsatz nötig» — the verdict, as a
                    badge rather than the old «Relevant: Ja» line: it is the one
                    Reko fact that decides whether this incident still needs
                    anybody. */}
                {rekoSummary && (
                  <Badge
                    variant={rekoSummary.isRelevant ? "secondary" : "outline"}
                    className="ml-auto gap-1 text-sm"
                  >
                    <FileCheck className="h-3.5 w-3.5" />
                    {rekoSummary.isRelevant ? tr('relevant') : tr('notNeeded')}
                  </Badge>
                )}
              </div>

              {rekoSummary && (
                <div className="space-y-2">
                  {/* The finding, in the dialog's largest body size. Capped at
                      eight lines: the full text stands untruncated in the
                      Reko-Bericht below, and one long dictation may not push the
                      Fahrzeuge off the screen. */}
                  {rekoSummary.summaryText && (
                    <p
                      className="line-clamp-[8] whitespace-pre-wrap text-base leading-snug"
                      title={rekoSummary.summaryText}
                    >
                      {rekoSummary.summaryText}
                    </p>
                  )}
                  {rekoSummary.hasDangers && (
                    <div className="flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{t('board.dangers', { types: rekoSummary.dangerTypes.join(", ") })}</span>
                    </div>
                  )}
                  {(rekoSummary.personnelCount !== null || rekoSummary.estimatedDuration !== null) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {rekoSummary.personnelCount !== null && (
                        <span>
                          <span className="text-muted-foreground">{t('board.personnelNeed')}</span>{" "}
                          {t('common.personCount', { count: rekoSummary.personnelCount })}
                        </span>
                      )}
                      {rekoSummary.estimatedDuration !== null && (
                        <span>
                          <span className="text-muted-foreground">{t('board.estimatedDuration')}</span>{" "}
                          {t('board.durationHours', { hours: rekoSummary.estimatedDuration })}
                        </span>
                      )}
                    </div>
                  )}
                  {/* The photos the Reko took on site. They existed all along but
                      only ever inside the Reko form — the one place the command
                      post does not look. A picture of the damage is the most
                      useful part of a Reko result; it belongs where the result
                      is read. */}
                  {rekoSummary.photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 pt-1 sm:grid-cols-4">
                      {rekoSummary.photos.map((filename, index) => (
                        <a
                          key={filename}
                          href={rekoPhotoUrl(operation.id, filename, viewerToken)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block aspect-square overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-80"
                          title={t('board.rekoPhotoOpen')}
                        >
                          {/* Plain <img>: the endpoint needs a credential the
                              browser carries itself — the session cookie, or the
                              share token in the query — and next/image's
                              optimiser (fetching server-side) carries neither. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={rekoPhotoUrl(operation.id, filename, viewerToken)}
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
                {/* EL first (decision 23): read off a wall at distance, the first
                    badge is the one that gets read at all. */}
                {sortCrewByLeader(operation.crew, operation.leaderName).map((name) => {
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

          {/* The reports. Everything the command post detail shows, nothing it
              can change — and the two that describe the Schadenplatz open on
              their own when something has been filed. */}
          {showReports && (
            <div className="space-y-2 border-t pt-3">
              <DisclosureSection
                label={t('board.rekoReportSection')}
                icon={Binoculars}
                defaultOpen={operation.hasCompletedReko}
              >
                <RekoReportSection incidentId={operation.id} canEdit={false} />
              </DisclosureSection>

              <DisclosureSection
                // A viewer gets the Funkmeldungen without the rapport below
                // them, so the block is named after what it actually contains.
                label={isEditor ? t('board.rapportSection') : tf('reportsTitle')}
                icon={ClipboardList}
                // A draft counts: half a rapport dictated over the radio is
                // still what the Schadenplatz reported, and the wall is where
                // it gets read. So does a bare Funkmeldung — the crew said
                // something about this address and nobody has to click for it.
                // For a viewer only the Funkmeldung can open it: the rapport
                // flags describe something they are not being shown.
                defaultOpen={
                  (isEditor && (operation.hasSchadenplatzRapport || operation.hasSchadenplatzRapportDraft))
                  || hasFieldReports
                }
              >
                {/* What came in from the Schadenplatz, above the rapport it
                    belongs to — the command post's Rapport tab in one column.
                    This was the one thing the display had no rendering of at
                    all: a crew's Funkmeldung reached the board and the wall
                    beside it stayed silent. */}
                <div className={cn(isEditor && "mb-3")}>
                  <FieldMessageThread
                    operation={operation}
                    events={timeline.events}
                    isLoading={timeline.isLoading}
                    failed={timeline.failed}
                    onRetry={timeline.reload}
                    // The wall reads, it does not dispatch — no send box here.
                    canEdit={false}
                  />
                </div>
                {/* Editor only — `GET /incidents/{id}/rapport` is CurrentEditor
                    because the response carries the owner block. Mounting it for
                    a viewer produced a permanent 403 with a retry button that
                    could only 403 again. */}
                {isEditor && (
                <SchadenplatzRapportSection
                  incidentId={operation.id}
                  canEdit={false}
                  // «Material zurück – freigeben» is the KP's own to-do list, not
                  // a report: it was rendering here as a greyed-out «1 Gerät
                  // freigeben» button on a screen nobody operates. The command
                  // post's detail opts out of it in the same way and mounts the
                  // list itself, next to the rest of its work. What the wall
                  // needs from it — which Material stayed at the address — is on
                  // the card, as the amber chip with the pin.
                  showMaterialReturn={false}
                  hasRapport={operation.hasSchadenplatzRapport}
                  applies={rapportApplies({
                    hasBeenDispatched: operation.hasBeenDispatched,
                    status: operation.status,
                    hasReport: operation.hasSchadenplatzRapport || operation.hasSchadenplatzRapportDraft,
                    // «Kein Einsatz nötig» + closed = no rapport is due (§P2.7).
                    rekoNotRelevant: operation.rekoSummary?.isRelevant === false,
                  })}
                />
                )}
              </DisclosureSection>

              {/* Folded, alone among the three: the Verlauf is a log of what is
                  already over, it is the longest thing in the dialog, and it
                  costs two more requests (timeline + Teilnehmer). What happened
                  is a question somebody asks — and asking is a click. */}
              <DisclosureSection label={t('board.historySection')} icon={History}>
                <IncidentHistory incidentId={operation.id} timeline={timeline} />
              </DisclosureSection>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One report block. The children are not mounted while closed — each of these
 * fetches (and the Reko section polls), so a section nobody is looking at costs
 * nothing.
 *
 * `defaultOpen` is that trade made per incident rather than for all of them:
 * the caller opens the blocks that HAVE something to show, and leaves the empty
 * ones folded and unmounted. Once open the block stays open — including when a
 * report lands while the dialog sits on the wall, which is the one case where
 * there is nobody to click.
 */
function DisclosureSection({
  label,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  label: string
  icon: LucideIcon
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/5"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </div>
  )
}

/** Verlauf: what happened, and who was here — the Verlauf tab's two lists.
 *  The timeline comes from the dialog so the Funkmeldungen thread above and
 *  this list share one request; only the Teilnehmer are fetched on opening. */
function IncidentHistory({ incidentId, timeline }: { incidentId: string; timeline: IncidentTimelineState }) {
  return (
    <div className="space-y-3">
      <IncidentTimeline
        events={timeline.events}
        isLoading={timeline.isLoading}
        failed={timeline.failed}
        onRetry={timeline.reload}
      />
      <IncidentParticipants incidentId={incidentId} />
    </div>
  )
}
