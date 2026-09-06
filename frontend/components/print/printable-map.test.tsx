import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Operation } from "@/lib/contexts/operations-context"

const fixture = vi.hoisted(() => ({ onLoad: undefined as undefined | ((map: unknown) => void) }))
vi.mock("@/components/map/base-map", () => ({
  BaseMap: ({ onLoad }: { onLoad: (map: unknown) => void }) => {
    fixture.onLoad = onLoad
    return null
  },
}))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("@/lib/map-view", () => ({ fitTo: vi.fn() }))
import PrintableMap from "./printable-map"

const operation = {
  id: "synthetic", coordinates: [47, 8], priority: "medium", location: "Synthetic",
  incidentType: "elementarereignis", status: "incoming",
} as Operation

function mount() {
  const onReady = vi.fn()
  const onError = vi.fn()
  const onLoading = vi.fn()
  const result = render(<PrintableMap operations={[operation]} numbering={new Map()} onReady={onReady} onError={onError} onLoading={onLoading} />)
  let idle: (() => void) | undefined
  const map = {
    off: vi.fn(),
    on: vi.fn((event: string, callback: () => void) => { if (event === "idle") idle = callback }),
  }
  return { ...result, onReady, onError, onLoading, map, load: () => act(() => fixture.onLoad?.(map)), idle: () => act(() => idle?.()) }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe("print map readiness", () => {
  it("reports a stalled initial load after 20 seconds without allowing print", () => {
    const { onReady, onError } = mount()
    act(() => vi.advanceTimersByTime(19_999))
    expect(onError).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onError).toHaveBeenCalledOnce()
    expect(onReady).not.toHaveBeenCalled()
    expect(screen.getByTestId("printable-map")).toHaveAttribute("data-map-ready", "false")
  })

  it("allows a genuine idle event to recover after the deadline", () => {
    const view = mount()
    view.load()
    act(() => vi.advanceTimersByTime(20_000))
    expect(view.onError).toHaveBeenCalledOnce()
    expect(view.onReady).not.toHaveBeenCalled()
    view.idle()
    expect(view.onReady).toHaveBeenCalledOnce()
    expect(screen.getByTestId("printable-map")).toHaveAttribute("data-map-ready", "true")
  })

  it("cancels the deadline when the map becomes idle in time", () => {
    const view = mount()
    view.load()
    view.idle()
    act(() => vi.advanceTimersByTime(20_000))
    expect(view.onReady).toHaveBeenCalledOnce()
    expect(view.onError).not.toHaveBeenCalled()
  })

  it("holds print again when a recovered map instance loads", () => {
    const view = mount()
    view.load()
    view.idle()
    view.onReady.mockClear()
    view.load()
    expect(screen.getByTestId("printable-map")).toHaveAttribute("data-map-ready", "false")
    act(() => vi.advanceTimersByTime(20_000))
    expect(view.onError).toHaveBeenCalledOnce()
    expect(view.onReady).not.toHaveBeenCalled()
    view.idle()
    expect(view.onReady).toHaveBeenCalledOnce()
  })

  it("holds print again when the fitted incident coordinates change", () => {
    const view = mount()
    view.load()
    view.idle()
    view.onReady.mockClear()
    view.rerender(<PrintableMap operations={[{ ...operation, coordinates: [48, 9] }]} numbering={new Map()} onReady={view.onReady} onError={view.onError} onLoading={view.onLoading} />)
    expect(screen.getByTestId("printable-map")).toHaveAttribute("data-map-ready", "false")
    act(() => vi.advanceTimersByTime(20_000))
    expect(view.onError).toHaveBeenCalledOnce()
    expect(view.onReady).not.toHaveBeenCalled()
    view.idle()
    expect(view.onReady).toHaveBeenCalledOnce()
  })

  it("does not postpone the deadline for equivalent data from a poll", () => {
    const view = mount()
    view.load()
    act(() => vi.advanceTimersByTime(15_000))
    view.rerender(<PrintableMap operations={[{ ...operation }]} numbering={new Map()} onReady={view.onReady} onError={view.onError} onLoading={view.onLoading} />)
    act(() => vi.advanceTimersByTime(5_000))
    expect(view.onError).toHaveBeenCalledOnce()
    view.idle()
    view.onLoading.mockClear()
    view.rerender(<PrintableMap operations={[{ ...operation }]} numbering={new Map()} onReady={view.onReady} onError={view.onError} onLoading={view.onLoading} />)
    expect(view.onLoading).not.toHaveBeenCalled()
    expect(screen.getByTestId("printable-map")).toHaveAttribute("data-map-ready", "true")
  })

  it("removes map listeners and its deadline when unmounted", () => {
    const view = mount()
    view.load()
    view.unmount()
    act(() => vi.advanceTimersByTime(20_000))
    expect(view.map.off).toHaveBeenCalledWith("resize", expect.any(Function))
    expect(view.map.off).toHaveBeenCalledWith("idle", expect.any(Function))
    expect(view.onError).not.toHaveBeenCalled()
  })
})
