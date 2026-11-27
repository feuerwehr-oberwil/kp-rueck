import { describe, expect, it, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import { makeOperation } from "@/test-utils/operation-fixtures"
import type { IncidentGroup } from "@/lib/types/groups"
import { AuftragRadioDialog } from "./auftrag-radio-dialog"

/** «Durchsage wiederholen» → «Text kopieren»: a clipboard the browser refuses is said. */

const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }))
const copyToClipboard = vi.hoisted(() => vi.fn())
vi.mock("@/lib/utils", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/utils")>(), copyToClipboard }))
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ getGroupResources: () => ({ personnel: [], vehicles: [], materials: [] }) }),
}))
const stop = makeOperation({ id: "first", location: "Hauptstrasse 1", groupId: "g", groupPosition: 0 })
vi.mock("@/lib/contexts/operations-context", () => ({ useOperations: () => ({ operations: [stop], materials: [] }) }))

const group: IncidentGroup = {
  id: "g",
  eventId: "e",
  name: "Testauftrag",
  color: null,
  notes: null,
  position: 0,
  createdAt: new Date("2026-07-23T10:00:00Z"),
  updatedAt: new Date("2026-07-23T10:00:00Z"),
  createdBy: null,
  stopIds: ["first"],
  assignments: [],
  progress: { total: 1, done: 0 },
  lastAnnounced: null,
}

describe("AuftragRadioDialog — copy", () => {
  it("a refused clipboard says so instead of nothing", async () => {
    copyToClipboard.mockRejectedValueOnce(new Error("NotAllowedError"))
    renderWithIntl(<AuftragRadioDialog open onOpenChange={vi.fn()} group={group} funkrufname="Florian Oberwil" />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Text kopieren" }))

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith("Kopieren fehlgeschlagen"))
  })
})
