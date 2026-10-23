'use client'

import { useCallback, useInsertionEffect, useRef } from 'react'

/**
 * React's `useEffectEvent`, for the React that Next 15 runs the app on.
 *
 * `react` 19.3 in package.json exports it, but the App Router renders with the React that Next
 * vendors (`next/dist/compiled/react` – a 19.2 canary in Next 15.5, from before the stable
 * export), which does not: importing it from 'react' passes tsc and Vitest and crashes the
 * page («useEffectEvent is not a function»). eslint.config.mjs forbids that import; once Next
 * vendors a React that exports it (Next 16), delete this file and import it from 'react'.
 *
 * Same contract as React's: call the returned function from effects (or from callbacks an
 * effect set up) and it runs the LATEST `fn`; it is never a dependency, and never called
 * during render or handed to another component. The lint rules know it by its name.
 *
 *   const loadOnMount = useEffectEvent(() => void reload())
 *   useEffect(() => { loadOnMount() }, [])
 */
export function useEffectEvent<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  const latest = useRef(fn)
  // Insertion effects run before any layout or passive effect of the same commit, so an
  // effect (or a cleanup) always reaches the function of the render it belongs to.
  useInsertionEffect(() => {
    latest.current = fn
  })
  return useCallback((...args: Args) => latest.current(...args), [])
}
