import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation, Person } from '@/lib/contexts/operations-context'
import type { ResourceBinding } from '@/lib/board-sidebar'
import { REKO_TARGET, RESOURCES_TARGET } from '@/lib/detail-target'
import { ApiError } from '@/lib/api/types'

const { api, undoToast, toastError, toastSuccess, refresh, board } = vi.hoisted(() => ({
  api: {
    checkOutPersonnelForEvent: vi.fn(),
    checkInPersonnelForEvent: vi.fn(),
    setAttendancePlan: vi.fn(),
    assignSpecialFunction: vi.fn(),
    unassignSpecialFunction: vi.fn(),
  },
  undoToast: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  refresh: { operations: vi.fn(), groups: vi.fn() },
  board: { operations: [] as Operation[], personnel: [] as Person[], drivers: new Map<string, { name: string; personnelId: string }>() },
}))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('@/lib/toast-undo', () => ({ undoToast }))
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))
vi.mock('@/lib/contexts/operations-context', () => ({
  useOperations: () => ({
    operations: board.operations,
    personnel: board.personnel,
    vehicles: [
      { id: 'v-trawa', name: 'Trawa', display_order: 1 },
      { id: 'v-tlf', name: 'TLF', display_order: 2 },
    ],
    removeCrew: vi.fn(),
    removeReko: vi.fn(),
    refreshOperations: refresh.operations,
  }),
}))
vi.mock('@/lib/contexts/groups-context', () => ({
  useGroups: () => ({ getGroupResources: () => ({ personnel: [] }), refreshGroups: refresh.groups }),
}))
vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: { id: 'event-1' } }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => board.drivers }))
// The Reko hand-over is not under test here and needs the whole board.
vi.mock('@/components/kanban/transfer-reko-dialog', () => ({ TransferRekoDialog: () => null }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => false }))

import { PersonPopoverBody } from '@/components/board/person-popover'

const op14 = {
  id: 'op-14',
  number: 14,
  location: 'Poststrasse 6, 4104 Oberwil',
  locationDisplay: 'Poststrasse 6',
  incidentType: 'elementarereignis',
  notes: 'Tiefgarage ca. 40 cm unter Wasser.',
  status: 'disponiert',
  crew: [{ personnelId: 'p-peter' }],
  vehicles: [{ vehicleId: 'v-trawa' }],
} as unknown as Operation

const crewBinding: ResourceBinding = {
  key: 'incident-op-14',
  kind: 'incident',
  targetId: 'op-14',
  label: '14 · Poststrasse 6',
  detail: 'Mannschaft',
  target: RESOURCES_TARGET,
}

function person(extra: Partial<Person>): Person {
  return { id: 'p-sina', name: 'Unternährer Sina', role: 'Mannschaft', status: 'available', roleSortOrder: 1, checkedInAt: '2026-11-24T16:08:00Z', ...extra }
}

const release = { releaseCrew: vi.fn(), releaseRouteResource: vi.fn() }

/** Remounts the body, as the sidebar does when a person moves from «Frei» to «Gebunden». */
let remount = () => {}

/** The sidebar's part: it holds the check-out question, above the remounting body. */
function Sidebar({ who, places, onClose }: { who: Person; places: ResourceBinding[]; onClose: () => void }) {
  const [confirmOut, setConfirmOut] = useState(false)
  const [generation, setGeneration] = useState(0)
  remount = () => setGeneration((n) => n + 1)
  return (
    <PersonPopoverBody
      key={generation}
      person={who}
      places={places}
      onGo={vi.fn()}
      onClose={onClose}
      canEdit
      eventId="event-1"
      release={release}
      confirmOut={confirmOut}
      onConfirmOutChange={setConfirmOut}
    />
  )
}

function renderPopover(who: Person, places: ResourceBinding[] = []) {
  board.personnel = [who]
  const onClose = vi.fn()
  renderWithIntl(<Sidebar who={who} places={places} onClose={onClose} />)
  return { onClose }
}

