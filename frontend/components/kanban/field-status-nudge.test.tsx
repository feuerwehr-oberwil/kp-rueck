import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { Operation } from "@/lib/contexts/operations-context"

const changeStatusToTop = vi.hoisted(() => vi.fn())

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ changeStatusToTop }),
}))

import { FieldStatusNudge, FIELD_NUDGE_STORAGE_KEY } from "@/components/kanban/field-status-nudge"

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "incident-1",
    location: "Hauptstrasse 1",
    vehicle: null,
    vehicles: [],
    incidentType: "brand",
    dispatchTime: new Date("2026-08-09T10:00:00Z"),
    crew: [],
    priority: "low",
    status: "incoming",
    coordinates: [47.1, 7.2],
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
    groupId: null,
    groupPosition: 0,
    statusChangedAt: null,
    hasCompletedReko: false,
    rekoArrivedAt: null,
    rekoSummary: null,
    assignedReko: null,
    leaderName: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
    ...overrides,
  }
}

// Node 26 + jsdom: localStorage has to be stubbed explicitly, so give the
// component a plain in-memory store we can also read back in assertions.
let store: Record<string, string> = {}

beforeEach(() => {
  store = {}
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value)
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
    key: () => null,
    length: 0,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("FieldStatusNudge", () => {
  it("asks to move a card the field reported finished", () => {
    renderWithIntl(
      <FieldStatusNudge
        operation={operation({ status: "active", fieldCompleteReportedAt: new Date() })}
        onRequestComplete={vi.fn()}
      />,
    )

    expect(screen.getByText("Feld meldet beendet – nach Abgeschlossen verschieben?")).toBeDefined()
  })

  it("stays silent once the card already sits in Abgeschlossen", () => {
    renderWithIntl(
      <FieldStatusNudge
        operation={operation({ status: "complete", fieldCompleteReportedAt: new Date() })}
        onRequestComplete={vi.fn()}
      />,
    )

    expect(screen.queryByTestId("field-nudge-complete")).toBeNull()
  })

  it("asks to move an arrival that has not reached Einsatz yet", () => {
    renderWithIntl(<FieldStatusNudge operation={operation({ status: "enroute", fieldArrivedAt: new Date() })} />)

    expect(screen.getByText("Feld meldet angekommen – nach Einsatz verschieben?")).toBeDefined()
  })

  it("does not re-ask about an arrival on a card already in or past Einsatz", () => {
    for (const status of ["active", "returning", "complete"] as const) {
      const { unmount } = renderWithIntl(
        <FieldStatusNudge operation={operation({ status, fieldArrivedAt: new Date() })} />,
      )
      expect(screen.queryByTestId("field-nudge-arrived")).toBeNull()
      unmount()
    }
  })

  it("runs the shared completion flow when the beendet nudge is confirmed", async () => {
    const user = userEvent.setup()
    const onRequestComplete = vi.fn()
    renderWithIntl(
      <FieldStatusNudge
        operation={operation({ status: "active", fieldCompleteReportedAt: new Date() })}
        onRequestComplete={onRequestComplete}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Verschieben" }))

    expect(onRequestComplete).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("field-nudge-complete")).toBeNull()
  })

  it("moves an arrival straight into Einsatz", async () => {
    const user = userEvent.setup()
    renderWithIntl(<FieldStatusNudge operation={operation({ status: "enroute", fieldArrivedAt: new Date() })} />)

    await user.click(screen.getByRole("button", { name: "Verschieben" }))

    expect(changeStatusToTop).toHaveBeenCalledWith("incident-1", "active")
    expect(screen.queryByTestId("field-nudge-arrived")).toBeNull()
  })

  it("stays gone after a dismissal, across a remount", async () => {
    const user = userEvent.setup()
    const op = operation({ status: "enroute", fieldArrivedAt: new Date() })
    const first = renderWithIntl(<FieldStatusNudge operation={op} />)

    await user.click(screen.getByRole("button", { name: "Hinweis ausblenden" }))
    expect(screen.queryByTestId("field-nudge-arrived")).toBeNull()
    expect(store[FIELD_NUDGE_STORAGE_KEY]).toContain("incident-1:arrived")

    first.unmount()
    renderWithIntl(<FieldStatusNudge operation={op} />)

    expect(screen.queryByTestId("field-nudge-arrived")).toBeNull()
  })

  it("drops the stored key once the condition no longer holds", async () => {
    const user = userEvent.setup()
    const first = renderWithIntl(
      <FieldStatusNudge operation={operation({ status: "enroute", fieldArrivedAt: new Date() })} />,
    )
    await user.click(screen.getByRole("button", { name: "Hinweis ausblenden" }))
    expect(store[FIELD_NUDGE_STORAGE_KEY]).toContain("incident-1:arrived")
    first.unmount()

    // The card moved on — the question is dead, and so is its storage entry.
    renderWithIntl(<FieldStatusNudge operation={operation({ status: "active", fieldArrivedAt: new Date() })} />)

    expect(store[FIELD_NUDGE_STORAGE_KEY]).toBeUndefined()
  })

  it("offers a viewer nothing to click", () => {
    renderWithIntl(
      <FieldStatusNudge
        operation={operation({ status: "enroute", fieldArrivedAt: new Date(), fieldCompleteReportedAt: new Date() })}
        canEdit={false}
        onRequestComplete={vi.fn()}
      />,
    )

    expect(screen.queryByTestId("field-nudge-arrived")).toBeNull()
    expect(screen.queryByTestId("field-nudge-complete")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
  })
})
