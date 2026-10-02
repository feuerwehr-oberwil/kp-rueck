/**
 * MapLibre's worker must come from a real file (see `scripts/copy-maplibre-worker.mjs`).
 *
 * Without `setWorkerUrl` MapLibre 6 under webpack spawns the PAGE as its worker: no GeoJSON
 * source loads, the map never fires `load`, and every overlay and «fit/pan» feature is dead
 * while the basemap still looks fine – nothing on screen says so. These tests pin both halves.
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { describe, expect, it, vi } from "vitest"

const setWorkerUrl = vi.hoisted(() => vi.fn())
vi.mock("maplibre-gl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("maplibre-gl")>()),
  setWorkerUrl,
}))

describe("MapLibre worker", () => {
  it("is pointed at the same-origin copy before any map exists", async () => {
    const { MAPLIBRE_WORKER_URL } = await import("@/lib/map-view")
    await import("./base-map")
    expect(setWorkerUrl).toHaveBeenCalledWith(MAPLIBRE_WORKER_URL)
    expect(MAPLIBRE_WORKER_URL).toBe("/maplibre/maplibre-gl-worker.mjs")
  })

  it("still needs exactly the two files the copy script ships", () => {
    // A MapLibre upgrade that renames or splits the worker would leave the copy incomplete.
    const dist = join(dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist")
    const worker = readFileSync(join(dist, "maplibre-gl-worker.mjs"), "utf8")
    const imports = [...worker.matchAll(/from\s*"(\.[^"]+)"/g)].map((match) => match[1])
    expect(new Set(imports)).toEqual(new Set(["./maplibre-gl-shared.mjs"]))
    const script = readFileSync(join(__dirname, "..", "..", "scripts", "copy-maplibre-worker.mjs"), "utf8")
    expect(script).toContain("'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'")
  })
})
