/**
 * The pure parts of a Reko Chronik row (`reko_change`, owner pick 23.11.2026 #6): what moved
 * in a list, and the two ends of a long text cut to what changed.
 *
 * `components/kanban/incident-timeline.tsx` words them in the operator's language. The backend
 * sends raw values (`backend/app/services/reko_history.py`), coalesced per author and field.
 */

import type { RekoChangeValue } from '@/lib/api/types'

/** A value as a list of strings (Gefahren keys, photo files, vehicles) – anything else is empty. */
export function asList(value: RekoChangeValue): string[] {
  return Array.isArray(value) ? value : []
}

/** What a list change added and removed, in the order of the new and the old list. */
export function listDiff(from: RekoChangeValue, to: RekoChangeValue): { added: string[]; removed: string[] } {
  const before = asList(from)
  const after = asList(to)
  return {
    added: after.filter(item => !before.includes(item)),
    removed: before.filter(item => !after.includes(item)),
  }
}

/** How long one end of a text change may be before it is cut. */
export const EXCERPT_CHARS = 60

/** Below this, a shared start is shown in full: cutting it would save nothing. */
const SHARED_START_MIN = 24

/**
 * The two ends of a text change, each at most `max` characters: a long shared start is cut
 * to «…» at a word boundary so the eye lands on what changed («… steckt fest.» → «… steckt
 * fest, Lenker ausgestiegen.»), and a long end gets «…». Null stays null (an empty field).
 */
export function textExcerpts(
  from: string | null,
  to: string | null,
  max = EXCERPT_CHARS,
): { from: string | null; to: string | null } {
  let start = 0
  if (from && to) {
    let shared = 0
    while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++
    if (shared >= SHARED_START_MIN) {
      // Back to the last word boundary inside the shared part, keeping a few words of context.
      const boundary = from.lastIndexOf(' ', Math.max(0, shared - 12))
      start = boundary > 0 ? boundary + 1 : 0
    }
  }
  const cut = (text: string | null): string | null => {
    if (text === null) return null
    const tail = start > 0 ? `… ${text.slice(start)}` : text
    return tail.length > max ? `${tail.slice(0, max - 1).trimEnd()}…` : tail
  }
  return { from: cut(from), to: cut(to) }
}
