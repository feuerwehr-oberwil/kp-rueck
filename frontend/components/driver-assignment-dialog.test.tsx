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
const updatePersonnel = vi.hoisted(() => vi.fn())
const refreshOperations = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())

vi.mock("@/lib/contexts/operations-context", () => ({
  useOperations: () => ({ refreshOperations }),
}))

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    createPersonnel,
    checkInPersonnelForEvent,
    checkInPersonnel,
    generateCheckInLink,
    assignSpecialFunction,
    unassignSpecialFunction,
    updatePersonnel,
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

const renderDialog = (personnel: Person[] = []) =>
  renderWithIntl(
    <DriverAssignmentDialog
      open
      onOpenChange={vi.fn()}
      vehicleId="vehicle-1"
      vehicleName="TLF"
      eventId="event-1"
      currentDriverId={null}
      currentDriverName={null}
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
  updatePersonnel.mockReset().mockResolvedValue({})
  refreshOperations.mockReset().mockResolvedValue(undefined)
  toastError.mockReset()
  toastSuccess.mockReset()
})

describe("DriverAssignmentDialog walk-in", () => {
  it("checks the walk-in in through the editor's own door, not a public share token", async () => {
    renderDialog()
    await addWalkIn("Aushilfe Anna")

    await waitFor(() => expect(assignSpecialFunction).toHaveBeenCalledTimes(1))
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
    expect(toastError.mock.calls[0][0]).toBe("Anmeldung fehlgeschlagen")
    expect(toastError.mock.calls[0][1].description).toContain("Aushilfe Anna")
    // The Personal list IS the checked-in roster: a person who is not checked in
    // must not quietly become the driver of a vehicle.
    expect(assignSpecialFunction).not.toHaveBeenCalled()
  })
})

describe("DriverAssignmentDialog layout", () => {
  it("bounds its height so the add form cannot push the dialog over the footer", async () => {
    const user = userEvent.setup()
    renderDialog(Array.from({ length: 40 }, (_, i) => person(`p${i}`, `Fahrer ${i}`)))

    const content = document.querySelector('[data-slot="dialog-content"]')
    expect(content).not.toBeNull()
    expect(content).toHaveClass("modal-h-tall")
    expect(content).toHaveClass("flex")
    expect(content).toHaveClass("flex-col")

    // The list is the only part that grows, and it scrolls inside the panel.
    const scroller = screen.getByTestId("driver-list")
    expect(scroller).toHaveClass("flex-1")
    expect(scroller).toHaveClass("min-h-0")
    expect(scroller).toHaveClass("overflow-y-auto")
    expect(scroller.className).not.toContain("h-[300px]")

    // Opening the add form keeps the header and both primary actions mounted.
    await user.click(screen.getByRole("button", { name: "Person hinzufügen" }))
    expect(screen.getByText("Fahrer für TLF")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Hinzufügen & als Fahrer/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Schliessen" })).toBeInTheDocument()
  })
})
