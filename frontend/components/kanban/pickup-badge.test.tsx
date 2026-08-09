import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const setIncidentFieldReport = vi.hoisted(() => vi.fn())
const refreshOperations = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({ apiClient: { setIncidentFieldReport } }))
vi.mock('@/lib/contexts/operations-context', () => ({
  useOperations: () => ({ refreshOperations }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PickupBadge } from '@/components/kanban/pickup-badge'

const REQUESTED = new Date('2026-08-09T21:14:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  setIncidentFieldReport.mockResolvedValue({})
  refreshOperations.mockResolvedValue(undefined)
})

describe('the Abholung chip', () => {
  it('is a label, not a button, without an incident id', () => {
    renderWithIntl(<PickupBadge requestedAt={REQUESTED} />)
    expect(screen.getByText('Abholung')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('stays a label for a viewer', () => {
    renderWithIntl(<PickupBadge requestedAt={REQUESTED} incidentId="inc-1" canEdit={false} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('clears the pickup after a confirmation, and only then', async () => {
    const user = userEvent.setup()
    const onCleared = vi.fn()
    renderWithIntl(<PickupBadge requestedAt={REQUESTED} incidentId="inc-1" onCleared={onCleared} />)

    await user.click(screen.getByRole('button'))
    // The waiting time is the only record of how long they stood there, so the
    // chip asks before it erases it.
    expect(setIncidentFieldReport).not.toHaveBeenCalled()
    expect(screen.getByText('Abholung erledigt?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Abholung erledigt' }))

    await waitFor(() =>
      expect(setIncidentFieldReport).toHaveBeenCalledWith('inc-1', { pickup_needed: false }),
    )
    // Never the 5 s poll: the chip the operator just clicked has to go now.
    await waitFor(() => expect(refreshOperations).toHaveBeenCalled())
    await waitFor(() => expect(onCleared).toHaveBeenCalled())
  })

  it('leaves the pickup alone when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    renderWithIntl(<PickupBadge requestedAt={REQUESTED} incidentId="inc-1" />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(setIncidentFieldReport).not.toHaveBeenCalled()
  })
})
