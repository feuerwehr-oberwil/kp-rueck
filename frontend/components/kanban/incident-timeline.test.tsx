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
        stale_seconds: 190,
      }),
      move({ actor_name: "Fischer Thomas" }),
    ])

    expect(stale).toHaveTextContent("Reko abgeschlossen→Disponiert / Anfahrt · editor")
    expect(stale).toHaveTextContent("war schon abgeschlossen (vor 3')")
    expect(race).toHaveTextContent("Reko abgeschlossen→Abgeschlossen · Fischer Thomas")
    expect(race).not.toHaveTextContent("war schon")
  })
})

describe("IncidentTimeline – a Reko change (#6, 23.11.2026)", () => {
  const change = (overrides: Partial<ApiIncidentTimelineEvent>): ApiIncidentTimelineEvent => ({
    event_type: "reko_change",
    timestamp: "2026-11-23T19:21:00Z",
    actor_name: "Keller Marco",
    source: "feld",
    ...overrides,
  })

  it("says who, through which door, which field, and old → new in the field's own words", () => {
    const [relevant, dangers, photos, text, kp] = renderTimeline([
      change({ reko_field: "is_relevant", old_value: null, new_value: true }),
      change({ reko_field: "dangers", old_value: ["fire"], new_value: ["collapse"] }),
      change({ reko_field: "photos", old_value: [], new_value: ["a.jpg", "b.jpg"] }),
      change({
        reko_field: "summary_text",
        old_value: "Unterführung ca. 80 cm unter Wasser, 1 PW steckt fest.",
        new_value: "Unterführung ca. 80 cm unter Wasser, 1 PW steckt fest, Lenker ausgestiegen.",
      }),
      change({ reko_field: "power_supply", old_value: null, new_value: "emergency_needed", source: "kp", actor_name: "B. Eichenberger" }),
    ])
    expect(relevant).toHaveTextContent("Keller Marco (Feld) · Einsatz relevant?: leer→Ja")
    expect(dangers).toHaveTextContent("Gefahren: +Einsturz · −Feuer")
    expect(photos).toHaveTextContent("Fotos: +2 Fotos")
    // A long text is cut to what changed.
    expect(text).toHaveTextContent("Zusammenfassung: «… steckt fest.»→«… steckt fest, Lenker ausgestiegen.»")
    expect(kp).toHaveTextContent("B. Eichenberger (KP) · Stromversorgung: leer→Notstrom nötig")
  })
})
