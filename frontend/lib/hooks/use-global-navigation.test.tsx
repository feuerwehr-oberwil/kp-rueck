import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"
import fs from "node:fs"
import path from "node:path"

const nav = vi.hoisted(() => ({ pathname: "/resources", push: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => nav.pathname,
}))
const openCommandPalette = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/command-palette", () => ({ openCommandPalette }))

import { GlobalShortcuts, globalShortcutsEnabled } from "./use-global-navigation"
import { G_PREFIX_SHORTCUTS, gPrefixHint } from "./use-g-prefix-navigation"

// act(): the chord is React state, so the listener re-binds between the keys.
const press = (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
  })

beforeEach(() => {
  nav.pathname = "/resources"
  nav.push.mockClear()
  openCommandPalette.mockClear()
})
afterEach(() => {
  document.body.innerHTML = ""
})

describe("globalShortcutsEnabled", () => {
  it.each([
    ["/resources", true],
    ["/admin/audit", true],
    ["/admin/import", true],
    ["/settings", true],
    ["/events", true],
    ["/help", true],
    ["/training", true],
    ["/divera-pool", true],
    // own handler drives the same machine
    ["/", false],
    ["/map", false],
    // wall screens, public phone forms, sign-in
    ["/display/map", false],
    ["/feld", false],
    ["/reko/abc", false],
    ["/check-in", false],
    ["/alarm", false],
    ["/login", false],
    ["/setup", false],
  ])("%s → %s", (route, enabled) => {
    expect(globalShortcutsEnabled(route)).toBe(enabled)
  })
})

describe("GlobalShortcuts", () => {
  it("G K and G M work on a page that never mounted the chords itself", () => {
    render(<GlobalShortcuts />)
    press("g")
    press("k")
    expect(nav.push).toHaveBeenLastCalledWith("/")
    press("g")
    press("m")
    expect(nav.push).toHaveBeenLastCalledWith("/map")
  })

  it("stands down while typing into a field", () => {
    render(<GlobalShortcuts />)
    const input = document.createElement("input")
    document.body.appendChild(input)
    press("g", input)
    press("m", input)
    const editable = document.createElement("div")
    editable.setAttribute("contenteditable", "true")
    document.body.appendChild(editable)
    press("g", editable)
    press("m", editable)
    expect(nav.push).not.toHaveBeenCalled()
  })

  it("stands down while a dialog owns the keyboard", () => {
    render(<GlobalShortcuts />)
    const dialog = document.createElement("div")
    dialog.setAttribute("role", "dialog")
    dialog.setAttribute("data-state", "open")
    document.body.appendChild(dialog)
    press("g")
    press("m")
    expect(nav.push).not.toHaveBeenCalled()
  })

  it("ignores modifier chords and opens the palette on ?", () => {
    render(<GlobalShortcuts />)
    press("g", document.body, { ctrlKey: true })
    press("m")
    expect(nav.push).not.toHaveBeenCalled()
    press("?")
    expect(openCommandPalette).toHaveBeenCalledTimes(1)
  })

  it("does nothing on the Board, which drives the chords itself", () => {
    nav.pathname = "/"
    render(<GlobalShortcuts />)
    press("g")
    press("m")
    expect(nav.push).not.toHaveBeenCalled()
  })
})

describe("the chords are documented as they work", () => {
  const root = path.resolve(__dirname, "../..")
  it.each(["public/content/help/index.md", "public/content/help/index.fr.md"])("%s lists every chord", (file) => {
    const help = fs.readFileSync(path.join(root, file), "utf8")
    for (const shortcut of G_PREFIX_SHORTCUTS) {
      expect(help).toContain(`\`${gPrefixHint(shortcut.path)}\``)
    }
    expect(help).toContain("`G K`")
  })

  it("the command palette takes its hints from the table", () => {
    const palette = fs.readFileSync(path.join(root, "components/ui/command-palette.tsx"), "utf8")
    expect(palette).not.toMatch(/>G [A-Z]</)
    for (const shortcut of G_PREFIX_SHORTCUTS) expect(palette).toContain(`gPrefixHint("${shortcut.path}")`)
  })
})
