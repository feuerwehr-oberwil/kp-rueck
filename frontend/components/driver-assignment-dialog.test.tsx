import { beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { Person } from "@/lib/contexts/personnel-context"

const createPersonnel = vi.hoisted(() => vi.fn())
const checkInPersonnelForEvent = vi.hoisted(() => vi.fn())
const checkInPersonnel = vi.hoisted(() => vi.fn())
const generateCheckInLink = vi.hoisted(() => vi.fn())
const assignSpecialFunction = vi.hoisted(() => vi.fn())
const unassignSpecialFunction = vi.hoisted(() => vi.fn())
const refreshOperations = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ refreshOperations, operations: [], personnel: [] }),
}))
vi.mock("@/lib/contexts/groups-context", () => ({ useGroups: () => ({ groups: [] }) }))

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    createPersonnel,
    checkInPersonnelForEvent,
    checkInPersonnel,
    generateCheckInLink,
    assignSpecialFunction,
    unassignSpecialFunction,
  },
}))

vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }))

import { DriverAssignmentDialog } from "@/components/driver-assignment-dialog"

const person = (id: string, name: string): Person => ({
  id,
  name,
  role: "AdF",
  status: "available",
  roleSortOrder: 0,
  tags: ["F"],
})

const renderDialog = (personnel: Person[] = [], current: Person | null = null) =>
  renderWithIntl(
    <DriverAssignmentDialog
      open
      onOpenChange={vi.fn()}
      vehicleId="vehicle-1"
      vehicleName="TLF"
      eventId="event-1"
      currentDriverId={current?.id ?? null}
      currentDriverName={current?.name ?? null}
      personnel={personnel}
      operations={[]}
      specialFunctions={[]}
      onDriverAssigned={vi.fn()}
      removeCrew={vi.fn()}
    />,
  )

const addWalkIn = async (name: string) => {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: "Person hinzufügen" }))
  await user.type(screen.getByPlaceholderText("Name der Person"), name)
  await user.click(screen.getByRole("button", { name: /Hinzufügen & als Fahrer/ }))
}

beforeEach(() => {
  createPersonnel.mockReset().mockResolvedValue({ id: "walk-in", name: "Aushilfe Anna", tags: ["F"] })
  checkInPersonnelForEvent.mockReset().mockResolvedValue({})
  checkInPersonnel.mockReset().mockResolvedValue({})
  generateCheckInLink.mockReset().mockResolvedValue({ token: "tok" })
  assignSpecialFunction.mockReset().mockResolvedValue({})
  unassignSpecialFunction.mockReset().mockResolvedValue(undefined)
  refreshOperations.mockReset().mockResolvedValue(undefined)
  toastError.mockReset()
  toastSuccess.mockReset()
})

describe("DriverAssignmentDialog walk-in", () => {
  it("checks the walk-in in through the editor's own door, not a public share token", async () => {
    renderDialog()
    await addWalkIn("Aushilfe Anna")

    await waitFor(() => expect(assignSpecialFunction).toHaveBeenCalledTimes(1))
    // A guest of this Ereignis, not a roster row for ever (#5, 19.11.2026).
    expect(createPersonnel).toHaveBeenCalledWith(expect.objectContaining({ guest_event_id: "event-1" }))
    expect(checkInPersonnelForEvent).toHaveBeenCalledWith("walk-in", "event-1")
    // Minting a login-less link for the whole Ereignis to register one person is
    // not the price of adding a driver.
    expect(generateCheckInLink).not.toHaveBeenCalled()
    expect(checkInPersonnel).not.toHaveBeenCalled()
    expect(assignSpecialFunction).toHaveBeenCalledWith("event-1", {
      personnel_id: "walk-in",
      function_type: "driver",
      vehicle_id: "vehicle-1",
    })
  })

  it("surfaces a failed check-in instead of swallowing it, and does not assign an invisible driver", async () => {
    checkInPersonnelForEvent.mockRejectedValueOnce(new Error("check-in failed"))
    renderDialog()
    await addWalkIn("Aushilfe Anna")

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    expect(toastError.mock.calls[0][0]).toBe("Check-in fehlgeschlagen")
    expect(toastError.mock.calls[0][1].description).toContain("Aushilfe Anna")
    // The Personal list IS the checked-in roster: a person who is not checked in
    // must not quietly become the driver of a vehicle.
    expect(assignSpecialFunction).not.toHaveBeenCalled()
  })
})

