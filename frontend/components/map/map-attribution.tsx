'use client'

/**
 * Compact map attribution. Copied from KP Front (`src/components/MapAttribution.tsx`).
 *
 * Attribution stays a closed ⓘ until the operator clicks it, on every map surface. MapLibre's
 * stock control force-expands: on maps ≤640px (and on first becoming compact) `_updateCompact`
 * adds `maplibregl-compact-show`, and on wider maps it renders the always-open text bar – which on
 * a dense board eats the bottom-right corner the operator needs. This subclass pins compact mode
 * at every width and only ever ensures the compact class; the ⓘ toggle (`_toggleAttribution`)
 * still opens and closes it on demand.
 *
 * Used with `attributionControl={false}` on the `<Map>` – see `base-map.tsx`.
 */

import { useControl } from 'react-map-gl/maplibre'
import { AttributionControl } from 'maplibre-gl'

class QuietAttribution extends AttributionControl {
  constructor() {
    super({ compact: true })
  }

  override _updateCompact = () => {
    this._container.setAttribute('open', '')
    if (!this._container.classList.contains('maplibregl-compact')) {
      this._container.classList.add('maplibregl-compact')
    }
  }
}

export function MapAttribution() {
  useControl(() => new QuietAttribution(), { position: 'bottom-right' })
  return null
}
