import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { ApiEventFigures, ApiPriorityFigures, ApiStageFigures } from "@/lib/api-client"
import { EventFiguresView } from "./event-figures"

const none: ApiStageFigures = { count: 0, median_seconds: null, p90_seconds: null }

function row(priority: ApiPriorityFigures["priority"], overrides: Partial<ApiPriorityFigures> = {}): ApiPriorityFigures {
  return { priority, total: 0, waiting: 0, in_progress: 0, done: 0, dispatched: none, on_scene: none, closed: none, ...overrides }
}

function figures(overrides: Partial<ApiEventFigures> = {}): ApiEventFigures {
  const high = row("high", {
    total: 4,
    waiting: 2,
    in_progress: 1,
    done: 1,
    dispatched: { count: 2, median_seconds: 240, p90_seconds: 360 },
    on_scene: { count: 2, median_seconds: 900, p90_seconds: 1200 },
    closed: { count: 1, median_seconds: 3600, p90_seconds: 3600 },
  })
  const medium = row("medium", { total: 1, in_progress: 1, dispatched: { count: 1, median_seconds: 900, p90_seconds: 900 } })
  const low = row("low", { total: 1, waiting: 1 })
  return {
    total: 6,
    waiting: 3,
    in_progress: 2,
    done: 1,
    overall: row("all", { total: 6, waiting: 3, in_progress: 2, done: 1, dispatched: { count: 3, median_seconds: 360, p90_seconds: 900 } }),
    by_priority: [high, medium, low],
    oldest_waiting_high: {
      incident_id: "inc-1",
      title: "Keller Hauptstrasse",
      created_at: new Date(Date.now() - 48 * 60_000).toISOString(),
    },
    ...overrides,
  }
}

describe("EventFiguresView", () => {
  it("shows the four counts and the waiting split by priority", () => {
    renderWithIntl(<EventFiguresView figures={figures()} />)
    const counts = screen.getByText("Meldungen").closest("dl")!
    expect(within(counts).getByText("6")).toBeTruthy()
    expect(within(counts).getByText("Offen")).toBeTruthy()
    expect(within(counts).getByText("2 hoch · 0 mittel · 1 niedrig")).toBeTruthy()
    expect(within(counts).getByText("In Arbeit")).toBeTruthy()
    expect(within(counts).getByText("Erledigt")).toBeTruthy()
  })

  it("prints median with P90 underneath, and a dash where a stage was never reached", () => {
    renderWithIntl(<EventFiguresView figures={figures()} />)
    const table = screen.getByRole("table")
    const highRow = within(table).getByRole("rowheader", { name: /Hoch/ }).closest("tr")!
    expect(within(highRow).getByText("4'")).toBeTruthy()
    expect(within(highRow).getByText("P90 6'")).toBeTruthy()
    expect(within(highRow).getByText("1h 0'")).toBeTruthy()
    const lowRow = within(table).getByRole("rowheader", { name: /Niedrig/ }).closest("tr")!
    // No transitions for «niedrig»: three empty stages, no invented zero.
    expect(within(lowRow).getAllByText("–")).toHaveLength(3)
    expect(within(table).getByRole("rowheader", { name: /Alle/ })).toBeTruthy()
  })

  it("names the oldest waiting «hoch» Meldung with its age and opens it", () => {
    const onOpen = vi.fn()
    renderWithIntl(
      <EventFiguresView figures={figures()} incidentLabel={() => "Hauptstrasse 5"} onOpenIncident={onOpen} />,
    )
    const button = screen.getByRole("button", { name: /Hauptstrasse 5/ })
    expect(within(button).getByText("wartet seit 48'")).toBeTruthy()
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledWith("inc-1")
  })

  it("says so when no «hoch» Meldung is waiting", () => {
    renderWithIntl(<EventFiguresView figures={figures({ oldest_waiting_high: null })} />)
    expect(screen.getByText("Keine «Hoch»-Meldung wartet.")).toBeTruthy()
  })

  it("draws one bar per priority, «noch keine» without a dispatch", () => {
    renderWithIntl(<EventFiguresView figures={figures()} />)
    const chart = screen.getByRole("region", { name: "Eingang → Disponiert je Priorität" })
    const items = within(chart).getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText("4' · 6'")).toBeTruthy()
    expect(within(items[2]).getByText("noch keine")).toBeTruthy()
  })

  it("keeps the definitions behind an (i) button, and off the wall", async () => {
    const { unmount } = renderWithIntl(<EventFiguresView figures={figures()} />)
    expect(screen.queryByText(/Dieselben Werte wie im Einsatzbericht/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Wie wird gerechnet?" }))
    expect(await screen.findByText(/Dieselben Werte wie im Einsatzbericht/)).toBeTruthy()
    unmount()
    renderWithIntl(<EventFiguresView figures={figures()} density="wall" />)
    expect(screen.queryByRole("button", { name: "Wie wird gerechnet?" })).toBeNull()
  })
})
