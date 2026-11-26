import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"

const writes = vi.hoisted(() => ({ saveRekoArrived: vi.fn(), saveFieldReport: vi.fn() }))
vi.mock("@/lib/hooks/use-field-report-writes", () => ({ useFieldReportWrites: () => writes }))

import { FieldReportFlags } from "@/components/kanban/field-report-flags"
import { makeOperation } from "@/test-utils/operation-fixtures"

// Owner, 24.11.2026: the detail sets «Reko vor Ort» / «Abholung nötig» like the card menu.
describe("FieldReportFlags", () => {
  it("writes both flags the way the card menu does", async () => {
    const operation = makeOperation({
      id: "op-1",
      assignedReko: { id: "p-1", name: "Keller Marco" },
      pickupNeeded: false,
      pickupNote: "zwei Personen",
    })
    renderWithIntl(<FieldReportFlags operation={operation} />)

    expect(screen.getByRole("group", { name: "Funkmeldungen" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Reko vor Ort" }))
    expect(writes.saveRekoArrived).toHaveBeenCalledWith("op-1", undefined)
    await userEvent.click(screen.getByRole("button", { name: "Abholung nötig" }))
    expect(writes.saveFieldReport).toHaveBeenCalledWith("op-1", { pickup_needed: true, pickup_note: "zwei Personen" })
  })

  it("offers «Reko vor Ort» only with a Reko", () => {
    const operation = makeOperation({ id: "op-1", assignedReko: null, rekoArrivedAt: null, pickupNeeded: true })
    renderWithIntl(<FieldReportFlags operation={operation} />)

    expect(screen.queryByRole("button", { name: "Reko vor Ort" })).toBeNull()
    expect(screen.getByRole("button", { name: "Abholung nötig" })).toHaveAttribute("aria-pressed", "true")
  })
})
