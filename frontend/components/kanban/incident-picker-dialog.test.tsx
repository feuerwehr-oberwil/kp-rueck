/**
 * IncidentPickerDialog tests — the "labelled, not hidden" default.
 *
 * Incidents that already belong to another Auftrag are ALWAYS listed (with their
 * route's badge) — there is no toggle hiding them any more. Only completed
 * incidents stay behind the "Abgeschlossene" filter, with an on-screen count.
 *
 * Leaflet cannot be mounted (or mocked — the dialog pulls it in via runtime
 * require(), which vi.mock does not intercept) under jsdom, so the fixtures are
 * deliberately UNLOCATED: the default Karte view renders its empty state and the
 * assertions cover the list, where the visibility rules live.
 */

import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"

import type { Operation } from "@/lib/contexts/operations-context"
import type { IncidentGroup } from "@/lib/contexts/groups-context"

vi.mock("@/lib/hooks/use-map-mode", () => ({
  useMapMode: () => ({
    getTileUrl: () => "https://tiles.example/{z}/{x}/{y}.png",
    getAttribution: () => "",
    handleTileError: () => {},
  }),
}))

const removeStop = vi.hoisted(() => vi.fn(async () => true))
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ removeStop }),
}))

import { IncidentPickerDialog } from "./incident-picker-dialog"

// --- Fixtures ----------------------------------------------------------------

const makeOp = (id: string, overrides: Partial<Operation> = {}): Operation =>
  ({
    id,
    location: `Hauptstrasse ${id}`,
    locationDisplay: `Hauptstrasse ${id}`,
    incidentType: "elementarereignis",
    notes: "",
    status: "incoming",
    groupId: null,
    coordinates: null, // unlocated on purpose — keeps leaflet out of jsdom
    ...overrides,
  }) as unknown as Operation

const groups = [
  { id: "g-target", name: "Auftrag Nord", color: "#3b82f6", stopIds: [] },
  { id: "g-other", name: "Auftrag Süd", color: "#10b981", stopIds: ["dispatched"] },
] as unknown as IncidentGroup[]

const operations = [
  makeOp("open"),
  makeOp("dispatched", { groupId: "g-other", status: "enroute" }),
  makeOp("done", { status: "complete" }),
]

function renderPicker() {
  const onConfirm = vi.fn()
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      <IncidentPickerDialog
        open
        onOpenChange={() => {}}
        operations={operations}
        groups={groups}
        targetGroupId="g-target"
        onConfirm={onConfirm}
      />
    </NextIntlClientProvider>,
  )
  return { onConfirm }
}

beforeEach(() => removeStop.mockClear())

// --- Tests -------------------------------------------------------------------

describe("IncidentPickerDialog — grouped incidents are labelled, not hidden", () => {
  it("lists an incident of another Auftrag by default, with its route badge", async () => {
    renderPicker()
    await userEvent.setup().click(screen.getByRole("button", { name: "Liste" }))

    const row = screen.getByText("Hauptstrasse dispatched").closest("label")!
    // The row is visible AND carries the other route's name — the label that
    // replaces the old hide-by-default behaviour.
    expect(within(row).getByText("Auftrag Süd")).toBeInTheDocument()
  })

  it("offers no 'In anderem Auftrag' toggle any more", () => {
    renderPicker()
    expect(screen.queryByRole("button", { name: "In anderem Auftrag" })).not.toBeInTheDocument()
  })

  it("still hides completed incidents by default, counts them, and reveals them via the toggle", async () => {
    renderPicker()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Liste" }))

    // Hidden count covers ONLY the completed incident now.
    expect(screen.getByText("1 ausgeblendet")).toBeInTheDocument()
    expect(screen.queryByText("Hauptstrasse done")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Abgeschlossene" }))
    expect(screen.getByText("Hauptstrasse done")).toBeInTheDocument()
    expect(screen.queryByText(/ausgeblendet/)).not.toBeInTheDocument()
  })
})
