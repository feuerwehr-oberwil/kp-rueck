/**
 * Where «open this Einsatz» goes — one answer for every entry point.
 *
 * There are two standard detail surfaces, one per device, and nothing else:
 * - **phone** (`useIsMobile`, <768px — the same switch that gives the board its phone list): the
 *   phone Einsatz sheet, `MobileIncidentDetailSheet`, opened right where the operator is;
 * - **desktop**: the board's detail side panel, reached through `/?highlight=<id>&detail=1`
 *   (the board reads that link — notifications use it too).
 *
 * The Lagekarte used to send both devices down the board link. On a phone that link lands on the
 * board's narrow-viewport fallback — the desktop `OperationDetailModal` squeezed into a centred
 * box — and takes the operator off the map (owner, 03.10.2026: «this strange mobile modal rather
 * than the native one»).
 */

export type IncidentDetailTarget =
  | { kind: 'phone-sheet'; incidentId: string }
  | { kind: 'board'; href: string }

/** The board's «highlight + open» link. */
export function boardDetailHref(incidentId: string, tab?: string): string {
  return `/?highlight=${encodeURIComponent(incidentId)}&detail=1${tab ? `&tab=${encodeURIComponent(tab)}` : ''}`
}

export function incidentDetailTarget(incidentId: string, { phone }: { phone: boolean }): IncidentDetailTarget {
  return phone ? { kind: 'phone-sheet', incidentId } : { kind: 'board', href: boardDetailHref(incidentId) }
}

/** `useIsMobile`'s switch (components/ui/use-mobile.ts), read NOW. The hook is `false` on the
 *  first render, which is exactly when a `?detail=1` link is acted on — asking the hook there
 *  sent a phone to the desktop modal. */
export const PHONE_MAX_WIDTH = 767
export function isPhoneViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= PHONE_MAX_WIDTH
}

/** Where the BOARD shows a detail it was asked to open. */
export type BoardDetailSurface = 'phone-sheet' | 'side-panel' | 'modal' | 'none'

/**
 * The board's half of the same rule. Everything that asks the board to open an Einsatz — a
 * notification toast or bell entry, the `?detail=1` link, a highlight request — ends here.
 *
 * - phone: the phone Einsatz sheet of the board's phone list (it used to be the desktop modal in
 *   a centred box: the same «strange mobile modal» as the Lagekarte's, owner 03.10.);
 * - wide desktop (≥ SIDE_PANEL_BREAKPOINT): the side panel;
 * - narrower desktop: the modal.
 * `allowModal: false` (a sidebar binding, whose answer is the ring on the card) opens nothing on
 * a narrow screen — phone included — just as before.
 */
export function boardDetailSurface({
  phone,
  wide,
  allowModal,
}: {
  phone: boolean
  wide: boolean
  allowModal: boolean
}): BoardDetailSurface {
  if (wide) return 'side-panel'
  if (!allowModal) return 'none'
  return phone ? 'phone-sheet' : 'modal'
}
