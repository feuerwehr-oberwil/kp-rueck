import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation, Person } from '@/lib/contexts/operations-context'
import type { ResourceBinding } from '@/lib/board-sidebar'
import { RESOURCES_TARGET } from '@/lib/detail-target'

const { api, undoToast, board } = vi.hoisted(() => ({
  api: {
    checkOutPersonnelForEvent: vi.fn(),
    checkInPersonnelForEvent: vi.fn(),
    setAttendancePlan: vi.fn(),
    assignSpecialFunction: vi.fn(),
    unassignSpecialFunction: vi.fn(),
  },
  undoToast: vi.fn(),
  board: { operations: [] as Operation[], personnel: [] as Person[] },
}))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
vi.mock('@/lib/toast-undo', () => ({ undoToast }))
vi.mock('@/lib/contexts/operations-context', () => ({
  useOperations: () => ({
    ...board,
    vehicles: [{ id: 'v-trawa', name: 'Trawa', display_order: 1 }],
    removeCrew: vi.fn(),
    removeReko: vi.fn(),
    refreshOperations: vi.fn(),
  }),
}))
vi.mock('@/lib/contexts/groups-context', () => ({ useGroups: () => ({ getGroupResources: () => ({ personnel: [] }) }) }))
vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: { id: 'event-1' } }) }))
vi.mock('@/lib/hooks/use-vehicle-drivers', () => ({ useVehicleDrivers: () => new Map() }))
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

  it('releases the Einsatz with the board’s undo when its tick is taken away', async () => {
    board.operations = [op14]
    renderPopover(person({ id: 'p-peter' }), [crewBinding])
    await userEvent.click(screen.getByRole('checkbox', { name: '14 · Poststrasse 6' }))
    expect(release.releaseCrew).toHaveBeenCalledWith('op-14', 'p-peter')
  })

  it('checks a free person out at once, and the undo resumes the same stint', async () => {
    api.checkOutPersonnelForEvent.mockResolvedValue({})
    api.checkInPersonnelForEvent.mockResolvedValue({})
    const { onClose } = renderPopover(person({}))
    expect(screen.getByText(/Anwesend seit/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))

    await waitFor(() => expect(api.checkOutPersonnelForEvent).toHaveBeenCalledWith('p-sina', 'event-1'))
    expect(onClose).toHaveBeenCalled()
    expect(undoToast).toHaveBeenCalledWith('Unternährer Sina ausgecheckt', expect.anything())
    await undoToast.mock.calls[0][1].onUndo()
    expect(api.checkInPersonnelForEvent).toHaveBeenCalledWith('p-sina', 'event-1', { resume: true })
  })

  it('asks the Appell’s question before checking out a person who is still bound', async () => {
    api.checkOutPersonnelForEvent.mockResolvedValue({})
    renderPopover(person({ isKommandoposten: true }))

    await userEvent.click(screen.getByRole('button', { name: /Auschecken/ }))

    expect(await screen.findByText('Unternährer Sina ist noch zugewiesen')).toBeInTheDocument()
    expect(screen.getByText(/noch «Kommandoposten» zugewiesen/)).toBeInTheDocument()
    expect(api.checkOutPersonnelForEvent).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Trotzdem auschecken' }))
    await waitFor(() => expect(api.checkOutPersonnelForEvent).toHaveBeenCalledWith('p-sina', 'event-1'))
  })
})
