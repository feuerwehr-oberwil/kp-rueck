import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"

import type { ApiIncidentTimelineEvent } from "@/lib/api-client"
import { IncidentTimeline } from "./incident-timeline"

// The Verlauf keeps both writes of a race; the one confirmed after «Gerade geändert» is marked.

const move = (overrides: Partial<ApiIncidentTimelineEvent>): ApiIncidentTimelineEvent => ({
  event_type: "status_change",
  timestamp: "2026-10-24T16:38:02Z",
  actor_name: null,
  from_status: "reko_done",
  to_status: "complete",
  ...overrides,
})

function renderTimeline(events: ApiIncidentTimelineEvent[]) {
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <IncidentTimeline events={events} isLoading={false} failed={false} onRetry={() => {}} />
    </NextIntlClientProvider>,
  )
  return screen.getAllByRole("listitem")
}

describe("IncidentTimeline – a stale move", () => {
  it("reads from what the operator's board showed, says who, and marks where the card really stood", () => {
    const [stale, race] = renderTimeline([
      move({
        timestamp: "2026-10-24T16:38:06Z",
        actor_name: "editor",
        from_status: "complete",
        to_status: "enroute",
        seen_status: "reko_done",
        stale_seconds: 4,
      }),
      move({ actor_name: "Fischer Thomas" }),
    ])

    expect(stale).toHaveTextContent("Reko abgeschlossen→Disponiert / Anfahrt · editor")
    expect(stale).toHaveTextContent("war schon abgeschlossen (vor 4 s)")
    expect(race).toHaveTextContent("Reko abgeschlossen→Abgeschlossen · Fischer Thomas")
    expect(race).not.toHaveTextContent("war schon")
  })
})
