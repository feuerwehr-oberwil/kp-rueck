import { afterEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"
import fr from "@/messages/fr.json"

import { ApiError } from "@/lib/api/types/common"
import { dismissStatusConflict, reportStatusConflict } from "@/lib/status-conflict"

// «Gerade geändert»: what the operator reads, and what each answer sends.

const ops = vi.hoisted(() => ({
  updateOperation: vi.fn(),
  operations: [{ id: "10", location: "Rebbergstrasse 5", locationDisplay: "Rebbergstrasse 5", incidentType: "elementarereignis" }],
}))
vi.mock("@/lib/contexts/operations-context", () => ({ useOperations: () => ops }))

import { StatusConflictDialog } from "./status-conflict-dialog"

const refusal = (params: Record<string, string | number>) =>
  new ApiError("Status geändert", 409, true, "incident_status_changed", params)

function open(params: Record<string, string | number>, wanted: "enroute" | "complete" = "enroute") {
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <StatusConflictDialog />
    </NextIntlClientProvider>,
  )
  act(() => {
    reportStatusConflict(refusal(params), { operationId: "10", seen: "reko_done", wanted })
  })
}

afterEach(() => {
  act(() => dismissStatusConflict())
  ops.updateOperation.mockReset()
})

describe("StatusConflictDialog", () => {
  it("says who closed it, what is now, what you wanted, and what «Trotzdem» does", () => {
    open({ status: "complete", changed_by: "Fischer Thomas", seconds_ago: 4, released: "Suter Beat" })

    const dialog = screen.getByTestId("status-conflict-dialog")
    expect(dialog).toHaveTextContent("Fischer Thomas hat Rebbergstrasse 5 vor 4 s abgeschlossen.")
    expect(dialog).toHaveTextContent("JetztAbgeschlossen · Suter Beat freigegeben")
    expect(dialog).toHaveTextContent("Du wolltestReko abgeschlossen → Disponiert / Anfahrt")
    expect(dialog).toHaveTextContent("«Trotzdem disponieren» öffnet den Einsatz wieder und weist Suter Beat erneut zu.")
    // The safe answer is the focused one.
    expect(screen.getByRole("button", { name: "Abgeschlossen lassen" })).toHaveFocus()
  })

  it("keeping the server's state sends nothing", async () => {
    open({ status: "complete", changed_by: "Fischer Thomas", seconds_ago: 4 })
    await userEvent.click(screen.getByRole("button", { name: "Abgeschlossen lassen" }))
    expect(ops.updateOperation).not.toHaveBeenCalled()
    expect(screen.queryByTestId("status-conflict-dialog")).toBeNull()
  })

  it("«Trotzdem» resends the move, overriding exactly the state it showed", async () => {
    open({ status: "complete", changed_by: "Fischer Thomas", seconds_ago: 4 })
    await userEvent.click(screen.getByRole("button", { name: "Trotzdem disponieren" }))
    expect(ops.updateOperation).toHaveBeenCalledWith(
      "10",
      { status: "enroute" },
      { seen: "reko_done", override: "complete" },
    )
    expect(screen.queryByTestId("status-conflict-dialog")).toBeNull()
  })

  it("a move nobody signed and not into «Abgeschlossen» reads without a name and without a consequence line", () => {
    open({ status: "active", seconds_ago: 75 })
    const dialog = screen.getByTestId("status-conflict-dialog")
    expect(dialog).toHaveTextContent("Rebbergstrasse 5 wurde vor 1' auf «Im Einsatz» gesetzt.")
    expect(dialog).not.toHaveTextContent("öffnet den Einsatz wieder")
    expect(screen.getByRole("button", { name: "Im Einsatz lassen" })).toBeInTheDocument()
  })

  it("has a «Trotzdem …» label for every status, in German and French (the key is built from the status)", () => {
    for (const status of Object.keys(de.incidents.status)) {
      expect(de.kanban.statusConflict.force).toHaveProperty(status)
      expect(fr.kanban.statusConflict.force).toHaveProperty(status)
    }
  })

  it("an other 409 is not a status conflict", () => {
    expect(reportStatusConflict(new ApiError("Konflikt", 409, true), { operationId: "10", seen: "reko", wanted: "enroute" })).toBe(false)
  })
})
