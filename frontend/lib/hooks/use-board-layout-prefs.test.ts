import { afterEach, describe, expect, it } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { useBoardLayoutPrefs } from "./use-board-layout-prefs"

afterEach(() => window.localStorage.clear())

describe("useBoardLayoutPrefs", () => {
  it("starts open with the panel collapsed, and remembers a fold", async () => {
    const { result } = renderHook(() => useBoardLayoutPrefs(false))
    expect(result.current.showLeftSidebar).toBe(true)
    expect(result.current.showRightSidebar).toBe(true)
    expect(result.current.sidePanelMode).toBe("collapsed")

    act(() => {
      result.current.setShowLeftSidebar(false)
      result.current.setSidePanelMode("detail")
    })
    await waitFor(() => expect(window.localStorage.getItem("kp-board-leftSidebarOpen")).toBe("false"))
    expect(window.localStorage.getItem("kp-board-sidePanelMode")).toBe('"detail"')
  })

  it("restores what this device stored, and ignores what is not a valid value", async () => {
    window.localStorage.setItem("kp-board-leftSidebarOpen", "false")
    window.localStorage.setItem("kp-board-rightSidebarOpen", '"yes"')
    window.localStorage.setItem("kp-board-sidePanelMode", '"detail"')
    const { result } = renderHook(() => useBoardLayoutPrefs(false))
    await waitFor(() => expect(result.current.showLeftSidebar).toBe(false))
    expect(result.current.showRightSidebar).toBe(true)
    expect(result.current.sidePanelMode).toBe("detail")
  })

  it("a phone never gets a remembered open sidebar", async () => {
    window.localStorage.setItem("kp-board-leftSidebarOpen", "true")
    window.localStorage.setItem("kp-board-rightSidebarOpen", "true")
    const { result } = renderHook(() => useBoardLayoutPrefs(true))
    await waitFor(() => {
      expect(result.current.showLeftSidebar).toBe(false)
      expect(result.current.showRightSidebar).toBe(false)
    })
  })
})
