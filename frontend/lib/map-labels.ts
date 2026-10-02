/**
 * Which incident labels the Lagekarte draws permanently.
 *
 * Desktop keeps every label (overlaps allowed, the pointed-at one comes to the front – see
 * `stackSharedAddresses` in `components/map-view.tsx`). A phone cannot hover, and thirty white
 * address bubbles around one village are an unreadable heap on a 390px screen (owner, iPhone,
 * 02.10.2026). So on a phone or any coarse pointer:
 *
 * - below `PHONE_LABEL_MIN_ZOOM` there are NO permanent labels – the dots and their priority
 *   colours carry the map, and a tap on a dot shows its label / card (the selected marker);
 * - from that zoom on, labels come back, but only those that fit: a greedy pass in screen space
 *   keeps a label only if it overlaps neither an already kept label nor another incident's dot.
 *   High priority wins a contested spot, then whatever is higher up on the screen.
 *
 * The selected incident is never subject to any of this – its label is always drawn.
 */

/** From this zoom a phone draws permanent labels again (street level – a few blocks on screen). */
export const PHONE_LABEL_MIN_ZOOM = 16

export type LabelMode = 'all' | 'fit' | 'none'

/** The label rule for the current surface. `fit` = collision-checked (see `pickVisibleLabels`). */
export function labelMode({
  showLabels,
  compact,
  zoom,
}: {
  /** The «Beschriftungen» switch in the Ansicht menu. Off means off, on every device. */
  showLabels: boolean
  /** Phone width or coarse pointer – see `COMPACT_MAP_QUERY`. */
  compact: boolean
  zoom: number
}): LabelMode {
  if (!showLabels) return 'none'
  if (!compact) return 'all'
  return zoom >= PHONE_LABEL_MIN_ZOOM ? 'fit' : 'none'
}

/** Phone width (Tailwind `md` is 768px) or a finger instead of a mouse. */
export const COMPACT_MAP_QUERY = '(max-width: 767px), (pointer: coarse)'

export interface LabelCandidate {
  id: string
  /** Screen position of the incident's anchor (the dot's centre), px. */
  x: number
  y: number
  /** Vertical step of a label that shares its address with another, px. */
  dy: number
  /** Estimated bubble width, px. */
  width: number
  priority: string | null | undefined
}

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** Overlap with a small gap, so two bubbles never touch edge to edge. */
const GAP = 2

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right + GAP && b.left < a.right + GAP && a.top < b.bottom + GAP && b.top < a.bottom + GAP
}

/**
 * Greedy collision pass: returns the ids whose label may be drawn.
 *
 * `labelOffsetX` / `labelHeight` describe the bubble's geometry relative to its anchor (it hangs
 * to the right of the dot, vertically centred on it); `dotSize` is the incident dot, which no
 * label may cover – a label lying on somebody else's dot names the wrong incident.
 */
export function pickVisibleLabels(
  candidates: LabelCandidate[],
  {
    labelOffsetX,
    labelHeight,
    dotSize,
    viewport,
  }: {
    labelOffsetX: number
    labelHeight: number
    dotSize: number
    /** Only labels whose anchor is on screen take part – an off-screen one would still block. */
    viewport?: { width: number; height: number }
  },
): Set<string> {
  const onScreen = viewport
    ? candidates.filter((c) => c.x >= 0 && c.y >= 0 && c.x <= viewport.width && c.y <= viewport.height)
    : candidates
  const half = dotSize / 2
  const dots = onScreen.map((c) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    rect: { left: c.x - half, top: c.y - half, right: c.x + half, bottom: c.y + half },
  }))

  const ordered = [...onScreen].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority ?? ''] ?? 3
    const pb = PRIORITY_RANK[b.priority ?? ''] ?? 3
    if (pa !== pb) return pa - pb
    if (a.y + a.dy !== b.y + b.dy) return a.y + a.dy - (b.y + b.dy)
    return a.x - b.x
  })

  const kept: Rect[] = []
  const visible = new Set<string>()
  for (const c of ordered) {
    const top = c.y + c.dy - labelHeight / 2
    const rect: Rect = {
      left: c.x + labelOffsetX,
      top,
      right: c.x + labelOffsetX + c.width,
      bottom: top + labelHeight,
    }
    if (kept.some((other) => intersects(rect, other))) continue
    // Its own dot does not count – and neither does a dot at exactly the same spot, which is
    // the same address (those labels step down instead, see `stackSharedAddresses`).
    const coversADot = dots.some(
      (dot) =>
        dot.id !== c.id &&
        !(Math.abs(dot.x - c.x) < 0.5 && Math.abs(dot.y - c.y) < 0.5) &&
        intersects(rect, dot.rect),
    )
    if (coversADot) continue
    kept.push(rect)
    visible.add(c.id)
  }
  return visible
}

let measureContext: OffscreenCanvasRenderingContext2D | null | undefined

/**
 * Width of a short label bubble: 11px/600 address text, 6px padding each side, plus the crew
 * counters when there are any. Measured on a canvas when one exists; a per-character estimate
 * otherwise (tests, very old engines). An estimate that is a few px off only shifts where the
 * collision pass draws its line – it never hides the selected label.
 */
export function estimateLabelWidth(text: string, crewCounters: number): number {
  if (measureContext === undefined) {
    try {
      // OffscreenCanvas: every engine the board supports has it (Safari since 16.4), and jsdom
      // does not – so tests take the estimate instead of logging «not implemented».
      measureContext = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null
    } catch {
      measureContext = null
    }
  }
  let textWidth: number
  if (measureContext) {
    const family = typeof document !== 'undefined' ? getComputedStyle(document.body).fontFamily || 'sans-serif' : 'sans-serif'
    measureContext.font = `600 11px ${family}`
    textWidth = measureContext.measureText(text).width
  } else {
    textWidth = text.length * 6.4
  }
  // Each counter: 5px gap + 10px icon + 2px + ~7px digit.
  return Math.ceil(textWidth + 12 + 2 + crewCounters * 24)
}
