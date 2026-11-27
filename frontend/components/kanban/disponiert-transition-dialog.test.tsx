import { describe, expect, it, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { Operation } from "@/lib/contexts/operations-context"
import { DisponierTransitionDialog } from "./disponiert-transition-dialog"
import { makeOperation } from "@/test-utils/operation-fixtures"

/**
 * The Funkdurchsage of an Auftrag stop is recorded as SPOKEN only with «Durchgegeben»
 * (hunt 2026-11-24): the record decides whether the next stop gets the short
 * continuation, so opening the dialog – or closing it unread – must not claim it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({}) }))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock("@/lib/hooks/use-vehicle-drivers", () => ({ useVehicleDriverState: () => ({ drivers: new Map(), loaded: true }) }))
const recordAnnouncement = vi.hoisted(() => vi.fn())
const groups = [{ id: "g", name: "Testauftrag", stopIds: ["first", "second"], lastAnnounced: null }]
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ groups, recordAnnouncement }),
}))
vi.mock("@/lib/contexts/operations-context", () => ({ useOperations: () => ({ operations: stops }) }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }))
const copyToClipboard = vi.hoisted(() => vi.fn())
vi.mock("@/lib/utils", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/utils")>(), copyToClipboard }))
vi.mock("@/lib/message-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/message-template")>()
  return {
    ...actual,
    getMessageTemplates: async () => ({
      whatsappIncident: actual.DEFAULT_WHATSAPP_INCIDENT_TEMPLATE,
      alarmTitle: actual.DEFAULT_ALARM_TITLE_TEMPLATE,
      alarmText: actual.DEFAULT_ALARM_TEXT_TEMPLATE,
    }),
  }
})

function stop(id: string, index: number): Operation {
  return makeOperation({
    id,
    location: `Hauptstrasse ${index + 1}`,
    dispatchTime: new Date("2026-07-23T10:00:00Z"),
    status: index === 0 ? "enroute" : "incoming",
    groupId: "g",
    groupPosition: index,
    auftragResources: { personnel: [], vehicles: [], materials: [] },
  })
}
const stops = ["first", "second"].map(stop)

describe("DisponierTransitionDialog — Funkdurchsage recorded only when spoken", () => {
  beforeEach(() => recordAnnouncement.mockClear())

  it.each([false, true])("opening and closing records nothing (repeat=%s)", async (repeat) => {
    const onOpenChange = vi.fn()
    renderWithIntl(
      <DisponierTransitionDialog open onOpenChange={onOpenChange} operation={stops[0]} materials={[]} repeat={repeat} />,
    )
    // The footer «Schliessen» (the ✕ in the corner is the other one).
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Schliessen" }).at(-1)!)

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(recordAnnouncement).not.toHaveBeenCalled()
  })

  it("«Durchgegeben» records the text on screen once and keeps the dialog open", async () => {
    const onOpenChange = vi.fn()
    renderWithIntl(
      <DisponierTransitionDialog open onOpenChange={onOpenChange} operation={stops[0]} materials={[]} />,
    )
    await userEvent.setup().click(screen.getByRole("button", { name: "Durchgegeben" }))

    expect(recordAnnouncement).toHaveBeenCalledExactlyOnceWith("g", {
      stopId: "first",
      full: true,
      fingerprint: expect.any(String),
    })
    // The batch offer and the Aufgebot are still to come; the button is done.
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Durchgegeben" })).toBeDisabled()
  })
})

describe("DisponierTransitionDialog — WhatsApp copy", () => {
  it("a refused clipboard says so instead of nothing", async () => {
    copyToClipboard.mockRejectedValueOnce(new Error("NotAllowedError"))
    renderWithIntl(<DisponierTransitionDialog open onOpenChange={vi.fn()} operation={stops[0]} materials={[]} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "WhatsApp-Nachricht kopieren" }))

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Nicht kopiert", {
        description: "Die Nachricht konnte nicht in die Zwischenablage kopiert werden.",
      }),
    )
  })
})
