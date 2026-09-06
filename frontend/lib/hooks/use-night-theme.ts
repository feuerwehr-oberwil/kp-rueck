'use client'

/**
 * Reactive dark-mode flag for MapLibre paint specs. Adapted from KP Front
 * (`src/lib/useNightTheme.ts`), which watches `<html data-theme>`; here the theme lives on the
 * `dark` class next-themes writes onto `<html>`.
 *
 * Why this exists next to `useTheme()` from next-themes: a MapLibre paint spec is plain data
 * handed to the GL renderer, so it has to be recomputed by whoever declares the `<Layer>` – and
 * during hydration next-themes reports the theme as undefined for a frame, which would paint the
 * basemap in the wrong mode and then repaint. Reading the attribute the renderer already reflects
 * gives the map one answer, immediately.
 *
 * `components/map/base-map.tsx` reads it to pick between `DAY_BASE_PAINT` and `NIGHT_BASE_PAINT`
 * (`lib/map-view.ts`) for the raster basemap layer. The offline VECTOR style is the one surface
 * still dimmed by a CSS canvas filter – it brings its own layers, so there is nothing to paint.
 */

import { useEffect, useState } from 'react'

const isDark = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

export function useNightTheme(): boolean {
  const [night, setNight] = useState(isDark)

  useEffect(() => {
    const el = document.documentElement
    const observer = new MutationObserver(() => setNight(el.classList.contains('dark')))
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    // The class can already have changed between the initial state and this effect running.
    setNight(el.classList.contains('dark'))
    return () => observer.disconnect()
  }, [])

  return night
}
