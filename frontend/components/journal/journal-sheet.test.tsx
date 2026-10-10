import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { ApiJournalEntry } from "@/lib/api/types"
import type { Operation } from "@/lib/contexts/operations-context"
import type { IncidentChoice } from "@/lib/journal"
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
const onOpenChange = vi.fn()
function row(over: Partial<ApiJournalEntry>): ApiJournalEntry {
  seq += 1
  const at = new Date(2026, 9, 8, 10, seq).toISOString()
  return {
    id: `r${seq}`,
    seq,
    event_id: "e1",
    incident_id: null,
    incident_title: null,
    incident_deleted: false,
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

function renderSheet(isEditor = true, operations: Array<Operation & Pick<IncidentChoice, "number">> = [op]) {
  return renderWithIntl(
    <JournalSheet open onOpenChange={onOpenChange} eventId="e1" operations={operations} isEditor={isEditor} onOpenIncident={() => {}} />,
  )
}

beforeEach(() => {
  mobile.value = false
  onOpenChange.mockClear()
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

  it.each(["14", "gart"])("links by #%s and shows the Einsatz number with its address", async (query) => {
    const user = userEvent.setup()
    const operations = [
      { ...op, number: 14 },
      { ...op, id: "i2", number: 140, location: "Hauptstrasse 14", locationDisplay: "Hauptstrasse 14" },
    ]
    api.appendJournal.mockImplementation(async (_e: string, body: { text: string; incident_id: string | null }) =>
      row({ text: body.text, incident_id: body.incident_id, incident_title: "Gartenweg 4" }),
    )
    renderSheet(true, operations)
    await screen.findAllByTestId("journal-row")
    const input = screen.getByRole("textbox", { name: "Neuer Eintrag im Einsatztagebuch" })
    await user.type(input, `Anwohner evakuiert #${query}`)
    expect(await screen.findAllByRole("option")).toHaveLength(1)
    await user.click(screen.getByRole("option", { name: /14 · Gartenweg 4/ }))
    expect(input).toHaveValue("Anwohner evakuiert ")
    await user.click(screen.getByRole("button", { name: "Eintragen" }))
    await waitFor(() => expect(api.appendJournal).toHaveBeenCalledTimes(1))
    expect(api.appendJournal.mock.calls[0][1]).toMatchObject({ text: "Anwohner evakuiert", incident_id: "i1" })
  })

  it.each(["14", "Gartenweg 4"])("links by plain %s without changing the draft or submitting it", async (query) => {
    const user = userEvent.setup()
    api.appendJournal.mockImplementation(async (_e: string, body: { text: string; incident_id: string | null }) =>
      row({ text: body.text, incident_id: body.incident_id }),
    )
    renderSheet(true, [{ ...op, number: 14 }, { ...op, id: "i2", number: 140, location: "Hauptstrasse 14", locationDisplay: "Hauptstrasse 14" }])
    await screen.findAllByTestId("journal-row")
    const input = screen.getByRole("textbox", { name: "Neuer Eintrag im Einsatztagebuch" })
    await user.type(input, "14 Anwohner evakuiert")
    await user.click(screen.getByRole("button", { name: "Einsatz verknüpfen" }))
    const search = screen.getByRole("textbox", { name: "Einsatz nach Nummer oder Ort suchen" })
    await user.type(search, query)
    expect(screen.getAllByRole("option")).toHaveLength(1)
    await user.keyboard("{Enter}")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(input).toHaveValue("14 Anwohner evakuiert")
    expect(input).toHaveFocus()
    expect(api.appendJournal).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Eintragen" }))
    await waitFor(() => expect(api.appendJournal).toHaveBeenCalledTimes(1))
    expect(api.appendJournal.mock.calls[0][1]).toMatchObject({ text: "14 Anwohner evakuiert", incident_id: "i1" })
  })

  it("cancels an unmatched search without changing the draft or closing the journal", async () => {
    const user = userEvent.setup()
    renderSheet()
    await screen.findAllByTestId("journal-row")
    const input = screen.getByRole("textbox", { name: "Neuer Eintrag im Einsatztagebuch" })
    await user.type(input, "Polizei informiert")
    await user.click(screen.getByRole("button", { name: "Einsatz verknüpfen" }))
    await user.type(screen.getByRole("textbox", { name: "Einsatz nach Nummer oder Ort suchen" }), "unbekannt{Enter}")
    expect(screen.queryByRole("option")).toBeNull()
    expect(api.appendJournal).not.toHaveBeenCalled()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(input).toHaveValue("Polizei informiert")
    expect(screen.getByRole("button", { name: "Einsatz verknüpfen" })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps the journal open while selecting a portalled result (phone: %s)', async (phone) => {
    mobile.value = phone
    const user = userEvent.setup()
    renderSheet()
    await screen.findAllByTestId("journal-row")
    await user.click(screen.getByRole("button", { name: "Einsatz verknüpfen" }))
    await user.click(screen.getByRole("option", { name: /Gartenweg 4/ }))
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("button", { name: "Verknüpfung entfernen" })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(api.appendJournal).not.toHaveBeenCalled()
  })

  it("⇧J: the line gets the caret, linked to the selected card; Backspace on the empty line unlinks", async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <JournalSheet
        open
        onOpenChange={onOpenChange}
        eventId="e1"
        operations={[{ ...op, number: 14 }]}
        isEditor
        composeRequest={{ incidentId: "i1", at: 1 }}
      />,
    )
    const input = screen.getByRole("textbox", { name: "Neuer Eintrag im Einsatztagebuch" })
    await waitFor(() => expect(input).toHaveFocus())
    // The Einsatz sits in the line, in front of the text — not on a row of its own.
    expect(screen.getByTestId("journal-linked")).toHaveTextContent("14 · Gartenweg 4")
    expect(screen.queryByRole("button", { name: "Einsatz verknüpfen" })).toBeNull()
    await user.keyboard("{Backspace}")
    expect(screen.queryByTestId("journal-linked")).toBeNull()
    expect(screen.getByRole("button", { name: "Einsatz verknüpfen" })).toBeInTheDocument()
  })

  it("dates every row, today's included, so the times line up", async () => {
    renderSheet()
    const rows = await screen.findAllByTestId("journal-row")
    for (const r of rows) expect(r.querySelector("time")?.textContent).toMatch(/^\d{2}\.\d{2}\. \d{2}:\d{2}$/)
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

  it("words the field facts and marks Einsätze that left the board", async () => {
    api.getJournal.mockResolvedValue({
      entries: [
        row({ kind: "field", category: "field", incident_id: "i1", incident_title: "Gartenweg 4", data: { type: "field_pickup_requested", source: "kp" }, text: "beim Bach" }),
        row({ kind: "status", category: "status", incident_id: "gone", incident_title: "Fehlalarm Schulhaus", incident_deleted: true, data: { from_status: "incoming", to_status: "reko" } }),
        row({ kind: "incident", category: "status", incident_id: "dup", incident_title: "Meldung Gartenweg", incident_deleted: true, data: { action: "merged_into", other_title: "Gartenweg 4" } }),
        row({ kind: "field", category: "field", incident_id: "i1", incident_title: "Gartenweg 4", data: { type: "field_request_done", source: null }, text: "Material: Tauchpumpe Gr. ×2", author_name: "Dispo" }),
        row({ kind: "incident", category: "status", incident_id: "i1", incident_title: "Gartenweg 4", data: { action: "items_moved", other_title: "Meldung Gartenweg" }, text: "TLF 1, Meier Hans, Reko-Bericht" }),
        row({ kind: "field", category: "field", incident_id: "i1", incident_title: "Gartenweg 4", data: { type: "field_request_moved", source: null, other_title: "Meldung Gartenweg" }, text: "Verstärkung: 4 Personen" }),
      ],
      latest_seq: 999,
    })
    renderSheet()
    const rows = await screen.findAllByTestId("journal-row")
    const text = rows.map((r) => r.textContent)
    expect(text.some((t) => t?.includes("Abholung nötig: beim Bach (im KP erfasst)"))).toBe(true)
    expect(text.some((t) => t?.includes("Fehlalarm Schulhaus (gelöscht)"))).toBe(true)
    expect(text.some((t) => t?.includes("Meldung Gartenweg → Gartenweg 4") && t.includes("Zusammengeführt in «Gartenweg 4»"))).toBe(true)
    // A request from the field changing state (R13): what, and that it is done – no «im KP erfasst».
    expect(text.some((t) => t?.includes("Anfrage erledigt: Material: Tauchpumpe Gr. ×2") && !t.includes("im KP erfasst"))).toBe(true)
    // The merged card's work, moved over (owner decision 10.10.2026).
    expect(text.some((t) => t?.includes("Übernommen von Meldung Gartenweg: TLF 1, Meier Hans, Reko-Bericht"))).toBe(true)
    // A request that moved with a merge says where it came from.
    expect(text.some((t) => t?.includes("Anfrage übernommen von Meldung Gartenweg: Verstärkung: 4 Personen"))).toBe(true)
  })

  it("an edited line after a failure is a new write with a new id", async () => {
    const user = userEvent.setup()
    api.appendJournal.mockRejectedValueOnce(new Error("offline")).mockImplementation(async (_e: string, b: { text: string }) => row({ text: b.text }))
    renderSheet()
    await screen.findAllByTestId("journal-row")
    const input = screen.getByRole("textbox", { name: "Neuer Eintrag im Einsatztagebuch" })
    await user.type(input, "Strom Nord aus{Enter}")
    await screen.findByRole("alert")
    await user.clear(input)
    await user.type(input, "Strom Süd aus{Enter}")
    await waitFor(() => expect(api.appendJournal).toHaveBeenCalledTimes(2))
    expect(api.appendJournal.mock.calls[1][1].client_id).not.toBe(api.appendJournal.mock.calls[0][1].client_id)
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
