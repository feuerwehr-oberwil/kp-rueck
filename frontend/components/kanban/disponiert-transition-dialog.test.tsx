import { describe, expect, it, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { Operation } from "@/lib/contexts/operations-context"
import { DisponierTransitionDialog } from "./disponiert-transition-dialog"

/**
 * The Funkdurchsage of an Auftrag stop is recorded as SPOKEN only with «Durchgegeben»
 * (hunt 2026-11-24): the record decides whether the next stop gets the short
 * continuation, so opening the dialog – or closing it unread – must not claim it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({}) }))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock("@/lib/hooks/use-vehicle-drivers", () => ({ useVehicleDriverState: () => ({ drivers: new Map(), loaded: true }) }))
const recordAnnouncement = vi.hoisted(() => vi.fn())
const groups = [{ id: "g", name: "Testauftrag", stopIds: ["first", "second"], lastAnnounced: null }]
const resources = { personnel: [], vehicles: [], materials: [] }
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ groups, getGroupResources: () => resources, recordAnnouncement }),
}))
vi.mock("@/lib/contexts/operations-context", () => ({ useOperations: () => ({ operations: stops }) }))

function stop(id: string, index: number): Operation {
  return {
    id,
    location: `Hauptstrasse ${index + 1}`,
    vehicle: null,
    vehicles: [],
    incidentType: "elementarereignis",
    dispatchTime: new Date("2026-07-23T10:00:00Z"),
    crew: [],
    priority: "medium",
    status: index === 0 ? "enroute" : "incoming",
    coordinates: null,
    materials: [],
    notes: "",
    contact: "",
    contactPhone: "",
    internalNotes: "",
    nachbarhilfe: false,
    nachbarhilfeNote: "",
    amWarten: false,
    amWartenNote: "",
    zuFuss: false,
    groupId: "g",
    groupPosition: index,
    statusChangedAt: null,
    hasCompletedReko: false,
    rekoArrivedAt: null,
    rekoSummary: null,
    assignedReko: null,
    leaderId: null,
    leaderName: null,
    materialAssignments: new Map(),
  }
}
const stops = ["first", "second"].map(stop)

describe("DisponierTransitionDialog — Funkdurchsage recorded only when spoken", () => {
  beforeEach(() => recordAnnouncement.mockClear())

  it.each([false, true])("opening and closing records nothing (repeat=%s)", async (repeat) => {
    const onOpenChange = vi.fn()
    renderWithIntl(
      <DisponierTransitionDialog open onOpenChange={onOpenChange} operation={stops[0]} materials={[]} repeat={repeat} />,
    )
    // The footer «Schliessen» (the ✕ in the corner is the other one).
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Schliessen" }).at(-1)!)

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(recordAnnouncement).not.toHaveBeenCalled()
  })

  it("«Durchgegeben» records the text on screen and closes", async () => {
    const onOpenChange = vi.fn()
    renderWithIntl(
      <DisponierTransitionDialog open onOpenChange={onOpenChange} operation={stops[0]} materials={[]} />,
    )
    await userEvent.setup().click(screen.getByRole("button", { name: "Durchgegeben" }))

    expect(recordAnnouncement).toHaveBeenCalledExactlyOnceWith("g", {
      stopId: "first",
      full: true,
      fingerprint: expect.any(String),
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
