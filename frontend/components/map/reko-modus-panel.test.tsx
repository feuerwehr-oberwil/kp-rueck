/**
 * Reko-Modus panel (feedback 19.11.2026, #19 A): ONE Reko person in a dropdown – no tick boxes,
 * since only one can be picked – and their open Rekos as a timeline the operator drags into order.
 * pragmatic-drag-and-drop is mocked to capture the reorder monitor (as in routen-editor-modal.test).
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"
import type { Operation } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"

const reorder = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/hooks/use-reko-reorder", () => ({ useRekoReorder: () => reorder }))
vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ personnel: [], operations: [], refreshOperations: vi.fn(), formatLocation: (a: string) => a }),
}))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: { id: "e1" } }) }))
vi.mock("@/components/ui/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/lib/api-client", () => ({ apiClient: {} }))
vi.mock("@/components/incidents/assign-reko-dialog", () => ({
  REKO_PICK_MESSAGE_ID: "reko-pick",
  useRekoCandidatePicker: () => ({ chosen: null, searchField: null, list: null, reset: () => {} }),
}))

const dnd = vi.hoisted(() => ({ monitorOnDrop: null as null | ((args: unknown) => void) }))
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: (opts: { onDrop: (args: unknown) => void }) => {
    dnd.monitorOnDrop = opts.onDrop
    return () => {}
  },
}))
vi.mock("@atlaskit/pragmatic-drag-and-drop/combine", () => ({
  combine: (...cleanups: (() => void)[]) => () => cleanups.forEach((c) => c?.()),
}))
vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  attachClosestEdge: (data: unknown) => data,
  extractClosestEdge: () => "top",
}))
vi.mock("@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box", () => ({ DropIndicator: () => null }))

import { RekoModusPanel } from "./reko-modus-panel"

const person = (id: string, name: string) => ({ id, name, role: "Offizier", isReko: true }) as Person
const op = (id: string, location: string) =>
  ({ id, location, incidentType: "elementarereignis", status: "reko", notes: "", number: null, coordinates: [47.5, 7.5] }) as unknown as Operation

const keller = person("p1", "Keller Marco")
const brunner = person("p2", "Brunner Sarah")
const open = [op("A", "Bahnhofstrasse 22"), op("B", "Allschwilerstrasse 14"), op("C", "Hauptstrasse 40")]

function renderPanel(selectedPersonId: string | null, onSelectPerson = vi.fn()) {
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      <RekoModusPanel
        people={[keller, brunner]}
        openByPerson={new Map([["p1", open]])}
        colors={new Map([["p1", "#0e6680"], ["p2", "#6365f0"]])}
        selectedPersonId={selectedPersonId}
        onSelectPerson={onSelectPerson}
        onExit={() => {}}
      />
    </NextIntlClientProvider>,
  )
  return { onSelectPerson }
}

beforeEach(() => {
  reorder.mockClear()
  dnd.monitorOnDrop = null
})

describe("RekoModusPanel – one person", () => {
  it("picks the person from a dropdown, not from tick boxes", async () => {
    const { onSelectPerson } = renderPanel(null)
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole("combobox", { name: "Reko-Person" }))
    await userEvent.setup().click(screen.getByRole("option", { name: /Brunner Sarah/ }))

    expect(onSelectPerson).toHaveBeenCalledWith("p2")
  })

  it("says how many Rekos each person has open, or that they are free", async () => {
    renderPanel(null)
    await userEvent.setup().click(screen.getByRole("combobox", { name: "Reko-Person" }))
    expect(screen.getByRole("option", { name: /Keller Marco.*3 offen/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Brunner Sarah.*frei/ })).toBeInTheDocument()
  })
})

describe("RekoModusPanel – the order", () => {
  it("lists the person's open Rekos in their order", () => {
    renderPanel("p1")
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "")
    expect(rows.slice(0, 3).map((row) => row.match(/^\d/)?.[0])).toEqual(["1", "2", "3"])
    expect(rows[0]).toContain("Bahnhofstrasse 22")
    expect(rows[2]).toContain("Hauptstrasse 40")
  })

  it("a drag reorders that person's Rekos", () => {
    renderPanel("p1")
    // Drag C onto A (edge 'top') → C, A, B.
    dnd.monitorOnDrop!({
      source: { data: { type: "reko-stop-drag", groupId: "p1", incidentId: "C" } },
      location: { current: { dropTargets: [{ data: { type: "reko-stop", groupId: "p1", incidentId: "A" } }] } },
    })
    expect(reorder).toHaveBeenCalledWith("p1", ["C", "A", "B"])
  })

  it("ignores an Auftrag stop drag", () => {
    renderPanel("p1")
    dnd.monitorOnDrop!({
      source: { data: { type: "route-stop-drag", groupId: "p1", incidentId: "C" } },
      location: { current: { dropTargets: [{ data: { type: "group-stop", groupId: "p1", incidentId: "A" } }] } },
    })
    expect(reorder).not.toHaveBeenCalled()
  })
})