describe("DriverAssignmentDialog layout", () => {
  // The height bound itself (`modal-h-tall`, the list as the only scroller) is geometry jsdom
  // cannot measure, so it is not asserted here. What is left to pin: opening the form takes
  // nothing away.
  it("keeps the header and both actions when the add form opens over a long list", async () => {
    const user = userEvent.setup()
    renderDialog(Array.from({ length: 40 }, (_, i) => person(`p${i}`, `Fahrer ${i}`)))

    await user.click(screen.getByRole("button", { name: "Person hinzufügen" }))
    expect(screen.getByText("Fahrer für TLF")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Hinzufügen & als Fahrer/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Übernehmen" })).toBeInTheDocument()
  })
})

describe("DriverAssignmentDialog choice", () => {
  // A tap only ticks – a mistap must not already be the vehicle's driver.
  it("assigns the ticked person on «Übernehmen», not on the tap", async () => {
    const user = userEvent.setup()
    renderDialog([person("p1", "Brunner Sara")])

    await user.click(screen.getByRole("radio", { name: /Brunner Sara/ }))
    expect(assignSpecialFunction).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Übernehmen" }))

    await waitFor(() => expect(assignSpecialFunction).toHaveBeenCalledWith("event-1", {
      personnel_id: "p1",
      function_type: "driver",
      vehicle_id: "vehicle-1",
    }))
  })

  it("unticking the current driver offers «Ohne Fahrer», which removes them after the confirm", async () => {
    const user = userEvent.setup()
    const meier = person("p2", "Meier Alex")
    renderDialog([meier], meier)

    const tile = screen.getByRole("radio", { name: /Meier Alex/ })
    expect(tile).toHaveAttribute("aria-checked", "true")
    expect(tile).toHaveTextContent("aktuell")
    await user.click(tile)
    await user.click(screen.getByRole("button", { name: "Ohne Fahrer" }))
    await user.click(screen.getByRole("button", { name: "Fahrer entfernen" }))

    await waitFor(() => expect(unassignSpecialFunction).toHaveBeenCalledWith("event-1", {
      personnel_id: "p2",
      function_type: "driver",
      vehicle_id: "vehicle-1",
    }))
    expect(assignSpecialFunction).not.toHaveBeenCalled()
  })
})

describe("DriverAssignmentDialog while the driver data loads", () => {
  const dialog = (props: { currentDriver?: Person | null; driversPending?: { status: "loading" } | { status: "failed"; retry: () => void } }) => (
    <DriverAssignmentDialog
      open
      onOpenChange={vi.fn()}
      vehicleId="vehicle-1"
      vehicleName="TLF"
      eventId="event-1"
      currentDriverId={props.currentDriver?.id ?? null}
      currentDriverName={props.currentDriver?.name ?? null}
      personnel={[person("p-1", "Brunner Sara"), person("p-2", "Meier Alex")]}
      operations={[]}
      specialFunctions={[]}
      driversPending={props.driversPending}
      onDriverAssigned={vi.fn()}
      removeCrew={vi.fn()}
    />
  )

  it("offers no tile and no «Übernehmen» until it knows who drives", () => {
    renderWithIntl(dialog({ driversPending: { status: "loading" } }))
    expect(screen.getByRole("status")).toHaveTextContent("Fahrer werden geladen …")
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Person hinzufügen" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Übernehmen" })).toBeDisabled()
    // A driver may well be assigned – the header must not say there is none.
    expect(screen.queryByText("Kein Fahrer zugewiesen")).not.toBeInTheDocument()
  })

  it("says a failed load and retries it", async () => {
    const retry = vi.fn()
    renderWithIntl(dialog({ driversPending: { status: "failed", retry } }))
    expect(screen.getByText("Die Fahrer konnten nicht geladen werden.")).toBeInTheDocument()
    expect(screen.queryByText("Kein Fahrer zugewiesen")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it("a driver update arriving later keeps the tile the operator ticked", async () => {
    const user = userEvent.setup()
    const view = renderWithIntl(dialog({}))
    await user.click(screen.getByRole("radio", { name: /Brunner Sara/ }))
    view.rerender(dialog({ currentDriver: person("p-2", "Meier Alex") }))
    expect(screen.getByRole("radio", { name: /Brunner Sara/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: /Meier Alex/ })).toHaveAttribute("aria-checked", "false")
  })

  it("an untouched picker follows the driver that arrives", () => {
    const view = renderWithIntl(dialog({ driversPending: { status: "loading" } }))
    view.rerender(dialog({ currentDriver: person("p-2", "Meier Alex") }))
    expect(screen.getByRole("radio", { name: /Meier Alex/ })).toHaveAttribute("aria-checked", "true")
  })
})
