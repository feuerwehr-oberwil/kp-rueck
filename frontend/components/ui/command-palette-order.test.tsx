import { act, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CommandPaletteHandlers } from "@/lib/contexts/command-palette-context"
import { renderWithIntl } from "@/test-utils/render-with-intl"

// ↵ runs the best match, not the first group that matches at all. cmdk ranks
// items inside a group but its group ranking never fires (it looks groups up by
// an id they don't carry), so «neu» used to open «Einstellungen» (Navigation is
// the first group, and n…e…u is in it) instead of «Neuer Einsatz».

let handlers: CommandPaletteHandlers = {}
const push = vi.fn()

vi.mock("@/lib/contexts/command-palette-context", () => ({
  useCommandPaletteHandlers: () => handlers,
}))
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ groups: [] }),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

import { CommandPalette, openCommandPalette } from "./command-palette"

async function typeAndEnter(text: string) {
  const user = userEvent.setup()
  renderWithIntl(<CommandPalette />)
  act(() => openCommandPalette())
  const input = await screen.findByRole("combobox")
  await user.type(input, text)
  await user.keyboard("{Enter}")
}

describe("CommandPalette ↵ order", () => {
  beforeEach(() => {
    push.mockReset()
    handlers = {
      onNewOperation: vi.fn(),
      onRefresh: vi.fn(),
      onToggleVehicleStatus: vi.fn(),
      onToggleLeftSidebar: vi.fn(),
      onToggleRightSidebar: vi.fn(),
      onToggleNotifications: vi.fn(),
    }
  })

  it("«neu» runs «Neuer Einsatz», not «Einstellungen»", async () => {
    await typeAndEnter("neu")
    expect(handlers.onNewOperation).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it("«einst» opens «Einstellungen», not «Neuer Einsatz»", async () => {
    await typeAndEnter("einst")
    expect(push).toHaveBeenCalledWith("/settings")
    expect(handlers.onNewOperation).not.toHaveBeenCalled()
  })

  it("«hilfe» opens the help", async () => {
    await typeAndEnter("hilfe")
    expect(push).toHaveBeenCalledWith("/help")
  })

  it("still ranks rows that come back after a backspace", async () => {
    await typeAndEnter("neuq{Backspace}")
    expect(handlers.onNewOperation).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it("puts the best-matching group first, so the highlight is what ↵ runs", async () => {
    const user = userEvent.setup()
    renderWithIntl(<CommandPalette />)
    act(() => openCommandPalette())
    await user.type(await screen.findByRole("combobox"), "neu")
    const options = screen.getAllByRole("option")
    expect(options[0]).toHaveTextContent("Neuer Einsatz")
    expect(options[0]).toHaveAttribute("aria-selected", "true")
  })
})
