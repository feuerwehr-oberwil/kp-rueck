import { afterEach, describe, expect, it, vi } from "vitest"
import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { renderWithIntl } from "@/test-utils/render-with-intl"

import type { Material } from "@/lib/contexts/materials-context"
import type { Person } from "@/lib/contexts/operations-context"

/**
 * Why an assignment list is empty (#3). Four reasons, four sentences — and the
 * bug that started it: «Nur zugewiesene» on an Einsatz without a vehicle said
 * «Alle Fahrzeuge sind bereits zugewiesen», which was simply not true.
 */

const operationsState = vi.hoisted(() => ({
  operations: [] as unknown[],
  outOfServiceVehicleIds: new Set<string>(),
}))
vi.mock("@/lib/contexts/operations-context", () => ({ useOperations: () => operationsState }))
vi.mock("@/lib/contexts/materials-context", () => ({ useMaterials: () => ({ materialGroups: [] }) }))
vi.mock("@/lib/contexts/groups-context", () => ({
  useGroups: () => ({ groups: [], getGroupResources: () => ({ vehicles: [], personnel: [], materials: [] }) }),
}))
vi.mock("@/lib/contexts/event-context", () => ({ useEvent: () => ({ selectedEvent: null }) }))
vi.mock("@/lib/hooks/use-vehicle-drivers", () => ({ useVehicleDrivers: () => new Map() }))

import { ResourceAssignmentDialog } from "@/components/kanban/resource-assignment-dialog"

type Props = ComponentProps<typeof ResourceAssignmentDialog>

function renderDialog(over: Partial<Props>) {
  const props: Props = {
    open: true,
    onOpenChange: vi.fn(),
    resourceType: "vehicles",
    operationId: "incident-1",
    personnel: [],
    vehicles: [],
    materials: [],
    assignedPersonnel: [],
    assignedVehicles: [],
    assignedMaterials: [],
    onAssignPerson: vi.fn(),
    onAssignVehicle: vi.fn(),
    onAssignMaterial: vi.fn(),
    onRemovePerson: vi.fn(),
    onRemoveVehicle: vi.fn(),
    onRemoveMaterial: vi.fn(),
    ...over,
  }
  return { ...renderWithIntl(<ResourceAssignmentDialog {...props} />), props }
}

const TLF = { id: "v1", name: "TLF", type: "TLF" }
const MTW = { id: "v2", name: "MTW 1", type: "MTW" }
const person = (name: string, over: Partial<Person> = {}): Person =>
  ({ id: name, name, role: "Soldat", status: "available", ...over }) as Person
const material = (over: Partial<Material>): Material => ({
  id: "m1",
  name: "Tauchpumpe Gr.",
  category: "Magazin",
  type: "Tauchpumpen",
  status: "available",
  outOfService: false,
  outOfServiceSince: null,
  categorySortOrder: 0,
  consumable: false,
  groupId: null,
  ...over,
})

describe("(a) a filter emptied the list", () => {
  it("says «Keine Treffer», names the filter — not «alle bereits zugewiesen»", async () => {
    const user = userEvent.setup()
    renderDialog({ vehicles: [TLF, MTW], onToggleZuFuss: vi.fn() })

    await user.click(screen.getByRole("button", { name: "Nur zugewiesene" }))

    const empty = screen.getByRole("status")
    expect(within(empty).getByText("Keine Treffer")).toBeDefined()
    expect(empty.textContent).toContain("«Nur zugewiesene»")
    expect(empty.textContent).toContain("diesem Einsatz ist noch keines zugewiesen")
    expect(document.body.textContent).not.toContain("bereits zugewiesen")
  })

  it("hides the «Zu Fuss» pseudo-row and «Verfügbar · 0» while filtered empty", async () => {
    const user = userEvent.setup()
    renderDialog({ vehicles: [TLF], onToggleZuFuss: vi.fn() })
    expect(screen.getByText("Zu Fuss")).toBeDefined()

    await user.click(screen.getByRole("button", { name: "Nur zugewiesene" }))

    expect(screen.queryByText("Zu Fuss")).toBeNull()
    expect(screen.queryByText(/Verfügbar · 0/)).toBeNull()
  })

  it("«Filter zurücksetzen» lifts the filters and keeps the search and the ticks", async () => {
    const user = userEvent.setup()
    renderDialog({
      resourceType: "crew",
      personnel: [person("Frei Anna"), person("Egger Olivier", { role: "Offizier" })],
    })

    await user.click(screen.getByRole("button", { name: /Frei Anna/ })) // tick
    await user.type(screen.getByPlaceholderText("Person suchen …"), "frei")
    await user.click(screen.getByRole("button", { name: "Offizier" })) // hides Anna

    const empty = screen.getByRole("status")
    expect(empty.textContent).toContain("«Offizier»")
    expect(empty.textContent).toContain("«frei»")

    await user.click(within(empty).getByRole("button", { name: "Filter zurücksetzen" }))

    expect(screen.getByPlaceholderText("Person suchen …")).toHaveValue("frei")
    expect(screen.getByRole("button", { name: /Frei Anna/ })).toBeDefined()
    expect(screen.getByText(/1 ausgewählt/)).toBeDefined()
  })
})

