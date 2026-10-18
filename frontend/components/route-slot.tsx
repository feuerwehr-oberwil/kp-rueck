'use client'

import type { ReactNode } from 'react'

/**
 * Where a layout puts the route's `children`: one function component between the host element
 * (`<main>`) and the slot. Renders nothing of its own – no DOM, the same HTML on both sides.
 *
 * Why it exists (React error #418 on a cold load of `/` and `/map`, 18.10.2026): the `children`
 * a layout receives arrives in the RSC stream as a lazy reference that stays pending until the
 * route's `error.tsx` chunk has loaded. When the browser's (cached) JS starts hydrating before
 * that, rendering `<main>{children}</main>` suspends INSIDE `<main>`. The React that Next 15.5
 * ships (19.2 canary) then replays `<main>` from a hydration cursor already moved into it, so it
 * compares `<main>` with main's own first child (`<!--$-->`), throws #418 and re-renders the
 * whole root on the client. A function component in between is replayed instead, and a
 * function component claims no DOM. React fixed the replay later (the build in Next 16 resets
 * the cursor); until this app is on it, a route slot must never sit directly in a host element.
 */
export function RouteSlot({ children }: { children: ReactNode }) {
  return children
}
