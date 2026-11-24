import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Todo } from '@/lib/todos'
import type { Notification } from '@/lib/types/notification'

const completion = vi.hoisted(() => ({
  readiness: 'ready' as string,
  requestCompletion: vi.fn(() => true),
  retryCompletionBoard: vi.fn(async () => {}),
}))
vi.mock('@/lib/hooks/use-completion-request', () => ({
  useCompletionReadiness: () => completion.readiness,
  requestCompletion: completion.requestCompletion,
  retryCompletionBoard: completion.retryCompletionBoard,
}))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ isEditor: true }) }))
vi.mock('@/lib/contexts/notification-context', () => ({ useOptionalNotifications: () => ({ dismissNotification: vi.fn() }) }))
vi.mock('@/lib/contexts/planned-context', () => ({ usePlanned: () => ({ promote: vi.fn(), setDismissed: vi.fn() }) }))
const unassign = vi.hoisted(() => ({ group: vi.fn(async () => {}), incident: vi.fn(async () => {}) }))
vi.mock('@/lib/api-client', () => ({
  apiClient: { unassignGroupResource: unassign.group, unassignResource: unassign.incident },
}))

import { TodoSection } from './todo-section'

function release(groupId: string | null): Todo {
  const notification: Notification = {
    id: 'n-1',
    type: 'gps_release',
    severity: 'info',
    message: '',
    params: { vehicle: 'TLF', place: '14 · Hauptstrasse 4' },
    incident_id: 'op-14',
    created_at: new Date(0),
    dismissed: false,
  }
  return { kind: 'gps_release', id: 'gps:n-1', since: 0, dismissed: false, incidentId: 'op-14', notification, assignmentId: 'a-1', vehicleId: 'v-tlf', groupId }
}

const show = (todo: Todo) => renderWithIntl(<TodoSection state={{ open: [todo], dismissed: [], now: 60_000 }} />)

// Owner feedback 23.11.2026 #13: a vehicle back home means the crew and the material are back
// too – the bell row leads with the board's close flow, like the popup it replaced.
describe('TodoSection – a vehicle back in the Magazin', () => {
  it('offers «Einsatz abschliessen» as the main answer, last, and runs the board\'s close flow', async () => {
    completion.readiness = 'ready'
    show(release(null))
    // Sign-off 24.11.2026: «Verwerfen» bottom left, the main answer bottom right.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Verwerfen', 'Nur TLF freigeben', 'Einsatz abschliessen'])
    const main = screen.getByRole('button', { name: /Einsatz abschliessen/ })
    expect(main).toHaveClass('bg-action')
    await userEvent.click(main)
    expect(completion.requestCompletion).toHaveBeenCalledWith('op-14')
  })

  it('waits while the board does not have the Einsatz, and says so', () => {
    completion.readiness = 'missing'
    show(release(null))
    expect(screen.getByRole('button', { name: /Einsatz abschliessen/ })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Einsatz nicht gefunden')
  })

  it('only releases a route vehicle – its Auftrag goes on', async () => {
    completion.readiness = 'ready'
    show(release('g-1'))
    expect(screen.queryByRole('button', { name: /Einsatz abschliessen/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Nur TLF freigeben/ }))
    expect(unassign.group).toHaveBeenCalledWith('g-1', 'a-1')
  })
})
