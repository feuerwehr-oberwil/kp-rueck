"use client"

/**
 * Picking stops on an Auftrag map — the one rule both Auftrag maps follow.
 *
 * Used by the Routen-Editor's map (`kanban/routen-editor-modal.tsx`) and the Karte view of the
 * stop picker «Einsätze als Stopps hinzufügen» (`kanban/incident-picker-dialog.tsx`), so the
 * two maps behave the same (owner pick 23.11.2026 #15):
 *
 *  - the target Auftrag's stops are the numbered pins of `<GroupRoutes>` (1, 2, 3 … with the
 *    route line); every other incident is a small `RouteContextPin`;
 *  - a FREE incident (in no Auftrag, grey) clicked → it becomes the next number;
 *  - another Auftrag's stop (muted, in that route's colour) clicked → the «In Auftrag
 *    aufnehmen?» question, then it moves into this Auftrag;
 *  - a picked stop clicked → it leaves the sequence and the rest renumber (picker only: the
 *    editor saves at once, so its own stops are focused, not dropped).
 *
 * The editor applies each click immediately; the picker collects them until «Übernehmen».
 */

import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { Marker } from "react-map-gl/maplibre"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { IncidentGroup } from "@/lib/types/groups"
import type { LocatedOperation } from "@/lib/utils/route-geo"
import { MapTooltip } from "./map-tooltip"

// --- The rule ----------------------------------------------------------------

/**
 * The target Auftrag's stop order once the picks apply: its kept stops in route order, then
 * the new picks in the order they were clicked (a `Set` keeps insertion order). This is the
 * order `addStops` appends them in, so the numbers on the map are the numbers they will get.
 */
export function stopSequence(routeStopIds: readonly string[], picked: ReadonlySet<string>): string[] {
  const route = new Set(routeStopIds)
  return [...routeStopIds.filter((id) => picked.has(id)), ...[...picked].filter((id) => !route.has(id))]
}

/** What a click on an incident pin of an Auftrag map does. */
export type StopPinClick =
  | { kind: "drop" }
  | { kind: "add" }
  | { kind: "move"; from: IncidentGroup }

/**
 * Decides a click: a pin already in the sequence drops out, one on another Auftrag asks
 * before it moves, any other is added as the next stop.
 */
export function stopPinClick(
  incidentId: string,
  sequence: ReadonlySet<string>,
  otherRouteOf: (incidentId: string) => IncidentGroup | undefined,
): StopPinClick {
  if (sequence.has(incidentId)) return { kind: "drop" }
  const from = otherRouteOf(incidentId)
  return from ? { kind: "move", from } : { kind: "add" }
}

// --- The move question -------------------------------------------------------

interface PendingMove {
  incidentLabel: string
  fromName: string
  /** The Auftrag being edited – the one the stop moves into. */
  toName: string
  run: () => Promise<void> | void
}

/**
 * The question before another Auftrag's stop moves into this one — the same words as
 * «An Auftrag verteilen» (`kanban.dashboard.distributeConfirm*`). `ask` opens it; render
 * `dialog` once inside the map's surface.
 */
export function useMoveStopConfirm() {
  const t = useTranslations("kanban.dashboard")
  const [pending, setPending] = useState<PendingMove | null>(null)

  const ask = useCallback((move: PendingMove) => setPending(move), [])

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => !open && setPending(null)}
      title={t("distributeConfirmTitle", { auftrag: pending?.toName ?? "" })}
      description={t("distributeConfirmTransfer", {
        incident: pending?.incidentLabel ?? "",
        from: pending?.fromName ?? "",
        to: pending?.toName ?? "",
      })}
      confirmText={t("distributeConfirmAction")}
      // A move out of another Auftrag: Enter keeps to Abbrechen.
      initialFocus="cancel"
      onConfirm={async () => {
        await pending?.run()
      }}
    />
  )

  return { ask, dialog }
}

// --- The context pin ---------------------------------------------------------

/**
 * One incident that is NOT a stop of the target Auftrag.
 *
 * Its own component because it owns its hover state — hovering one pin must not re-render
 * the other few dozen. A small dot, deliberately unlike the numbered sequence pins: solid
 * grey = in no Auftrag, dashed + muted route colour = on another Auftrag.
 */
export function RouteContextPin({
  op,
  fill,
  otherRoute = false,
  clickable,
  title,
  subtitle,
  hint,
  onSelect,
}: {
  op: LocatedOperation
  fill: string
  /** On another Auftrag: dashed and muted. */
  otherRoute?: boolean
  clickable: boolean
  title: string
  subtitle?: string
  hint?: string
  onSelect: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [lat, lng] = op.coordinates

  return (
    <Marker
      longitude={lng}
      latitude={lat}
      // Below the numbered stops (Z.routeStop = 100), so a route's own pins always win.
      style={{ zIndex: hovered ? 90 : 50 }}
      // The click would otherwise bubble on to the map (and, in the editor with «Stopp
      // hinzufügen» armed, add a second, geocoded stop at the same spot).
      onClick={(event) => {
        event.originalEvent.stopPropagation()
        if (clickable) onSelect()
      }}
    >
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: fill,
            border: `2px ${otherRoute ? "dashed" : "solid"} white`,
            boxShadow: "0 1px 4px rgba(0, 0, 0, 0.3)",
            opacity: otherRoute ? 0.45 : 0.9,
            cursor: clickable ? "pointer" : "default",
          }}
        />
        {hovered && (
          <MapTooltip side="top" gap={16}>
            <div className="text-xs leading-tight">
              <div className="font-medium">{title}</div>
              {subtitle && <div className="text-muted-foreground">{subtitle}</div>}
              {hint && <div className="text-muted-foreground">{hint}</div>}
            </div>
          </MapTooltip>
        )}
      </div>
    </Marker>
  )
}
