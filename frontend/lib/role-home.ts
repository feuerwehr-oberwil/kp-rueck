import type { User } from '@/lib/auth-client'

/**
 * Where each role's app lives – read by `ProtectedRoute` (the role gate) and by the login's
 * landing (`app/login`, `app/auth/callback`).
 *
 * Editors and admins: the whole app, starting on the board. A viewer (the read-only role):
 *
 * - on a phone (below `md`), the same phone shell as an editor – the board's phone list, the
 *   Lagekarte and «Alle Ereignisse» (owner pick 4A, phone sweep 24.11.2026). The phone shell is
 *   read-only for every role (owner, 14.11.2026); what an editor may still write there (intake,
 *   Übungs-Steuerung, Appell, Links & QR, Fahrzeuge, Drucken) is gated on `isEditor`.
 * - anywhere wider, the wall board (`/display/board`): a viewer account is a TV, a kiosk or a
 *   tablet at the station, and the desk board's controls are not gated for it.
 *
 * Not the security boundary: the backend refuses every write to a viewer (`CurrentEditor`).
 */

/** The pages a viewer may open on a phone. Every other page sends it home. */
const VIEWER_PHONE_PAGES: ReadonlySet<string> = new Set(['/', '/map', '/events'])

/** The wall board: a viewer's home on anything wider than a phone. */
export const VIEWER_WALL_HOME = '/display/board'

type Role = User['role']

/** Where `role` starts after a login, on a phone or not. */
export function homeFor(role: Role, phone: boolean): string {
  return role === 'viewer' && !phone ? VIEWER_WALL_HOME : '/'
}

/** May `role` open `pathname` (an interactive page behind `ProtectedRoute`)? */
export function mayOpen(role: Role, pathname: string, phone: boolean): boolean {
  return role !== 'viewer' || (phone && VIEWER_PHONE_PAGES.has(pathname))
}
