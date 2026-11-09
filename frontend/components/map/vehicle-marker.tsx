"use client"

/**
 * The Lagekarte's vehicle marks (owner pick r28 1A): one pill per GPS spot, its hover list, and –
 * when the pill had to step off an incident pin – a thin leader to a dot at the real fix.
 *
 * `VehiclePill` is the pill alone (the legend draws its samples with it); `VehicleSpotMarker` is a
 * spot on the map. The rules – who clusters, what is stale, where a pill steps to, which side the
 * list opens on – are pure and live in `lib/map-vehicles.ts`.
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react"
import { Marker, useMap } from "react-map-gl/maplibre"
import { useTranslations } from "next-intl"
import type { ApiVehiclePosition } from "@/lib/api-client"
import { MAP_COLORS } from "@/lib/map-colors"
import { Z } from "@/lib/map-view"
import {
  LIST_ROW_HEIGHT,
  LIST_VISIBLE_ROWS,
  PILL_HEIGHT,
  isOnline,
  isStale,
  placeHoverList,
  reportDay,
  type PillFace,
  type PillOffset,
  type ScreenBox,
  type VehicleSpot,
} from "@/lib/map-vehicles"
import { formatTime } from "@/lib/format-time"
import { getIntlLocale } from "@/lib/date-locale"

/**
 * Above this speed a vehicle counts as MOVING – the floor for the km/h in the list and for the
 * heading arrow beside the pill. A parked tracker still reports a metre of jitter per fix, which
 * arrives as a fraction of a km/h with whatever `course` the noise pointed at; drawing that would
 * make the whole depot twitch.
 */
export const MOVING_SPEED_KMH = 1

// Grace period before an abandoned list closes – long enough to cross the gap into it.
const LIST_CLOSE_MS = 200
const LIST_WIDTH = 272
const LIST_HEADER = 32
const LIST_FOOTER = 22
const LIST_GAP = 10

const PILL_BASE =
  "relative hit-area flex items-center whitespace-nowrap font-sans text-[13px] font-bold leading-none " +
  "box-border shadow-[0_2px_6px_rgb(0_0_0/0.3)]"
// Online: the reporting blue with the white frame every map mark wears.
const SOLID: CSSProperties = { background: MAP_COLORS.info, color: "white", border: "2px solid white" }
// Offline: hollow – the card colour behind a dashed grey frame, the text muted. No fill colour
// for «not reporting» (grey was easy to read as just another vehicle).
const HOLLOW: CSSProperties = { border: `2px dashed ${MAP_COLORS.offline}` }

/**
 * One pill as drawn on the map and in the legend. `offlinePart` makes it the split pill of a spot
 * with online and offline vehicles («6 Fahrzeuge | 4 offline»); `time` is the stale last report.
 */
export function VehiclePill({
  online,
  label,
  time,
  offlinePart,
  heading,
}: {
  online: boolean
  label: string
  time?: string | null
  offlinePart?: string | null
  /** A moving single vehicle's GPS course – the arrow at the pill's edge. */
  heading?: number | null
}) {
  const height = { height: PILL_HEIGHT }
  if (offlinePart) {
    return (
      <span className={`${PILL_BASE} rounded-[4px]`} style={height}>
        <span className="box-border flex h-full items-center rounded-l-[4px] px-2" style={{ ...SOLID, borderRight: 0 }}>
          {label}
        </span>
        <span
          className="box-border flex h-full items-center rounded-r-[4px] bg-card px-[7px] text-xs font-semibold text-muted-foreground"
          style={{ ...HOLLOW, borderLeft: `1px solid ${MAP_COLORS.offline}` }}
        >
          {offlinePart}
        </span>
      </span>
    )
  }
  return (
    <span
      className={`${PILL_BASE} gap-[5px] rounded-[4px] px-2 ${online ? "" : "bg-card text-muted-foreground"}`}
      style={{ ...height, ...(online ? SOLID : HOLLOW) }}
    >
      {label}
      {time && <span className="font-mono text-2xs font-medium">{time}</span>}
      {heading != null && <HeadingArrow course={heading} />}
    </span>
  )
}

// Clearance between the pill's edge and the tip of the heading arrow.
const HEADING_ARROW_GAP = 4

/**
 * Which way a moving vehicle is pointing: a small white triangle just outside the pill's edge,
 * rotated to the GPS `course` (0 = north, clockwise – Traccar's convention, and CSS's). A DOM
 * element, not a symbol layer: a style reload (the auto→offline fallback) drops every image on the
 * GL map. The maps are north-up, so no counter-rotation. It sits on the pill's EDGE along the
 * heading – measured from the pill's own box once drawn – not on a fixed circle: the pill is wide,
 * and a constant radius parked an eastbound arrow in the middle of the name.
 */
