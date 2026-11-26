/**
 * The in-tab command bus: window events between parts that share no React tree (a board
 * chip opens the Aufträge sheet, the transport says the session expired). One map holds
 * every name and its payload, so a renamed event or a changed payload is a tsc error at
 * both ends instead of a sheet that silently stays shut.
 *
 *   emitAppEvent('kp:open-auftraege', { groupId })
 *   useEffect(() => onAppEvent('kp:open-auftraege', ({ groupId }) => …), [])
 */
import type { IncidentHighlightOptions } from './notification-highlight'

export interface AppEvents {
  /** A cookie-authenticated request answered 401 (`lib/api/http.ts` → auth context). */
  'kp:session-expired': void
  /** Open the Aufträge sheet on this route (board chips → `app/page.tsx`). */
  'kp:open-auftraege': { groupId: string }
  /** Open the Auftrags-Editor on this route, optionally with one stop focused. */
  'kp:open-routen-editor': { groupId: string; focusIncidentId?: string }
  /** Scroll to this card, ring it and open its detail (`lib/notification-highlight.ts`). */
  'kp:incident-highlight': IncidentHighlightOptions & { incidentId: string }
  'kp:open-command-palette': void
  'kp:toggle-figures': void
  /** A planned assignment was written from this tab (`lib/planned-actions.ts`). */
  'kp:planned-changed': void
  /** The device setting «Lageblatt automatisch herunterladen» changed (`lib/lageblatt.ts`). */
  'kp-lageblatt-autodownload-changed': void
  /** A vehicle's driver changed from this tab (`lib/hooks/use-vehicle-drivers.ts` reloads). */
  'driver-assignment-changed': void
}

type Detail<K extends keyof AppEvents> = AppEvents[K] extends void ? [] : [detail: AppEvents[K]]

/** Send `name` to every listener in this tab. A no-op outside the browser. */
export function emitAppEvent<K extends keyof AppEvents>(name: K, ...detail: Detail<K>): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name, { detail: detail[0] }))
}

/** Listen for `name`; returns the unsubscribe (an effect's cleanup). */
export function onAppEvent<K extends keyof AppEvents>(name: K, listener: (detail: AppEvents[K]) => void): () => void {
  // Only `emitAppEvent` sends these names, so the detail is the map's.
  const handler = (event: Event) => listener((event as CustomEvent<AppEvents[K]>).detail)
  window.addEventListener(name, handler)
  return () => window.removeEventListener(name, handler)
}
