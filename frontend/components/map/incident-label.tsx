/** An incident pin's label bubble on the Lagekarte – short label, detail card or a same-address
 *  pin's numbers – with its geometry, which the label passes and the camera share. */

import { useCallback, useState, type CSSProperties, type ReactNode, type RefObject } from "react"
import type { Map as MlMap } from "maplibre-gl"
import { Marker } from "react-map-gl/maplibre"
import { incidentPinSize } from "@/lib/map-colors"
import { cardSide, type LabelSide } from "@/lib/map-labels"
import type { ScreenBox } from "@/lib/map-vehicles"
import { useSettledAfter } from "@/lib/hooks/use-settled-after"
import { useMapRelayout } from "@/lib/hooks/use-map-relayout"
import { REVEAL_MS } from "@/components/ui/reveal"
import { useOpenOnDoubleClick } from "./use-open-on-double-click"

// Permanent incident labels: the bubble sits to the RIGHT of the dot (on the desktop, the left when
// the right is taken – `placeLabelSides`), its near edge this far from it — the arrow's tip at
// `LABEL_ANCHOR_X`, 2px clear of the 32px pin at rest (desktop and phone alike, STATUS_RING), plus
// the 6px arrow.
export const LABEL_HEIGHT = 32
const LABEL_ANCHOR_X = incidentPinSize(false, false) / 2 + 2
export const LABEL_OFFSET_X = LABEL_ANCHOR_X + 6
/** Marks the selected incident's label bubble – what `selectedLabelBox` measures. */
export const SELECTED_LABEL_ATTR = "data-map-selected-label"

/**
 * Leaflet's tooltip bubble, rebuilt as a marker child.
 *
 * MapLibre has no tooltip of its own, and `<MapTooltip>` (which shares this look for the hover
 * bubbles) is deliberately inert: a label is CLICKABLE, opaque, and a same-address one carries a
 * list under it — so it gets its own chrome here.
 *
 * The app's own surface, not Leaflet's white: card / card-foreground / border tokens (so a dark
 * board gets a dark label, light stays light), Sora — `font-sans` beats the Helvetica MapLibre
 * sets on its container — the small-control radius and a restrained shadow. 6px padding + 18px
 * line + the 1px border each side = LABEL_HEIGHT.
 */
const LABEL_BUBBLE =
  "absolute left-0 top-0 cursor-pointer whitespace-nowrap rounded-sm border border-border bg-card p-1.5 " +
  "font-sans text-xs leading-[18px] text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.25)]"

/** The 6px triangle on the bubble's near edge, pointing back at the dot – in the bubble's fill. */
const LABEL_ARROW: Record<LabelSide, CSSProperties> = {
  right: {
    position: "absolute",
    top: "50%",
    left: -12,
    marginTop: -6,
    border: "6px solid transparent",
    borderRightColor: "var(--card)",
    pointerEvents: "none",
  },
  left: {
    position: "absolute",
    top: "50%",
    right: -12,
    marginTop: -6,
    border: "6px solid transparent",
    borderLeftColor: "var(--card)",
    pointerEvents: "none",
  },
}

/** What an open incident card needs to keep clear of the map chrome (`useCardSide`). */
interface CardFit {
  map: MlMap
  /** `mapChromeBoxes` under `root`, in the map container's px. */
  chrome: () => ScreenBox[]
  root: RefObject<HTMLElement | null>
}

/** The longest gap a double-click spans (the Windows default) – how long a just-pinned card
 *  holds still for the second click (`useCardSide`). */
const DOUBLE_CLICK_MS = 500

/**
 * The side an open incident card hangs on: `cardSide` at the current view, for the rendered
 * card (`card`), re-measured whenever that can change (`useMapRelayout`: the map comes to rest,
 * the card changes size, the chrome under `root` changes – the legend opens). `undefined`
 * without `fit`, and for DOUBLE_CLICK_MS after the card is pinned: the first click of a
 * double-click pins it, and a card that flipped sides there would miss the second click (Sol
 * review H round 2). The caller keeps the side the card had until then.
 */