describe("(b) the search found nothing", () => {
  it("says «Keine Treffer für «xyz».» and «Suche leeren» empties it and keeps the cursor", async () => {
    const user = userEvent.setup()
    renderDialog({ resourceType: "crew", personnel: [person("Frei Anna")] })

    const field = screen.getByPlaceholderText("Person suchen …")
    await user.type(field, "xyz")

    const empty = screen.getByRole("status")
    expect(within(empty).getByText("Keine Treffer für «xyz».")).toBeDefined()
    expect(empty.textContent).toContain("Gesucht wird in Name, Grad")

    await user.click(within(empty).getByRole("button", { name: "Suche leeren" }))
    expect(field).toHaveValue("")
    expect(field).toHaveFocus()
    expect(screen.getByRole("button", { name: /Frei Anna/ })).toBeDefined()
  })

  it("wins over a filter when the search alone already matches nothing", async () => {
    const user = userEvent.setup()
    renderDialog({ vehicles: [TLF, MTW] })

    await user.click(screen.getByRole("button", { name: "MTW" }))
    await user.type(screen.getByPlaceholderText("Fahrzeug suchen …"), "xyz")

    expect(screen.getByText("Keine Treffer für «xyz».")).toBeDefined()
    expect(screen.queryByRole("button", { name: "Filter zurücksetzen" })).toBeNull()
  })
})

describe("(c) there is truly nothing", () => {
  it("nobody checked in: says so, and offers the check-in link (closing the dialog first)", async () => {
    const user = userEvent.setup()
    const onShowCheckIn = vi.fn()
    const { props } = renderDialog({ resourceType: "crew", personnel: [], onShowCheckIn })

    const empty = screen.getByRole("status")
    expect(within(empty).getByText("Noch niemand eingecheckt.")).toBeDefined()
    expect(empty.textContent).toContain("«Links & QR»")

    await user.click(within(empty).getByRole("button", { name: "Check-in-Link zeigen" }))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(onShowCheckIn).toHaveBeenCalled()
  })

  it("without a link sheet the sentence still says where the link is", () => {
    renderDialog({ resourceType: "crew", personnel: [] })
    expect(screen.queryByRole("button", { name: "Check-in-Link zeigen" })).toBeNull()
    expect(screen.getByText(/«Links & QR»/)).toBeDefined()
  })

  it("no fleet at all keeps «Zu Fuss» — walking is still a choice", () => {
    renderDialog({ vehicles: [], onToggleZuFuss: vi.fn() })
    expect(screen.getByText("Keine Fahrzeuge erfasst.")).toBeDefined()
    expect(screen.getByText("Zu Fuss")).toBeDefined()
  })
})

describe("(d) everything is taken", () => {
  it("keeps the spoken-for list and says in one line that nothing is free", () => {
    operationsState.operations = [
      { id: "other", location: "Hauptstrasse 41", incidentType: "brand", vehicles: [], materials: ["m1"], crew: [] },
    ]
    try {
      renderDialog({ resourceType: "materials", materials: [material({ id: "m1" })] })

      expect(screen.getByText(/Kein Material ist frei/)).toBeDefined()
      expect(screen.getByText(/Bereits im Einsatz · 1/)).toBeDefined()
      expect(screen.getByRole("button", { name: /Tauchpumpe Gr\./ })).toBeDefined()
      expect(screen.queryByRole("status")).toBeNull()
    } finally {
      operationsState.operations = []
    }
  })
})

describe("compact filters on a small screen (#24)", () => {
  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })
  function smallScreen() {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
  }

  const materials = [
    material({ id: "m1", category: "Bühne", type: "Tauchpumpen" }),
    material({ id: "m2", name: "Wassersauger", category: "Depot", type: "Wassersauger" }),
  ]

  it("folds the chip rows into one «Filtern» menu", () => {
    smallScreen()
    renderDialog({ resourceType: "materials", materials })

    expect(screen.getByRole("button", { name: "Filtern" })).toBeDefined()
    expect(screen.queryByText("Nach Typ:")).toBeNull()
    expect(screen.queryByRole("button", { name: "Bühne" })).toBeNull()
  })

  it("shows the active count and a readable summary with a one-step reset", async () => {
    const user = userEvent.setup()
    smallScreen()
    renderDialog({ resourceType: "materials", materials })

    await user.click(screen.getByRole("button", { name: "Filtern" }))
    await user.click(await screen.findByRole("menuitemradio", { name: "Depot" }))
    await user.keyboard("{Escape}")

    expect(screen.getByRole("button", { name: /Filtern, 1 Filter aktiv/ })).toBeDefined()
    const summary = screen.getByTestId("filter-summary")
    expect(summary.textContent).toContain("Gefiltert: Depot")
    expect(screen.queryByRole("button", { name: /Tauchpumpe Gr\./ })).toBeNull()

    await user.click(within(summary).getByRole("button", { name: "Filter zurücksetzen" }))
    expect(screen.getByRole("button", { name: /Tauchpumpe Gr\./ })).toBeDefined()
    expect(screen.queryByTestId("filter-summary")).toBeNull()
  })

  it("keeps the desktop chips where there is room", () => {
    renderDialog({ resourceType: "materials", materials })
    expect(screen.queryByRole("button", { name: "Filtern" })).toBeNull()
    expect(screen.getByRole("button", { name: "Bühne" })).toBeDefined()
  })
})
