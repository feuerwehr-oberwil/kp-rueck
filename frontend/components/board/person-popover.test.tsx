import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation, Person } from '@/lib/contexts/operations-context'
import type { ResourceBinding } from '@/lib/board-sidebar'
import { RESOURCES_TARGET } from '@/lib/detail-target'
import { ApiError } from '@/lib/api/types'

const { api, undoToast, toastError, board } = vi.hoisted(() => ({
  api: {
    checkOutPersonnelForEvent: vi.fn(),
    checkInPersonnelForEvent: vi.fn(),
    setAttendancePlan: vi.fn(),
    assignSpecialFunction: vi.fn(),
    unassignSpecialFunction: vi.fn(),
  },
  undoToast: vi.fn(),
  toastError: vi.fn(),
  board: { operations: [] as Operation[], personnel: [] as Person[], drivers: new Map<string, { name: string; personnelId: string }>() },
}))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('@/lib/toast-undo', () => ({ undoToast }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
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
    refreshOperations: vi.fn(),
  }),
}))
vi.mock('@/lib/contexts/groups-context', () => ({ useGroups: () => ({ getGroupResources: () => ({ personnel: [] }) }) }))
vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: { id: 'event-1' } }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => board.drivers }))
// The Reko hand-over is not under test here and needs the whole board.
vi.mock('@/components/kanban/transfer-reko-dialog', () => ({ TransferRekoDialog: () => null }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => false }))

import { PersonPopoverBody } from '@/components/board/person-popover'

const op14 = {
  id: 'op-14',
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

function renderPopover(who: Person, places: ResourceBinding[] = []) {
  board.personnel = [who]
  const onClose = vi.fn()
  renderWithIntl(
    <PersonPopoverBody person={who} places={places} onGo={vi.fn()} onClose={onClose} canEdit eventId="event-1" release={release} />,
  )
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

  it('checks a free person out at once, and the undo resumes exactly that departure', async () => {
    api.checkOutPersonnelForEvent.mockResolvedValue({ checked_out_at: '2026-11-24T18:00:00.123456Z' })
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

  it('says so when the undo finds the person checked in or out again meanwhile', async () => {
    api.checkOutPersonnelForEvent.mockResolvedValue({ checked_out_at: '2026-11-24T18:00:00Z' })
    api.checkInPersonnelForEvent.mockRejectedValue(new ApiError('changed', 409, true))
    renderPopover(person({}))

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))
    await waitFor(() => expect(undoToast).toHaveBeenCalled())
    await undoToast.mock.calls[0][1].onUndo()

    expect(toastError).toHaveBeenCalledWith('Nicht mehr rückgängig – die Anwesenheit von Unternährer Sina hat sich inzwischen geändert')
  })

  it('asks the question when the server finds a person shown free still bound', async () => {
    api.checkOutPersonnelForEvent.mockRejectedValueOnce(new ApiError('bound', 409, true)).mockResolvedValue({ checked_out_at: null })
    const { onClose } = renderPopover(person({}))

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))

    expect(await screen.findByText('Unternährer Sina ist noch zugewiesen')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Trotzdem auschecken' }))
    await waitFor(() => expect(api.checkOutPersonnelForEvent).toHaveBeenLastCalledWith('p-sina', 'event-1', { onlyIfFree: false }))
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
