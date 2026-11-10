/**
 * Which incident labels the Lagekarte draws permanently, and on which side of the pin.
 *
 * One label per pin: incidents at one address share a pin and its label (`lib/map-spots.ts`), and
 * pins merged into an overlap bubble below street level have none (`lib/map-clusters.ts`).
 *
 * Desktop keeps every label, the pointed-at one in front. A label hangs to the right of its pin; one that would lie on another
 * label or another incident's dot there flips to the LEFT when that side is free – no leader lines
 * that swing as you zoom (owner pick U2 C, 08.11.2026). Neither side free: it stays right and may
 * overlap, as before (`placeLabelSides`). A phone cannot hover, and thirty
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
  /** The pin's id – a spot key (`lib/map-spots.ts`). */
  id: string
  /** Screen position of the pin's anchor (the dot's centre), px. */
  x: number
  y: number
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

/** Every on-screen anchor, as the dot no label may cover – plus the count bubbles and vehicle pills. */
function onScreenDots({ candidates, dotSize, viewport, obstacles = [] }: LabelGeometry & { candidates: LabelCandidate[] }) {
  const inside = (p: { x: number; y: number }) =>
    !viewport || (p.x >= 0 && p.y >= 0 && p.x <= viewport.width && p.y <= viewport.height)
  const onScreen = candidates.filter(inside)
  const box = (id: string, x: number, y: number, width: number, height: number) => ({
    id,
    rect: { left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2 },
  })
  const dots = [
    ...onScreen.map((c) => box(c.id, c.x, c.y, dotSize, dotSize)),
    // A bubble or a vehicle pill is nobody's own dot: no candidate's id, so it blocks every label.
    ...obstacles.filter(inside).map((o) => box('', o.x, o.y, o.width, o.height)),
  ]
  return { onScreen, dots }
}

/** High priority first, then top to bottom, then left to right: who gets a contested spot. */
function byClaim(a: LabelCandidate, b: LabelCandidate): number {
  const pa = PRIORITY_RANK[a.priority ?? ''] ?? 3
  const pb = PRIORITY_RANK[b.priority ?? ''] ?? 3
  if (pa !== pb) return pa - pb
  if (a.y !== b.y) return a.y - b.y
  return a.x - b.x
}

interface LabelGeometry {
  /** Anchor → the bubble's near edge, px (the pin's half width + the arrow). */
  labelOffsetX: number
  labelHeight: number
  /** The incident dot, which no label may cover – a label on somebody else's dot names the
   *  wrong incident. */
  dotSize: number
  /** Only anchors on screen take part (an off-screen one would still block), and a label that
   *  would hang off the map's edge does not fit there. */
  viewport?: Viewport
  /** Other marks no label may cover, centre + box px: the overlap bubbles (`lib/map-clusters.ts`),
   *  which have no label of their own, and the vehicle pills where they finally stand
   *  (`lib/map-vehicles.ts`) – a label flips away from a pill rather than hiding it. */
  obstacles?: { x: number; y: number; width: number; height: number }[]
}

interface Viewport {
  width: number
  height: number
}

/** The bubble's box on one side of its anchor. */
function labelRect(c: LabelCandidate, side: LabelSide, { labelOffsetX, labelHeight }: LabelGeometry): Rect {
  const top = c.y - labelHeight / 2
  const left = side === 'right' ? c.x + labelOffsetX : c.x - labelOffsetX - c.width
  return { left, top, right: left + c.width, bottom: top + labelHeight }
}

function offViewport(rect: Rect, viewport?: Viewport): boolean {
  return !!viewport && (rect.left < 0 || rect.right > viewport.width || rect.top < 0 || rect.bottom > viewport.height)
}

/** Does `rect` touch a kept label or a dot other than the candidate's own? */
function collides(rect: Rect, c: LabelCandidate, kept: Rect[], dots: ReturnType<typeof onScreenDots>['dots']): boolean {
  if (kept.some((other) => intersects(rect, other))) return true
  return dots.some((dot) => dot.id !== c.id && intersects(rect, dot.rect))
}

