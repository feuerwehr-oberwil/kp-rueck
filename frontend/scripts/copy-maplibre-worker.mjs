#!/usr/bin/env node
/**
 * Copies MapLibre's worker into `public/maplibre/`, so `/maplibre/maplibre-gl-worker.mjs` is a
 * real, same-origin file (runs before `dev` and `build`; the output is gitignored).
 *
 * Why: MapLibre 6 finds its worker next to its own bundle via `import.meta.url`. Webpack (Next)
 * bakes `import.meta.url` into a `file://` path at build time, MapLibre then gives up and spawns
 * `new Worker('')` – the page itself – which dies on the first line. Without a worker no GeoJSON
 * source ever loads (assignment lines, Aufträge routes, vehicle trails, offline vector tiles),
 * the map never fires `load`, and everything that waits for the live map (fit to the incidents,
 * pan to the selected one, «Alle Einsätze einpassen», the phone's street-level labels) stays
 * dead. `components/map/base-map.tsx` points `setWorkerUrl` at the copy.
 *
 * The worker is an ES module that imports `./maplibre-gl-shared.mjs`, so both files go together,
 * in the same directory.
 */
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const dist = dirname(require.resolve('maplibre-gl/package.json')) + '/dist'
const out = join(here, '..', 'public', 'maplibre')

mkdirSync(out, { recursive: true })
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(dist, file), join(out, file))
}
