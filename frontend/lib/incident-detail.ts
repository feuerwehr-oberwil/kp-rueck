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