function useCardSide(
  fit: CardFit | undefined,
  card: RefObject<HTMLElement | null>,
  latitude: number,
  longitude: number,
): LabelSide | undefined {
  const [side, setSide] = useState<LabelSide>("right")
  const map = fit?.map
  const chrome = fit?.chrome
  const settled = useSettledAfter(!!map, DOUBLE_CLICK_MS)
  const measure = useCallback(() => {
    const element = card.current
    if (!map || !chrome || !element) return
    const container = map.getContainer()
    setSide(
      cardSide({
        anchor: map.project([longitude, latitude]),
        card: { width: element.offsetWidth, height: element.offsetHeight },
        labelOffsetX: LABEL_OFFSET_X,
        chrome: chrome(),
        viewport: { width: container.clientWidth, height: container.clientHeight },
      }),
    )
  }, [map, chrome, card, latitude, longitude])
  useMapRelayout(map, measure, { root: fit?.root, target: card, settleMs: REVEAL_MS + 50 })
  return settled ? side : undefined
}

/**
 * One pin's permanent map label — its own DOM marker at the pin's coordinates.
 *
 * Under Leaflet this was a tooltip instance that had to be mutated by hand (react-leaflet builds
 * a `<Tooltip>` once and ignores every later prop change), plus a DOM re-append to bring the
 * hovered one to the front. Here the side, the hover state and the stacking are all just props.
 *
 * Labels are never walked away from their markers: resolving every collision that way moved
 * addresses hundreds of pixels off, and the address you then read next to a dot was somebody
 * else's. The most they do is flip to the other side of their own pin (desktop,
 * `placeLabelSides`); where neither side is free they overlap, and the one pointed at comes to the
 * front. Incidents at one address share ONE label (`lib/map-spots.ts`), and that one may carry
 * the list of them (`below`).
 *
 * The bubble hangs off a zero-sized wrapper, so the wrapper's origin IS the pin's anchor point.
 */
export function IncidentLabel({
  latitude,
  longitude,
  side,
  zIndex,
  onSelect,
  onOpen,
  onHoverStart,
  onHoverEnd,
  below,
  selected = false,
  fit,
  children,
}: {
  latitude: number
  longitude: number
  /** Which side of the pin the bubble hangs on (`placeLabelSides`). */
  side: LabelSide
  /** Desktop, a pinned (selected) incident card: once a double-click can no longer land, hang
   *  it on the side the map chrome covers least (`useCardSide`) instead of `side`. Never a hover
   *  card – it must stay under the pointer. */
  fit?: CardFit
  /** `incidentZ('label', …)`: under every resting pin, in front once pointed at or selected. */
  zIndex: number
  onSelect: () => void
  /** Double-click: open the Einsatz, like a double-click on its dot. */
  onOpen?: () => void
  onHoverStart: () => void
  onHoverEnd: () => void
  /** Hung under the bubble, on the same side: a same-address pin's list (`SpotList`). Its own
   *  clicks are its own – they do not count as a click on the label. */
  below?: ReactNode
  /** The selected incident's label: the phone camera measures it to bring it into view
   *  (`usePanToSelected`). */
  selected?: boolean
  children: ReactNode
}) {
  const doubleClickRef = useOpenOnDoubleClick(onOpen)
  const shown = useCardSide(fit, doubleClickRef, latitude, longitude) ?? side
  const shift = shown === "right" ? `${LABEL_OFFSET_X}px` : `calc(-100% - ${LABEL_OFFSET_X}px)`
  return (
    <Marker
      longitude={longitude}
      latitude={latitude}
      style={{ zIndex }}
      // Like every marker here, the click must not reach the map underneath.
      onClick={(event) => event.originalEvent.stopPropagation()}
    >
      <div style={{ position: "relative", width: 0, height: 0 }}>
        {/* The label is as tappable as the dot (selection, Reko-Editor assignment, …). */}
        <div
          ref={doubleClickRef}
          className={LABEL_BUBBLE}
          style={{ transform: `translate(${shift}, -50%)` }}
          {...(selected && { [SELECTED_LABEL_ATTR]: "" })}
          onClick={onSelect}
          onMouseEnter={onHoverStart}
          onMouseLeave={onHoverEnd}
        >
          <span style={LABEL_ARROW[shown]} />
          {children}
        </div>
        {below && (
          <div
            className="absolute left-0"
            style={{ top: LABEL_HEIGHT / 2 + 6, transform: `translateX(${shift})` }}
            onMouseEnter={onHoverStart}
            onMouseLeave={onHoverEnd}
          >
            {below}
          </div>
        )}
      </div>
    </Marker>
  )
}
