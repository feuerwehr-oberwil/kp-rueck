import { afterEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

import type { ApiJournalEntry, ApiJournalPage } from "@/lib/api/types"

const api = vi.hoisted(() => ({ getJournal: vi.fn() }))
vi.mock("@/lib/api-client", () => ({ apiClient: api }))
vi.mock("@/lib/websocket-client", () => ({ wsClient: { on: () => () => {} } }))

import { useJournal } from "./use-journal"

function row(id: string, seq: number, event: string): ApiJournalEntry {
  return {
    id,
    seq,
    event_id: event,
    incident_id: null,
    incident_title: null,
    incident_deleted: false,
    kind: "manual",
    category: "manual",
    text: id,
    data: null,
    occurred_at: "2026-10-08T10:00:00Z",
    created_at: "2026-10-08T10:00:00Z",
    author_name: null,
    corrects_id: null,
  }
}

afterEach(() => api.getJournal.mockReset())

describe("useJournal", () => {
  it("drops a slow answer for the Ereignis it has already left", async () => {
    let releaseA!: (p: ApiJournalPage) => void
    api.getJournal.mockImplementation((eventId: string) =>
      eventId === "A"
        ? new Promise<ApiJournalPage>((resolve) => {
            releaseA = resolve
          })
        : Promise.resolve({ entries: [row("b1", 5, "B")], latest_seq: 5 }),
    )
    const { result, rerender } = renderHook(({ id }) => useJournal(id, true), { initialProps: { id: "A" } })
    await waitFor(() => expect(api.getJournal).toHaveBeenCalledWith("A", 0))

    rerender({ id: "B" })
    // B's first read starts at once — it is not held up by A's request still in flight
    await waitFor(() => expect(result.current.entries.map((e) => e.id)).toEqual(["b1"]))
    expect(api.getJournal).toHaveBeenCalledWith("B", 0)

    await act(async () => releaseA({ entries: [row("a1", 900, "A")], latest_seq: 900 }))
    expect(result.current.entries.map((e) => e.id)).toEqual(["b1"])

    // …and B's cursor was not moved to A's 900
    act(() => result.current.reload())
    await waitFor(() => expect(api.getJournal).toHaveBeenLastCalledWith("B", 5))
  })
})
