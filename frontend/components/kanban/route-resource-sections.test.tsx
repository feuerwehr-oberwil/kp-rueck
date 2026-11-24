import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import de from "@/messages/de.json"
import { RouteResourceSections } from "./route-resource-sections"
import type { GroupResources } from "@/lib/types/groups"

const resources: GroupResources = {
  personnel: [],
  vehicles: [
    { assignmentId: "a1", resourceId: "v1", name: "TLF" },
    { assignmentId: "a2", resourceId: "v2", name: "Pio" },
  ],
  materials: [],
}

function renderSections(props: Partial<React.ComponentProps<typeof RouteResourceSections>> = {}) {
  return render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      <RouteResourceSections resources={resources} onAssign={vi.fn()} onUnassign={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  )
}

describe("RouteResourceSections — driverless route vehicle", () => {
  it("reminds in amber and makes «Fahrer wählen» one tap", async () => {
    const onPickDriver = vi.fn()
    renderSections({ vehicleDrivers: new Map([["v2", { name: "Meier", personnelId: "p-meier" }]]), onPickDriver })

    expect(screen.getByText("(Meier)").parentElement).toHaveTextContent("Pio (Meier)")
    const pick = screen.getByRole("button", { name: "Kein Fahrer – Fahrer für TLF wählen" })
    expect(screen.getAllByText("Kein Fahrer")).toHaveLength(1)
    await userEvent.click(pick)
    expect(onPickDriver).toHaveBeenCalledWith({ resourceId: "v1", name: "TLF" })
  })

  it("says nothing before the driver map has loaded", () => {
    renderSections({ vehicleDrivers: new Map(), driversKnown: false, onPickDriver: vi.fn() })
    expect(screen.queryByText("Kein Fahrer")).not.toBeInTheDocument()
  })

  it("read-only shows the note without the action", () => {
    renderSections({ vehicleDrivers: new Map(), readOnly: true, onPickDriver: vi.fn() })
    expect(screen.getAllByText("Kein Fahrer")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: /Fahrer für/ })).not.toBeInTheDocument()
  })
})

describe("RouteResourceSections — the vehicle chip menu (owner pick 2B)", () => {
  it("«Fahrer ändern …» opens the driver picker, «Fahrer bleibt vor Ort» writes the route flag", async () => {
    const onPickDriver = vi.fn()
    const onSetDriverStay = vi.fn()
    renderSections({
      resources: { ...resources, vehicles: [{ assignmentId: "a2", resourceId: "v2", name: "Pio", driverStay: false }] },
      vehicleDrivers: new Map([["v2", { name: "Meier", personnelId: "p-meier" }]]),
      onPickDriver,
      onSetDriverStay,
    })
    await userEvent.click(screen.getByRole("button", { name: /^Pio ?\(Meier\)$/ }))
    const driverRow = await screen.findByRole("menuitem", { name: /^Fahrer ändern …/ })
    expect(driverRow).toHaveTextContent("Meier")
    await userEvent.click(driverRow)
    expect(onPickDriver).toHaveBeenCalledWith({ resourceId: "v2", name: "Pio" })

    await userEvent.click(screen.getByRole("button", { name: /^Pio ?\(Meier\)$/ }))
    const stay = await screen.findByRole("menuitemcheckbox", { name: "Fahrer bleibt vor Ort" })
    expect(stay).toHaveAttribute("aria-checked", "false")
    await userEvent.click(stay)
    expect(onSetDriverStay).toHaveBeenCalledWith("a2", true)
  })

  it("read-only: no chip menu", () => {
    renderSections({ vehicleDrivers: new Map(), readOnly: true, onPickDriver: vi.fn(), onSetDriverStay: vi.fn() })
    expect(screen.queryByRole("button", { name: "TLF" })).not.toBeInTheDocument()
  })
})
