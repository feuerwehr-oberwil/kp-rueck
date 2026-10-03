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
    renderSections({ vehicleDrivers: new Map([["Pio", "Meier"]]), onPickDriver })

    expect(screen.getByText("Pio (Meier)")).toBeInTheDocument()
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
