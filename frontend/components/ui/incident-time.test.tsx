import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"

const mode = vi.hoisted(() => ({ value: "column" as "start" | "column" | "total" }))
vi.mock("@/lib/hooks/use-incident-time-mode", () => ({
  useIncidentTimeMode: () => ({ mode: mode.value, setMode: vi.fn() }),
}))

import { IncidentTime } from "./incident-time"

const H = 3_600_000

function renderChip(statusAgeMs: number, readOnly = false) {
  const now = Date.now()
  const operation = { dispatchTime: new Date(now - statusAgeMs - H), statusChangedAt: new Date(now - statusAgeMs) }
  return render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      <IncidentTime operation={operation} readOnly={readOnly} colorByAge />
    </NextIntlClientProvider>,
  )
}

describe("IncidentTime on a multi-day Einsatz", () => {
  it("shows «1d 10h» and names the full duration and the original time for a screen reader", () => {
    renderChip(34 * H + 12 * 60_000)
    const chip = screen.getByRole("button")
    expect(chip).toHaveTextContent("1d 10h")
    expect(chip.getAttribute("aria-label")).toMatch(/^Seit Statuswechsel 1 Tag 10 Stunden, seit \d/)
    expect(chip.getAttribute("title")).toMatch(/^Zeit in diesem Status: 1 Tag 10 Stunden \(seit /)
  })

  it("keeps the short notation below a day and the read-only chip gets the same name", () => {
    renderChip(59 * 60_000, true)
    expect(screen.getByText("59'")).toBeInTheDocument()
    expect(screen.getByText(/^Seit Statuswechsel 59 Minuten, seit /)).toHaveClass("sr-only")
  })
})