function HeadingArrow({ course }: { course: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pillWidth, setPillWidth] = useState(PILL_HEIGHT * 2)
  useEffect(() => {
    const width = ref.current?.parentElement?.offsetWidth
    if (width) setPillWidth(width)
  }, [])
  const radians = (course * Math.PI) / 180
  const sin = Math.abs(Math.sin(radians))
  const cos = Math.abs(Math.cos(radians))
  const distance =
    Math.min(sin === 0 ? Infinity : pillWidth / 2 / sin, cos === 0 ? Infinity : PILL_HEIGHT / 2 / cos) + HEADING_ARROW_GAP
  return (
    <span
      ref={ref}
      aria-hidden
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 0,
        height: 0,
        borderLeft: "5px solid transparent",
        borderRight: "5px solid transparent",
        borderBottom: "6px solid #fff",
        filter: "drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45))",
        transform: `translate(-50%, -50%) rotate(${course}deg) translateY(-${distance}px)`,
        pointerEvents: "none",
      }}
    />
  )
}

/** A moving single vehicle's course, else null (a spot of several never wears an arrow). */
export function headingOf(spot: VehicleSpot): number | null {
  if (spot.vehicles.length !== 1) return null
  const [vehicle] = spot.vehicles
  return vehicle.course !== null && Number.isFinite(vehicle.course) && vehicle.speed !== null && vehicle.speed > MOVING_SPEED_KMH
    ? vehicle.course
    : null
}

type MapT = ReturnType<typeof useTranslations<"map">>

/** «18:41», «gestern 20:05», «09.11. 20:05» – the last report as the pill and the list say it. */
export function formatReportTime(t: MapT, lastUpdate: string, now: number): string | null {
  const day = reportDay(lastUpdate, now)
  if (!day) return null
  const time = formatTime(lastUpdate)
  if (day === "today") return time
  if (day === "yesterday") return t("vehicles.yesterday", { time })
  const date = new Date(lastUpdate).toLocaleDateString(getIntlLocale(), { day: "2-digit", month: "2-digit" })
  return `${date} ${time}`
}

/** The words a pill shows for its face (`pillFace`): label, stale time, offline part. */
export function pillTexts(t: MapT, face: PillFace, now: number): { label: string; time: string | null; offlinePart: string | null } {
  if (face.kind === "single") {
    return { label: face.name, time: face.staleAt ? formatReportTime(t, face.staleAt, now) : null, offlinePart: null }
  }
  return {
    label: t("page.vehicleCluster", { count: face.count }),
    time: null,
    // Only the part that applies: all online or all offline is one pill.
    offlinePart: face.online > 0 && face.offline > 0 ? t("vehicles.offlinePart", { count: face.offline }) : null,
  }
}

/**
 * One GPS spot on the map. `offset` (from `placeVehiclePills`) moves the pill off an incident pin;
 * the leader and the dot then mark where the fix really is. Pointing at the pill (or a tap /
 * click, which keeps it open until the map is clicked) opens the list of its vehicles.
 */