/**
 * Greedy collision pass (phone, label mode `fit`): returns the ids whose label may be drawn. The
 * bubble hangs to the right of the dot, vertically centred on it; a label that does not fit there
 * is left out (a tap still shows it).
 */
export function pickVisibleLabels(candidates: LabelCandidate[], geometry: LabelGeometry): Set<string> {
  const { onScreen, dots } = onScreenDots({ ...geometry, candidates })
  const kept: Rect[] = []
  const visible = new Set<string>()
  for (const c of [...onScreen].sort(byClaim)) {
    const rect = labelRect(c, 'right', geometry)
    // A label hanging off the map's edge is clipped to a stub – it names nothing. Its dot still
    // counts as an obstacle for the others.
    if (offViewport(rect, geometry.viewport)) continue
    if (collides(rect, c, kept, dots)) continue
    kept.push(rect)
    visible.add(c.id)
  }
  return visible
}

export type LabelSide = 'right' | 'left'

/**
 * Desktop (label mode `all`): which side of its pin each label hangs on. Same greedy order as the
 * phone pass – Hoch first, then top to bottom – but nothing is dropped: a label whose right side
 * is taken (another label, another incident's dot, the map's edge) flips left when the left side
 * is free, and otherwise stays right. Returns only the ids that flip.
 */
export function placeLabelSides(candidates: LabelCandidate[], geometry: LabelGeometry): Set<string> {
  const { onScreen, dots } = onScreenDots({ ...geometry, candidates })
  const kept: Rect[] = []
  const left = new Set<string>()
  for (const c of [...onScreen].sort(byClaim)) {
    const right = labelRect(c, 'right', geometry)
    if (!offViewport(right, geometry.viewport) && !collides(right, c, kept, dots)) {
      kept.push(right)
      continue
    }
    const flipped = labelRect(c, 'left', geometry)
    if (!offViewport(flipped, geometry.viewport) && !collides(flipped, c, kept, dots)) {
      kept.push(flipped)
      left.add(c.id)
    } else {
      kept.push(right)
    }
  }
  return left
}

let measureContext: OffscreenCanvasRenderingContext2D | null | undefined

/** The canvas the widths are measured on – null where there is none (tests, very old engines). */
function measurer(): OffscreenCanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    try {
      // OffscreenCanvas: every engine the board supports has it (Safari since 16.4), and jsdom
      // does not – so tests take the estimate instead of logging «not implemented».
      measureContext = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null
    } catch {
      measureContext = null
    }
  }
  return measureContext
}

/**
 * Width of one line of map text in px: Sora (`font-sans`) or, with `mono`, Spline Sans Mono, at
 * the given weight and size. Measured on a canvas when one exists; a per-character estimate
 * otherwise. Used for the label bubbles here and the vehicle pills (`lib/map-vehicles.ts`).
 */
export function measureTextWidth(text: string, { weight, size, mono = false }: { weight: number; size: number; mono?: boolean }): number {
  const context = measurer()
  if (!context) return text.length * size * 0.6
  let family = mono ? 'monospace' : 'sans-serif'
  if (typeof document !== 'undefined') {
    family = mono
      ? // next/font's own variable: `--font-mono` itself is a `var(…)` chain a canvas cannot read.
        getComputedStyle(document.body).getPropertyValue('--font-spline-sans-mono').trim() || family
      : getComputedStyle(document.body).fontFamily || family
  }
  context.font = `${weight} ${size}px ${family}`
  return context.measureText(text).width
}

/**
 * Width of a short label bubble: 12px/600 address text (the 11px mono number is measured with
 * it – a px or two wide), 6px padding + 1px border each side, plus the crew counters when there
 * are any. An estimate that is a few px off only shifts where the collision pass draws its line –
 * it never hides the selected label.
 */
export function estimateLabelWidth(text: string, crewCounters: number): number {
  const textWidth = measurer() ? measureTextWidth(text, { weight: 600, size: 12 }) : text.length * 7
  // Each counter: 6px gap + 12px icon + 3px + ~7px digit (the label in components/map-view.tsx).
  return Math.ceil(textWidth + 12 + 2 + crewCounters * 28)
}
