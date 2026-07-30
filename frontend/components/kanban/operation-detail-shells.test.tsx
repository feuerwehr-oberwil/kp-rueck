import { beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, screen, waitFor } from "@testing-library/react"
import { renderWithIntl } from "@/test-utils/render-with-intl"
import type { Operation, Material } from "@/lib/contexts/operations-context"

const renderedDetailProps = vi.hoisted(() => [] as Array<Record<string, unknown>>)

vi.mock("@/components/kanban/operation-detail-content", () => ({
  OperationDetailContent: (props: Record<string, unknown>) => {
    renderedDetailProps.push(props)
    return <div data-testid="shared-operation-detail">shared detail</div>
  },
}))

vi.mock("@/lib/contexts/event-context", () => ({
  useEvent: () => ({ selectedEvent: { id: "event-1" } }),
}))

vi.mock("next/dynamic", () => ({ default: () => () => null }))

import { OperationDetailModal } from "@/components/kanban/operation-detail-modal"
import { SidePanel } from "@/components/kanban/side-panel"

const operation: Operation = {
  id: "incident-1",
  location: "Hauptstrasse 1",
  vehicle: null,
  vehicles: [],
  incidentType: "brand",
  dispatchTime: new Date("2026-07-23T10:00:00Z"),
  crew: [],
  priority: "high",
  status: "incoming",
  coordinates: null,
  materials: [],
  notes: "Meldung",
  contact: "",
  contactPhone: "",
  internalNotes: "",
  nachbarhilfe: false,
  nachbarhilfeNote: "",
  amWarten: false,
  amWartenNote: "",
  zuFuss: false,
  groupId: null,
  groupPosition: 0,
  statusChangedAt: null,
  hasCompletedReko: false,
  rekoArrivedAt: null,
  rekoSummary: null,
  assignedReko: null,
  crewAssignments: new Map(),
  materialAssignments: new Map(),
  vehicleAssignments: new Map(),
  vehicleCallsigns: new Map(),
  vehicleDriverStay: new Map(),
}

const materials: Material[] = []
const noop = vi.fn()
const sharedCapabilities = {
  materials,
  onUpdate: noop,
  onDelete: noop,
  onAssignVehicle: noop,
  onRemoveVehicle: noop,
  onAssignResource: noop,
  onRemoveCrew: noop,
  onRemoveMaterial: noop,
  canEdit: true,
  diveraEnabled: true,
  onSendDivera: noop,
  onRequestComplete: noop,
  onDistributeToAuftrag: noop,
  onChangeStatus: noop,
}

beforeEach(() => {
  renderedDetailProps.length = 0
  noop.mockClear()
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 })
})

describe("incident detail shells", () => {
  it("renders the same shared semantic content and action capabilities in modal and panel", async () => {
    renderWithIntl(
      <OperationDetailModal
        operation={operation}
        open
        onOpenChange={noop}
        {...sharedCapabilities}
      />,
    )

    expect(screen.getByTestId("shared-operation-detail")).toBeInTheDocument()
    const modalProps = renderedDetailProps.at(-1)!
    cleanup()

    renderWithIntl(
      <SidePanel
        mode="detail"
        onModeChange={noop}
        selectedOperation={operation}
        operations={[operation]}
        onSelectOperation={noop}
        {...sharedCapabilities}
      />,
    )

    await waitFor(() => expect(screen.getByTestId("shared-operation-detail")).toBeInTheDocument())
    expect(noop).not.toHaveBeenCalled()
    const panelProps = renderedDetailProps.at(-1)!

    const semanticProps = (props: Record<string, unknown>) => {
      const { layout: _layout, active: _active, ...shared } = props
      return shared
    }

    expect(modalProps.layout).toBe("modal")
    expect(panelProps.layout).toBe("panel")
    expect(semanticProps(panelProps)).toEqual(semanticProps(modalProps))
    expect(Object.keys(semanticProps(panelProps)).sort()).toEqual(
      ["operation", ...Object.keys(sharedCapabilities)].sort(),
    )
  })

  it("collapses an open side panel below the wide-screen breakpoint", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 })

    renderWithIntl(
      <SidePanel
        mode="detail"
        onModeChange={noop}
        selectedOperation={operation}
        operations={[operation]}
        onSelectOperation={noop}
        {...sharedCapabilities}
      />,
    )

    await waitFor(() => expect(noop).toHaveBeenCalledWith("collapsed"))
    expect(screen.queryByTestId("shared-operation-detail")).not.toBeInTheDocument()
  })
})
