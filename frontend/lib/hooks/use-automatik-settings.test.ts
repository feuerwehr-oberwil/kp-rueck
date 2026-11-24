import { describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

const api = vi.hoisted(() => ({ getAllSettings: vi.fn(), updateSetting: vi.fn() }))
vi.mock("@/lib/api-client", () => ({ apiClient: api }))

import { useAutomatikSettings } from "./use-automatik-settings"

describe("useAutomatikSettings", () => {
  it("reads interval and max once, and writes a clamped value", async () => {
    api.getAllSettings.mockResolvedValue({ training_autogen_interval_min: "3", training_autogen_max_emergencies: "20" })
    api.updateSetting.mockResolvedValue({})
    const { result, rerender } = renderHook(() => useAutomatikSettings(true))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.settings).toEqual({ intervalMin: 3, max: 20 })
    rerender()
    expect(api.getAllSettings).toHaveBeenCalledTimes(1)

    let saved = false
    await act(async () => {
      saved = await result.current.save("max", 500)
    })
    expect(saved).toBe(true)
    expect(api.updateSetting).toHaveBeenCalledWith("training_autogen_max_emergencies", "200")
    expect(result.current.settings.max).toBe(200)
  })

  it("keeps the defaults when the settings cannot be read", async () => {
    api.getAllSettings.mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() => useAutomatikSettings(true))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.settings).toEqual({ intervalMin: 5, max: 50 })
  })
})
