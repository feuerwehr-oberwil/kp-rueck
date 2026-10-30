import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const mocks = vi.hoisted(() => ({
  getDeployment: vi.fn(),
  getStandby: vi.fn(),
  takeOverEvent: vi.fn(),
  selectedEvent: { id: 'ev-1', name: 'Unwetter Beispielhausen' } as { id: string; name: string } | null,
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { getDeployment: mocks.getDeployment, getStandby: mocks.getStandby, takeOverEvent: mocks.takeOverEvent },
}))
vi.mock('@/lib/contexts/event-context', () => ({ useEvent: () => ({ selectedEvent: mocks.selectedEvent }) }))
vi.mock('@/lib/websocket-client', () => ({ wsClient: { on: () => () => {} } }))

import { StandbyBand } from '@/components/standby-band'
import { AuthContext, type AuthContextType, useAuth } from '@/lib/contexts/auth-context'
import { StandbyProvider } from '@/lib/contexts/standby-context'
import { resetDeploymentCache } from '@/lib/hooks/use-deployment'

function authAs(role: 'editor' | 'viewer'): AuthContextType {
  return {
    user: { id: 'u1', username: 'u', role, display_name: 'U' } as AuthContextType['user'],
    loading: false,
    login: vi.fn(),
    microsoftLogin: vi.fn(),
    logout: vi.fn(),
    isAdmin: false,
    isEditor: role === 'editor',
    isViewer: role === 'viewer',
    isAuthenticated: true,
  } as AuthContextType
}

/** What every control below the provider sees: may it edit? */
function EditProbe() {
  return <span data-testid="can-edit">{String(useAuth().isEditor)}</span>
}

function renderBoard(role: 'editor' | 'viewer' = 'editor') {
  return renderWithIntl(
    <AuthContext.Provider value={authAs(role)}>
      <StandbyProvider>
        <StandbyBand />
        <EditProbe />
      </StandbyProvider>
    </AuthContext.Provider>,
  )
}

const MIRROR = { mirror: true, configured: true, current: true, last_received_at: '2026-10-30T18:30:12Z', detached: [] }

beforeEach(() => {
  resetDeploymentCache()
  mocks.getDeployment.mockReset().mockResolvedValue({ role: 'standby', label: 'Standby – Spiegel', blocked_domains: ['alerting'] })
  mocks.getStandby.mockReset().mockResolvedValue(MIRROR)
  mocks.takeOverEvent.mockReset()
  mocks.selectedEvent = { id: 'ev-1', name: 'Unwetter Beispielhausen' }
})

describe('StandbyBand', () => {
  it('says the board is a look-only mirror and locks editing', async () => {
    renderBoard()

    const band = await screen.findByText(/nur ansehen/)
    expect(band.closest('[data-standby-band]')).toHaveAttribute('data-standby-band', 'mirror')
    expect(screen.getByText('Spiegel von KP Rück Online')).toBeInTheDocument()
    expect(screen.getByTestId('can-edit')).toHaveTextContent('false')
  })

  it('takes the open Ereignis offline in one confirmation, then unlocks it', async () => {
    mocks.takeOverEvent.mockResolvedValue({
      ...MIRROR,
      detached: [{ event_id: 'ev-1', detached_at: '2026-10-30T18:42:00Z' }],
    })
    renderBoard()

    await userEvent.click(await screen.findByRole('button', { name: 'Dieses Ereignis offline übernehmen …' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('«Unwetter Beispielhausen» offline übernehmen?')).toBeInTheDocument()
    // KP Rück Online still answers: the dialog says what that means.
    expect(within(dialog).getByText(/KP Rück Online ist noch erreichbar/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Offline übernehmen' }))

    expect(mocks.takeOverEvent).toHaveBeenCalledWith('ev-1')
    expect(await screen.findByText('Offline geführt')).toBeInTheDocument()
    expect(screen.getByText(/«Unwetter Beispielhausen» wird nicht mehr synchronisiert/)).toBeInTheDocument()
    expect(screen.getByTestId('can-edit')).toHaveTextContent('true')
  })

  it('offers no takeover to a viewer', async () => {
    renderBoard('viewer')

    await screen.findByText(/nur ansehen/)
    expect(screen.queryByRole('button', { name: /offline übernehmen/ })).not.toBeInTheDocument()
  })

  it('says when the hosted board is out of reach', async () => {
    mocks.getStandby.mockResolvedValue({ ...MIRROR, current: false })
    renderBoard()

    expect(await screen.findByText(/keine Verbindung zu KP Rück Online/)).toBeInTheDocument()
  })

  it('changes nothing on a board that is not a standby', async () => {
    mocks.getDeployment.mockResolvedValue({ role: 'production', label: null, blocked_domains: [] })
    renderBoard()

    await vi.waitFor(() => expect(mocks.getDeployment).toHaveBeenCalled())
    expect(document.querySelector('[data-standby-band]')).toBeNull()
    expect(screen.getByTestId('can-edit')).toHaveTextContent('true')
    expect(mocks.getStandby).not.toHaveBeenCalled()
  })
})
