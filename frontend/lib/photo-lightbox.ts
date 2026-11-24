/**
 * The pure rules of the photo viewer (owner pick 23.11.2026, #5 → 5A + phone form):
 * which photo a key or a swipe goes to, and how the photos of an incident line up.
 *
 * `components/photos/photo-viewer.tsx` draws it. Kept apart so the keyboard and the finger
 * rules are tested without a DOM.
 */

/** Where a photo came from – the viewer shows the Reko photos first, then the Rapport's. */
export type PhotoGroup = 'reko' | 'rapport'

export const PHOTO_GROUPS: readonly PhotoGroup[] = ['reko', 'rapport']

/** One photo the viewer can show. `by`/`at` are the report's author and time, when known. */
export interface ViewerPhoto {
  group: PhotoGroup
  filename: string
  src: string
  by: string | null
  at: string | null
}

/**
 * The URL the viewer loads a photo from: the thumbnail's, plus `view=full`. The photo route
 * answers that one `no-store`, so every open reaches the server and logs a `view_photo`
 * (Sol review G, S8); the thumbnail stays cacheable. A share-token URL keeps its token.
 */
export function fullViewSrc(src: string): string {
  return `${src}${src.includes('?') ? '&' : '?'}view=full`
}

export type LightboxAction = 'prev' | 'next' | 'first' | 'last' | 'close'

/** What a key does in the open viewer; null leaves the key to the page. */
export function lightboxKeyAction(key: string): LightboxAction | null {
  switch (key) {
    case 'ArrowLeft': return 'prev'
    case 'ArrowRight': return 'next'
    case 'Home': return 'first'
    case 'End': return 'last'
    case 'Escape': return 'close'
    default: return null
  }
}

/** The index an action leads to: the ends stop (no wrap – «5 / 5» → next stays on 5). */
export function stepIndex(index: number, action: Exclude<LightboxAction, 'close'>, count: number): number {
  if (count <= 0) return 0
  switch (action) {
    case 'prev': return Math.max(0, index - 1)
    case 'next': return Math.min(count - 1, index + 1)
    case 'first': return 0
    case 'last': return count - 1
  }
}

/** How far a finger must travel, as a share of the screen, before a drag counts on release. */
export const SWIPE_DISTANCE = 0.2
/** px/ms: a flick this fast counts however short it was. */
export const SWIPE_VELOCITY = 0.5
/** px down before a vertical pull closes the viewer. */
export const PULL_CLOSE_PX = 120

/**
 * What a finger that let go means: the next or previous photo (a horizontal drag past
 * `SWIPE_DISTANCE` of the width, or a flick), close (a pull down past `PULL_CLOSE_PX`, or
 * a downward flick), or nothing – the photo springs back.
 *
 * `dx`/`dy` are the travel since the finger went down, `vx`/`vy` the release speed in px/ms.
 * The axis is the one the finger moved along more.
 */
export function releaseIntent(
  { dx, dy, vx, vy }: { dx: number; dy: number; vx: number; vy: number },
  width: number,
): 'prev' | 'next' | 'close' | 'none' {
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy > PULL_CLOSE_PX || (dy > 0 && vy > SWIPE_VELOCITY) ? 'close' : 'none'
  }
  const far = Math.abs(dx) > width * SWIPE_DISTANCE
  const fast = Math.abs(vx) > SWIPE_VELOCITY
  if (!far && !fast) return 'none'
  return dx < 0 ? 'next' : 'prev'
}

/**
 * The viewer's line-up: Reko photos, then Rapport photos, each group in its report's order.
 * A filename listed twice in a group shows once.
 */
export function lineUp(groups: Partial<Record<PhotoGroup, ViewerPhoto[]>>): ViewerPhoto[] {
  return PHOTO_GROUPS.flatMap(group => {
    const seen = new Set<string>()
    return (groups[group] ?? []).filter(photo => !seen.has(photo.filename) && seen.add(photo.filename))
  })
}

/** The photos of the line-up per group, with their index in it – the grouped thumbnail strip. */
export function groupRuns(photos: readonly ViewerPhoto[]): { group: PhotoGroup; items: { photo: ViewerPhoto; index: number }[] }[] {
  return PHOTO_GROUPS.map(group => ({
    group,
    items: photos.flatMap((photo, index) => (photo.group === group ? [{ photo, index }] : [])),
  })).filter(run => run.items.length > 0)
}