export function VehicleSpotMarker({
  spot,
  face,
  scale,
  offset,
  nameFor,
  assignmentFor,
  atMagazin,
  now,
  staleMinutes,
  chrome,
}: {
  spot: VehicleSpot
  face: PillFace
  scale: number
  offset: PillOffset | undefined
  nameFor: (vehicle: ApiVehiclePosition) => string
  /** Where the vehicle is assigned («12 Ringstrasse 11»), if anywhere. */
  assignmentFor: (vehicle: ApiVehiclePosition) => string | null
  /** The spot lies at the Magazin: its list header says so. */
  atMagazin: boolean
  now: number
  staleMinutes: number
  /** The map's buttons and chrome, which draw above the open list – it slides off them. */
  chrome: () => ScreenBox[]
}) {
  const t = useTranslations("map")
  const { current: mapRef } = useMap()
  const map = mapRef?.getMap()
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  // A pinned list closes on a click on the map.
  useEffect(() => {
    if (!pinned || !map) return
    const close = () => setPinned(false)
    map.on("click", close)
    return () => { map.off("click", close) }
  }, [pinned, map])
  const open = hovered || pinned

  const texts = pillTexts(t, face, now)
  const dx = offset?.dx ?? 0
  const dy = offset?.dy ?? 0
  const online = face.kind === "single" ? face.online : face.online > 0
  const stateWord = face.kind === "single"
    ? [online ? t("vehicles.online") : t("vehicles.offline"), texts.time && t("vehicles.lastReport", { time: texts.time })].filter(Boolean).join(", ")
    : t("vehicles.onlineCount", { count: face.online })
  const name = `${texts.label}${texts.offlinePart ? `, ${texts.offlinePart}` : ""}: ${stateWord}`

  const enter = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setHovered(true)
  }
  const leave = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setHovered(false)
    }, LIST_CLOSE_MS)
  }

  // Where the list opens: measured once when it opens (the map does not move under a pointer).
  const rows = spot.vehicles.length
  const listHeight =
    (spot.vehicles.length > 1 ? LIST_HEADER : 0) + Math.min(rows, LIST_VISIBLE_ROWS) * LIST_ROW_HEIGHT + 8 +
    (rows > LIST_VISIBLE_ROWS ? LIST_FOOTER : 0)
  const pillHalfHeight = (PILL_HEIGHT * scale) / 2
  let listPlace: ReturnType<typeof placeHoverList> = { side: "top", shiftX: 0, room: listHeight }
  let listWidth = LIST_WIDTH
  if (open && map) {
    const container = map.getContainer()
    const viewport = { width: container.clientWidth, height: container.clientHeight }
    listWidth = Math.min(LIST_WIDTH, viewport.width - 16)
    const fix = map.project([spot.longitude, spot.latitude])
    listPlace = placeHoverList({
      anchor: { x: fix.x + dx, y: fix.y + dy },
      pillHalfHeight,
      list: { width: listWidth, height: listHeight },
      viewport,
      chrome: chrome(),
      gap: LIST_GAP,
    })
  }

  return (
    <Marker
      longitude={spot.longitude}
      latitude={spot.latitude}
      style={{ zIndex: open ? Z.vehicleOpen : offset?.crowded ? Z.vehicleCrowded : Z.vehicle }}
      onClick={(event) => event.originalEvent.stopPropagation()}
    >
      {/* Zero-sized: its origin IS the fix. */}
      <div style={{ position: "relative", width: 0, height: 0 }} onPointerEnter={enter} onPointerLeave={leave}>
        {/* At the Magazin its ⌂ already marks the spot – a dot there would only cover it. */}
        {(dx !== 0 || dy !== 0) && <Leader dx={dx} dy={dy} dot={!atMagazin} />}
        <button
          type="button"
          aria-label={name}
          aria-expanded={open}
          className="absolute left-0 top-0 block rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          // `scale` leaves the layout box at its natural size; it scales about the pill's centre.
          style={{ transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${scale})` }}
          onClick={() => setPinned((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setPinned(false)
          }}
        >
          <VehiclePill online={online} label={texts.label} time={texts.time} offlinePart={texts.offlinePart} heading={headingOf(spot)} />
        </button>
        {open && (
          <VehicleList
            spot={spot}
            title={spot.vehicles.length > 1 ? (atMagazin ? `${texts.label} · ${t("view.magazin")}` : texts.label) : null}
            width={listWidth}
            room={listPlace.room}
            style={{
              left: dx + listPlace.shiftX,
              top: listPlace.side === "top" ? dy - pillHalfHeight - LIST_GAP : dy + pillHalfHeight + LIST_GAP,
              transform: listPlace.side === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
            }}
            arrow={{ side: listPlace.side, shiftX: -listPlace.shiftX }}
            nameFor={nameFor}
            assignmentFor={assignmentFor}
            now={now}
            staleMinutes={staleMinutes}
          />
        )}
      </div>
    </Marker>
  )
}

/** The thin leader from the real fix to a stepped-aside pill, and (`dot`) the dot at the fix. */
function Leader({ dx, dy, dot }: { dx: number; dy: number; dot: boolean }) {
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible text-foreground" width={1} height={1}>
        <line x1={0} y1={0} x2={dx} y2={dy} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeOpacity={0.85} />
      </svg>
      {dot && <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-[0_0_0_1.5px_var(--card)]"
      />}
    </>
  )
}

/**
 * The spot's vehicles, one line each – online first – capped at five rows; more scroll, and the
 * foot says how many are left below. It takes the pointer (to scroll) but keeps wheel and drag
 * from reaching the map underneath, which would zoom or pan instead.
 */
function VehicleList({
  spot,
  title,
  width,
  room,
  style,
  arrow,
  nameFor,
  assignmentFor,
  now,
  staleMinutes,
}: {
  spot: VehicleSpot
  /** Spots of several: «6 Fahrzeuge · Magazin»; a single vehicle has no header. */
  title: string | null
  width: number
  /** Height the map has for it on its side (`placeHoverList`): fewer rows scroll when short. */
  room: number
  style: CSSProperties
  arrow: { side: "top" | "bottom"; shiftX: number }
  nameFor: (vehicle: ApiVehiclePosition) => string
  assignmentFor: (vehicle: ApiVehiclePosition) => string | null
  now: number
  staleMinutes: number
}) {
  const t = useTranslations("map")
  const scrollerRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // Five rows, or as many whole rows as the map has room for (at least two).
  const chrome = (title ? LIST_HEADER : 0) + LIST_FOOTER + 8
  const rows = Math.max(2, Math.min(LIST_VISIBLE_ROWS, Math.floor((room - chrome) / LIST_ROW_HEIGHT)))
  const extra = spot.vehicles.length - rows
  const [below, setBelow] = useState(Math.max(0, extra))

  // Native listeners: MapLibre's handlers sit on the map container, which a React handler would
  // only reach after the map had already zoomed or started a drag.
  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const stop = (event: Event) => event.stopPropagation()
    const events = ["wheel", "mousedown", "touchstart", "touchmove", "pointerdown", "dblclick"] as const
    for (const name of events) element.addEventListener(name, stop, { passive: true })
    return () => {
      for (const name of events) element.removeEventListener(name, stop)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={title ?? nameFor(spot.vehicles[0])}
      className="absolute rounded-lg border border-border bg-card p-1 font-sans text-card-foreground shadow-lg"
      style={{ ...style, width }}
    >
      {title && (
        <div className="flex items-baseline justify-between gap-2 border-b border-border px-2 pb-1.5 pt-1" style={{ height: LIST_HEADER - 4 }}>
          <span className="truncate text-xs font-bold" title={title}>{title}</span>
          <span className="shrink-0 text-2xs text-muted-foreground">{t("vehicles.onlineCount", { count: spot.online })}</span>
        </div>
      )}
      <div
        ref={scrollerRef}
        className="relative overflow-y-auto overscroll-contain"
        style={{ maxHeight: rows * LIST_ROW_HEIGHT }}
        onScroll={(event) => {
          const element = event.currentTarget
          const hidden = element.scrollHeight - element.clientHeight - element.scrollTop
          setBelow(Math.max(0, Math.round(hidden / LIST_ROW_HEIGHT)))
        }}
      >
        {spot.vehicles.map((vehicle) => (
          <VehicleRow
            key={vehicle.device_id}
            vehicle={vehicle}
            name={nameFor(vehicle)}
            assignment={assignmentFor(vehicle)}
            now={now}
            staleMinutes={staleMinutes}
          />
        ))}
      </div>
      {extra > 0 && (
        <p className="px-2 pt-0.5 text-2xs text-muted-foreground" style={{ height: LIST_FOOTER }} aria-hidden>
          {below > 0 ? t("vehicles.scrollMore", { count: below }) : " "}
        </p>
      )}
      <ListArrow side={arrow.side} shiftX={arrow.shiftX} />
    </div>
  )
}

/** One line of the list: state dot, name, then «online» / «34 km/h» or «zuletzt 18:41», and where
 *  it is assigned. Truncated with the full line in `title`. */
function VehicleRow({
  vehicle,
  name,
  assignment,
  now,
  staleMinutes,
}: {
  vehicle: ApiVehiclePosition
  name: string
  assignment: string | null
  now: number
  staleMinutes: number
}) {
  const t = useTranslations("map")
  const online = isOnline(vehicle)
  const time = formatReportTime(t, vehicle.last_update, now)
  const parts: ReactNode[] = []
  if (online) {
    parts.push(vehicle.speed !== null && vehicle.speed > MOVING_SPEED_KMH ? t("vehicles.speed", { kmh: Math.round(vehicle.speed) }) : t("vehicles.online"))
    if (time && isStale(vehicle.last_update, now, staleMinutes)) parts.push(t("vehicles.lastReport", { time }))
  } else {
    parts.push(time ? t("vehicles.lastReport", { time }) : t("vehicles.lastReportUnknown"))
  }
  if (assignment) parts.push(t("vehicles.assignedTo", { target: assignment }))
  const detail = parts.join(" · ")
  return (
    <div className="flex items-center gap-2 rounded-sm px-2" style={{ height: LIST_ROW_HEIGHT }}>
      <StateDot online={online} />
      <span className="min-w-[2.75rem] shrink-0 text-xs font-semibold">{name}</span>
      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground" title={detail}>{detail}</span>
    </div>
  )
}

/** Solid blue = online, dashed grey ring = offline – the pills' own language in small. */
function StateDot({ online }: { online: boolean }) {
  return online ? (
    <span aria-hidden className="size-[9px] shrink-0 rounded-full shadow-[0_0_0_1.5px_white]" style={{ background: MAP_COLORS.info }} />
  ) : (
    <span aria-hidden className="box-border size-[9px] shrink-0 rounded-full" style={{ border: `1.5px dashed ${MAP_COLORS.offline}` }} />
  )
}

/** The 6px triangle pointing back at the pill, kept on the pill when the list shifted sideways. */
function ListArrow({ side, shiftX }: { side: "top" | "bottom"; shiftX: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        left: `calc(50% + ${shiftX}px)`,
        marginLeft: -6,
        border: "6px solid transparent",
        ...(side === "top"
          ? { bottom: -12, borderTopColor: "var(--card)" }
          : { top: -12, borderBottomColor: "var(--card)" }),
      }}
    />
  )
}
