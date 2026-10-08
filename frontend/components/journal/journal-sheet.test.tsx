import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { ApiJournalEntry } from "@/lib/api/types"
import type { Operation } from "@/lib/contexts/operations-context"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import { JournalSheet } from "./journal-sheet"

const mobile = vi.hoisted(() => ({ value: false }))
vi.mock("@/components/ui/use-mobile", () => ({ useIsMobile: () => mobile.value }))

const api = vi.hoisted(() => ({
  getJournal: vi.fn(),
  appendJournal: vi.fn(),
  correctJournal: vi.fn(),
}))
vi.mock("@/lib/api-client", () => ({ apiClient: api }))
vi.mock("@/lib/websocket-client", () => ({ wsClient: { on: () => () => {} } }))

let seq = 0
function row(over: Partial<ApiJournalEntry>): ApiJournalEntry {
  seq += 1
  const at = new Date(2026, 9, 8, 10, seq).toISOString()
  return {
    id: `r${seq}`,
    seq,
    event_id: "e1",
    incident_id: null,
    incident_title: null,
    kind: "manual",
    category: "manual",
    text: null,
    data: null,
    occurred_at: at,
    created_at: at,
    author_name: null,
    corrects_id: null,
    ...over,
  }
}

const op = {
  id: "i1",
  location: "Gartenweg 4, Oberwil",
  locationDisplay: "Gartenweg 4",
  incidentType: "brandbekaempfung",
  status: "active",
} as unknown as Operation

const ROWS = [
  row({ kind: "status", category: "status", incident_id: "i1", incident_title: "Gartenweg 4", data: { from_status: "incoming", to_status: "enroute" } }),
  row({ kind: "assignment", category: "resources", incident_id: "i1", data: { action: "assigned", resource_type: "vehicle", resource_name: "TLF 1" } }),
  row({ kind: "message", category: "field", incident_id: "i1", text: "Brand aus", author_name: "Meier Anna", data: { direction: "from_field" } }),
  row({ kind: "manual", category: "manual", text: "Gemeindepräsident informiert", author_name: "Dispo" }),
]

function renderSheet(isEditor = true) {
  return renderWithIntl(
    <JournalSheet open onOpenChange={() => {}} eventId="e1" operations={[op]} isEditor={isEditor} onOpenIncident={() => {}} />,
  )
}

beforeEach(() => {
  mobile.value = false
  api.getJournal.mockReset().mockResolvedValue({ entries: ROWS, latest_seq: ROWS[ROWS.length - 1].seq })
  api.appendJournal.mockReset()
  api.correctJournal.mockReset()
})

