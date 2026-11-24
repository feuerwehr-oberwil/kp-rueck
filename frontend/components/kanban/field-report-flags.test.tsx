import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { Operation } from "@/lib/contexts/operations-context"

const writes = vi.hoisted(() => ({ saveRekoArrived: vi.fn(), saveFieldReport: vi.fn() }))
vi.mock("@/lib/hooks/use-field-report-writes", () => ({ useFieldReportWrites: () => writes }))

import { FieldReportFlags } from "@/components/kanban/field-report-flags"

// Owner, 24.11.2026: the detail sets «Reko vor Ort» / «Abholung nötig» like the card menu.
describe("FieldReportFlags", () => {
  it("writes both flags the way the card menu does", async () => {
    const operation = {
      id: "op-1",
      assignedReko: { id: "p-1", name: "Keller Marco" },
      rekoArrivedAt: null,
      pickupNeeded: false,
      pickupNote: "zwei Personen",
    } as unknown as Operation
    renderWithIntl(<FieldReportFlags operation={operation} />)

    expect(screen.getByRole("group", { name: "Funkmeldungen" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Reko vor Ort" }))
    expect(writes.saveRekoArrived).toHaveBeenCalledWith("op-1", undefined)
    await userEvent.click(screen.getByRole("button", { name: "Abholung nötig" }))
    expect(writes.saveFieldReport).toHaveBeenCalledWith("op-1", { pickup_needed: true, pickup_note: "zwei Personen" })
  })

  it("offers «Reko vor Ort» only with a Reko", () => {
    const operation = { id: "op-1", assignedReko: null, rekoArrivedAt: null, pickupNeeded: true } as unknown as Operation
    renderWithIntl(<FieldReportFlags operation={operation} />)

    expect(screen.queryByRole("button", { name: "Reko vor Ort" })).toBeNull()
    expect(screen.getByRole("button", { name: "Abholung nötig" })).toHaveAttribute("aria-pressed", "true")
  })
})