describe('PersonPopoverBody', () => {
  beforeEach(() => {
    board.operations = []
    board.drivers = new Map()
    vi.clearAllMocks()
  })

  it('ticks what the person holds, on top, and leaves the rest unticked below', () => {
    renderPopover(person({ isKommandoposten: true }))
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual([
      'Kommandoposten',
      'Reko',
      'Magazin',
      'Telefondienst',
      'Fahrer',
    ])
    expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false'])
    expect(screen.getByText('1 Zuweisung')).toBeInTheDocument()
  })

  it('shows a driver who is crew on the same Einsatz once', () => {
    board.operations = [op14]
    renderPopover(person({ id: 'p-peter', name: 'Schneider Peter', isDriver: true, driverVehicleId: 'v-trawa', driverVehicleName: 'Trawa' }), [crewBinding])
    expect(screen.getByText('1 Zuweisung')).toBeInTheDocument()
    expect(screen.getByText('Mannschaft · fährt Trawa')).toBeInTheDocument()
    expect(screen.getAllByText('14 · Poststrasse 6')).toHaveLength(1)
    // No Fahrer row repeats it (UX.15).
    expect(screen.queryByRole('checkbox', { name: /^Fahrer/ })).not.toBeInTheDocument()
  })

  it('names a bound Einsatz short in the check-out question, with the vehicle driven there', async () => {
    board.operations = [op14]
    const longLabel = { ...crewBinding, label: '14 · Poststrasse 6 (Elementarereignis: Tiefgarage ca. 40 cm unter Wasser.)' }
    renderPopover(person({ id: 'p-peter', name: 'Schneider Peter', isDriver: true, driverVehicleId: 'v-trawa', driverVehicleName: 'Trawa' }), [longLabel])

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))

    expect(await screen.findByText(/noch «14 · Poststrasse 6 \(fährt Trawa\)» zugewiesen/)).toBeInTheDocument()
  })

  it('shows one Fahrer row per vehicle driven, and each ends its own vehicle', async () => {
    api.unassignSpecialFunction.mockResolvedValue(undefined)
    board.drivers = new Map([
      ['v-trawa', { name: 'Unternährer Sina', personnelId: 'p-sina' }],
      ['v-tlf', { name: 'Unternährer Sina', personnelId: 'p-sina' }],
    ])
    renderPopover(person({ isDriver: true, driverVehicleId: 'v-trawa' }))

    expect(screen.getByRole('checkbox', { name: 'Fahrer Trawa' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Fahrer TLF' })).toBeChecked()
    expect(screen.getByText('2 Zuweisungen')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Fahrer TLF' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Funktion entfernen' }))

    await waitFor(() =>
      expect(api.unassignSpecialFunction).toHaveBeenCalledWith('event-1', { personnel_id: 'p-sina', function_type: 'driver', vehicle_id: 'v-tlf' }),
    )
  })

  it('releases the Einsatz with the board’s undo when its tick is taken away', async () => {
    board.operations = [op14]
    renderPopover(person({ id: 'p-peter' }), [crewBinding])
    await userEvent.click(screen.getByRole('checkbox', { name: '14 · Poststrasse 6' }))
    expect(release.releaseCrew).toHaveBeenCalledWith('op-14', 'p-peter')
  })

  it('offers a Reko tick for release only once its row id is known', () => {
    const rekoBinding: ResourceBinding = { ...crewBinding, key: 'reko-op-14', target: REKO_TARGET, purpose: 'reko' }
    // The assign POST has not answered: the row may still be refused, so no release.
    board.operations = [{ ...op14, crew: [], assignedReko: { id: 'p-sina', name: 'Unternährer Sina' } } as Operation]
    renderPopover(person({ isReko: true }), [rekoBinding])
    expect(screen.getByRole('checkbox', { name: '14 · Poststrasse 6' })).toBeDisabled()
  })

  it('checks a free person out at once, and the undo resumes exactly that departure', async () => {
    api.checkOutPersonnelForEvent.mockResolvedValue({ checked_out_at: '2026-11-24T18:00:00.123456Z', changed: true })
    api.checkInPersonnelForEvent.mockResolvedValue({})
    const { onClose } = renderPopover(person({}))
    expect(screen.getByText(/Anwesend seit/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))

    await waitFor(() => expect(api.checkOutPersonnelForEvent).toHaveBeenCalledWith('p-sina', 'event-1', { onlyIfFree: true }))
    expect(onClose).toHaveBeenCalled()
    expect(undoToast).toHaveBeenCalledWith('Unternährer Sina ausgecheckt', expect.anything())
    await undoToast.mock.calls[0][1].onUndo()
    expect(api.checkInPersonnelForEvent).toHaveBeenCalledWith('p-sina', 'event-1', { resume: '2026-11-24T18:00:00.123456Z' })
  })

  it('offers no undo when somebody else had already checked the person out', async () => {
    api.checkOutPersonnelForEvent.mockResolvedValue({ checked_out_at: '2026-11-24T17:30:00Z', changed: false })
    const { onClose } = renderPopover(person({}))

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith('Unternährer Sina ausgecheckt')
    expect(undoToast).not.toHaveBeenCalled()
  })

  it('says so when the undo finds the person checked in or out again meanwhile', async () => {
    api.checkOutPersonnelForEvent.mockResolvedValue({ checked_out_at: '2026-11-24T18:00:00Z', changed: true })
    api.checkInPersonnelForEvent.mockRejectedValue(new ApiError('changed', 409, true))
    renderPopover(person({}))

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))
    await waitFor(() => expect(undoToast).toHaveBeenCalled())
    await undoToast.mock.calls[0][1].onUndo()

    expect(toastError).toHaveBeenCalledWith('Nicht mehr rückgängig – die Anwesenheit von Unternährer Sina hat sich inzwischen geändert')
  })

  it('asks the question when the server finds a person shown free still bound', async () => {
    api.checkOutPersonnelForEvent.mockRejectedValueOnce(new ApiError('bound', 409, true)).mockResolvedValue({ checked_out_at: null })
    let groupsLoaded = () => {}
    refresh.operations.mockResolvedValue(undefined)
    refresh.groups.mockReturnValue(new Promise<void>((resolve) => { groupsLoaded = resolve }))
    const { onClose } = renderPopover(person({}))

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))

    // Not before both sources (Einsätze and Aufträge) have the new state.
    await waitFor(() => expect(refresh.groups).toHaveBeenCalled())
    expect(refresh.operations).toHaveBeenCalled()
    expect(screen.queryByText('Unternährer Sina ist noch zugewiesen')).not.toBeInTheDocument()
    groupsLoaded()
    expect(await screen.findByText('Unternährer Sina ist noch zugewiesen')).toBeInTheDocument()
    // Still nothing on this board that binds them: a generic line, not an empty «».
    expect(screen.getByText('Unternährer Sina ist noch zugewiesen – trotzdem auschecken? Die Zuweisung bleibt bestehen.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Trotzdem auschecken' }))
    await waitFor(() => expect(api.checkOutPersonnelForEvent).toHaveBeenLastCalledWith('p-sina', 'event-1', { onlyIfFree: false }))
  })

  it('keeps the question when the refresh moves the person to «Gebunden» (a new popover body)', async () => {
    api.checkOutPersonnelForEvent.mockRejectedValueOnce(new ApiError('bound', 409, true))
    refresh.operations.mockImplementation(async () => remount())
    refresh.groups.mockResolvedValue(undefined)
    renderPopover(person({}))

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))

    expect(await screen.findByText('Unternährer Sina ist noch zugewiesen')).toBeInTheDocument()
  })

  it('asks the Appell’s question before checking out a person who is still bound', async () => {
    api.checkOutPersonnelForEvent.mockResolvedValue({})
    renderPopover(person({ isKommandoposten: true }))

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))

    expect(await screen.findByText('Unternährer Sina ist noch zugewiesen')).toBeInTheDocument()
    expect(screen.getByText(/noch «Kommandoposten» zugewiesen/)).toBeInTheDocument()
    expect(api.checkOutPersonnelForEvent).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Trotzdem auschecken' }))
    await waitFor(() => expect(api.checkOutPersonnelForEvent).toHaveBeenCalledWith('p-sina', 'event-1', { onlyIfFree: false }))
  })
})