describe("JournalSheet", () => {
  it("lists every kind in words, newest first", async () => {
    renderSheet()
    const rows = await screen.findAllByTestId("journal-row")
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["manual", "message", "assignment", "status"])
    expect(rows[0]).toHaveTextContent("Gemeindepräsident informiert")
    expect(rows[1]).toHaveTextContent("Meier Anna: Brand aus")
    expect(rows[2]).toHaveTextContent("TLF 1 zugeteilt")
    expect(rows[3]).toHaveTextContent("Eingegangen → Disponiert")
    // the Einsatz chip carries the board's own label
    expect(within(rows[3]).getByRole("button", { name: "Gartenweg 4" })).toBeInTheDocument()
  })

  it("filters by chip; «Alle» is the empty selection", async () => {
    const user = userEvent.setup()
    renderSheet()
    await screen.findAllByTestId("journal-row")
    await user.click(screen.getByRole("button", { name: /^Manuell/ }))
    expect(screen.getAllByTestId("journal-row")).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: /^Feld/ }))
    expect(screen.getAllByTestId("journal-row")).toHaveLength(2)
    await user.click(screen.getByRole("button", { name: /^Alle/ }))
    expect(screen.getAllByTestId("journal-row")).toHaveLength(4)
  })

  it("writes a manual line linked via #", async () => {
    const user = userEvent.setup()
    api.appendJournal.mockImplementation(async (_e: string, body: { text: string; incident_id: string | null }) =>
      row({ text: body.text, incident_id: body.incident_id, incident_title: "Gartenweg 4", author_name: "Dispo" }),
    )
    renderSheet()
    await screen.findAllByTestId("journal-row")
    const input = screen.getByRole("textbox", { name: "Neuer Eintrag im Einsatztagebuch" })
    await user.type(input, "Anwohner evakuiert #gart")
    await user.click(await screen.findByRole("option", { name: /Gartenweg 4/ }))
    expect(input).toHaveValue("Anwohner evakuiert ")
    await user.click(screen.getByRole("button", { name: "Eintragen" }))
    await waitFor(() => expect(api.appendJournal).toHaveBeenCalledTimes(1))
    expect(api.appendJournal.mock.calls[0][1]).toMatchObject({ text: "Anwohner evakuiert", incident_id: "i1" })
    expect(await screen.findByText("Anwohner evakuiert")).toBeInTheDocument()
    expect(input).toHaveValue("")
  })

  it("keeps the line and its id when saving fails, so a resend lands once", async () => {
    const user = userEvent.setup()
    api.appendJournal.mockRejectedValueOnce(new Error("offline")).mockImplementation(async (_e: string, b: { text: string }) => row({ text: b.text }))
    renderSheet()
    await screen.findAllByTestId("journal-row")
    const input = screen.getByRole("textbox", { name: "Neuer Eintrag im Einsatztagebuch" })
    await user.type(input, "Strom Quartier Nord aus{Enter}")
    expect(await screen.findByRole("alert")).toHaveTextContent("Nicht gespeichert")
    expect(input).toHaveValue("Strom Quartier Nord aus")
    await user.type(input, "{Enter}")
    await waitFor(() => expect(api.appendJournal).toHaveBeenCalledTimes(2))
    expect(api.appendJournal.mock.calls[1][1].client_id).toBe(api.appendJournal.mock.calls[0][1].client_id)
  })

  it("corrects a manual line by appending, and the old wording stays readable", async () => {
    const user = userEvent.setup()
    const manual = ROWS[3]
    api.correctJournal.mockImplementation(async (_e: string, id: string, b: { text: string }) =>
      row({ text: b.text, corrects_id: id, author_name: "Dispo" }),
    )
    renderSheet()
    const rows = await screen.findAllByTestId("journal-row")
    // only manual lines carry the pen
    expect(screen.getAllByRole("button", { name: "Eintrag korrigieren" })).toHaveLength(1)
    await user.click(within(rows[0]).getByRole("button", { name: "Eintrag korrigieren" }))
    const input = screen.getByRole("textbox", { name: "Neuer Wortlaut" })
    expect(input).toHaveValue("Gemeindepräsident informiert")
    await user.clear(input)
    await user.type(input, "Gemeindepräsident und Polizei informiert{Enter}")
    await waitFor(() => expect(api.correctJournal).toHaveBeenCalledWith("e1", manual.id, expect.objectContaining({ text: "Gemeindepräsident und Polizei informiert" })))
    const fixed = (await screen.findAllByTestId("journal-row"))[0]
    expect(fixed).toHaveTextContent("Gemeindepräsident und Polizei informiert")
    await user.click(within(fixed).getByRole("button", { name: /korrigiert/ }))
    expect(within(fixed).getByText("Gemeindepräsident informiert")).toBeInTheDocument()
  })

  it("a viewer reads but has no input and no pen", async () => {
    renderSheet(false)
    await screen.findAllByTestId("journal-row")
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("button", { name: "Eintrag korrigieren" })).toBeNull()
  })

  it("phone: one funnel instead of a chip row", async () => {
    mobile.value = true
    renderSheet()
    await screen.findAllByTestId("journal-row")
    expect(screen.getByRole("button", { name: "Filtern" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Manuell/ })).toBeNull()
  })
})
