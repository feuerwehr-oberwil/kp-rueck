/**
 * How the map resolves its basemap when nobody can tell it what the station prefers.
 *
 * The settings endpoint is authenticated, so on a token-gated wall display it can only ever
 * answer 401 – and that used to arrive as a console warning plus a "Sitzung abgelaufen" event on
 * a screen that never had a session. The hook must ask plainly, take silence for an answer, and
 * on a share-token page not ask at all.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

import { setRuntimeCartoApiKey } from "@/lib/env"
import { useMapMode } from "./use-map-mode"

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  window.history.replaceState({}, "", "/map")
})

afterEach(() => {
  vi.unstubAllGlobals()
  setRuntimeCartoApiKey(null)
})

const settings = (body: Record<string, string>) => ({
  ok: true,
  json: async () => body,
})

describe("useMapMode", () => {
  it("uses the station's selected online style", async () => {
    setRuntimeCartoApiKey("carto-test-key")
    fetchMock.mockResolvedValue(settings({ map_mode: "auto", map_style: "carto-light" }))
    const { result } = renderHook(() => useMapMode())

    await waitFor(() =>
      expect(result.current.getOnlineRasterBasemap().tiles[0]).toContain("rastertiles/voyager"),
    )
    expect(result.current.getOnlineRasterBasemap().tiles).toHaveLength(4)
    expect(result.current.getOnlineRasterBasemap().tiles[0]).toContain("?key=carto-test-key")
    expect(result.current.isOnline).toBe(true)
  })

  it("URL-encodes the CARTO key and does not attach it to another provider", async () => {
    setRuntimeCartoApiKey("test key/+?")
    fetchMock.mockResolvedValue(settings({ map_style: "carto-dark" }))
    const { result } = renderHook(() => useMapMode())

    await waitFor(() =>
      expect(result.current.getOnlineRasterBasemap().tiles[0]).toContain(
        "?key=test%20key%2F%2B%3F",
      ),
    )

    fetchMock.mockResolvedValue(settings({ map_style: "osm" }))
    const osm = renderHook(() => useMapMode())
    await waitFor(() => expect(osm.result.current.getOnlineRasterBasemap().tiles[0]).toContain("openstreetmap"))
    expect(osm.result.current.getOnlineRasterBasemap().tiles[0]).not.toContain("key=")
  })

  it("marks «Dunkel (CARTO)» as an already-dark raster, so the map lifts it instead of muting it", async () => {
    fetchMock.mockResolvedValue(settings({ map_style: "carto-dark" }))
    const { result } = renderHook(() => useMapMode())

    await waitFor(() => expect(result.current.getOnlineRasterBasemap().dark).toBe(true))
  })

  it("does not mark the light styles dark", async () => {
    fetchMock.mockResolvedValue(settings({ map_style: "osm" }))
    const { result } = renderHook(() => useMapMode())

    await waitFor(() => expect(result.current.getOnlineRasterBasemap().tiles[0]).toContain("openstreetmap"))
    expect(result.current.getOnlineRasterBasemap().dark).toBe(false)
  })

  it("never asks for settings on a share-token page – there they can only 401", async () => {
    window.history.replaceState({}, "", "/display/map?token=abc")
    const { result } = renderHook(() => useMapMode())

    await waitFor(() => expect(result.current.isOnline).toBe(true))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("falls back to auto/online when the settings cannot be read", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const { result } = renderHook(() => useMapMode())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current.isOnline).toBe(true)
    // …and `auto` still means the tile-error fallback is armed, which is what saves an offline
    // station: the tile probe needs no auth, the settings endpoint does.
    result.current.handleTileError()
    await waitFor(() => expect(result.current.isOnline).toBe(false))
  })

  it("survives a settings request that rejects outright", async () => {
    fetchMock.mockRejectedValue(new Error("network down"))
    const { result } = renderHook(() => useMapMode())

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current.isOnline).toBe(true)
  })
})
