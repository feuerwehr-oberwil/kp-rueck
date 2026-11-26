import { describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiIncidentParticipantsResponse } from '@/lib/api/types'

const mocks = vi.hoisted(() => ({ getIncidentParticipants: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: { getIncidentParticipants: mocks.getIncidentParticipants } }))

import { IncidentParticipants } from '@/components/kanban/incident-participants'

const crew = (name: string): ApiIncidentParticipantsResponse => ({
  participants: [
    {
      resource_type: 'personnel',
      resource_id: `${name}-id`,
      name,
      first_assigned_at: '2026-11-26T08:00:00Z',
      last_released_at: null,
      stints: 1,
      is_reko: false,
      is_leader: false,
    },
  ],
})

/** A request the test answers by hand, in the order it chooses. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('IncidentParticipants', () => {
  it('shows the new Einsatz even when the previous one answers last', async () => {
    const forA = deferred<ApiIncidentParticipantsResponse>()
    const forB = deferred<ApiIncidentParticipantsResponse>()
    mocks.getIncidentParticipants.mockImplementation((id: string) => (id === 'a' ? forA.promise : forB.promise))

    const { rerender } = renderWithIntl(<IncidentParticipants incidentId="a" />)
    rerender(<IncidentParticipants incidentId="b" />)

    forB.resolve(crew('Brunner'))
    expect(await screen.findByText('Brunner')).toBeInTheDocument()
    await act(async () => {
      forA.resolve(crew('Ammann'))
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(screen.getByText('Brunner')).toBeInTheDocument()
    expect(screen.queryByText('Ammann')).not.toBeInTheDocument()
  })
})
