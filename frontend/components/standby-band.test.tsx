import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const mocks = vi.hoisted(() => ({
  getDeployment: vi.fn(),
  getStandby: vi.fn(),
  takeOverEvent: vi.fn(),
  takeBackEvent: vi.fn(),
  selectedEvent: { id: 'ev-1', name: 'Unwetter Beispielhausen' } as { id: string; name: string } | null,
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getDeployment: mocks.getDeployment,
    getStandby: mocks.getStandby,
    takeOverEvent: mocks.takeOverEvent,
    takeBackEvent: mocks.takeBackEvent,
  },
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

const MIRROR = { mirror: true, configured: true, current: true, last_received_at: '2026-10-30T18:30:12Z', detached: [], leads: [] }

function lead(holder: 'standby' | 'hosted', over: Record<string, unknown> = {}) {
  return {
    event_id: 'ev-1',
    holder,
    since: '2026-10-30T18:42:00Z',
    taken_by: 'Koch René',
    pending: 0,
    contact_at: new Date().toISOString(),
    open_conflicts: 0,
    ...over,
  }
}

const HOSTED = { role: 'production', label: null, blocked_domains: [] }

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
      leads: [lead('standby')],
    })
    renderBoard()

    await userEvent.click(await screen.findByRole('button', { name: 'Dieses Ereignis offline übernehmen …' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('«Unwetter Beispielhausen» offline übernehmen?')).toBeInTheDocument()
    // KP Rück Online still answers: the dialog says what that means.
    expect(within(dialog).getByText(/KP Rück Online ist erreichbar/)).toBeInTheDocument()
    expect(within(dialog).getByText(/geht von selbst an KP Rück Online/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Offline übernehmen' }))

    expect(mocks.takeOverEvent).toHaveBeenCalledWith('ev-1')
    expect(await screen.findByText('Offline geführt')).toBeInTheDocument()
    expect(screen.getByText(/alles an KP Rück Online übertragen/)).toBeInTheDocument()
    expect(screen.getByTestId('can-edit')).toHaveTextContent('true')
  })

  it('says how much waits while the hosted board is out of reach', async () => {
    const lost = new Date(Date.now() - 14 * 60_000).toISOString()
    mocks.getStandby.mockResolvedValue({ ...MIRROR, current: false, leads: [lead('standby', { pending: 37, contact_at: lost })] })
    renderBoard()

    expect(await screen.findByText(/keine Verbindung zu KP Rück Online seit .* 37 Änderungen warten und gehen von selbst raus/)).toBeInTheDocument()
  })

  it('is a mirror again once the hosted board took the Ereignis back', async () => {
    mocks.getStandby.mockResolvedValue({ ...MIRROR, leads: [lead('hosted')] })
    renderBoard()

    expect(await screen.findByText(/nur ansehen/)).toBeInTheDocument()
    expect(screen.getByTestId('can-edit')).toHaveTextContent('false')
    expect(screen.getByRole('button', { name: 'Dieses Ereignis offline übernehmen …' })).toBeInTheDocument()
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

  it('changes nothing on a hosted board no box ever touched', async () => {
    mocks.getDeployment.mockResolvedValue(HOSTED)
    mocks.getStandby.mockResolvedValue({ mirror: false, leads: [] })
    renderBoard()

    await vi.waitFor(() => expect(mocks.getStandby).toHaveBeenCalled())
    expect(document.querySelector('[data-standby-band]')).toBeNull()
    expect(screen.getByTestId('can-edit')).toHaveTextContent('true')
  })

  it('shows the hosted board look-only while the box leads, and takes it back in one confirmation', async () => {
    mocks.getDeployment.mockResolvedValue(HOSTED)
    mocks.getStandby.mockResolvedValue({ mirror: false, leads: [lead('standby', { pending: 2 })] })
    mocks.takeBackEvent.mockResolvedValue({ mirror: false, leads: [lead('hosted')] })
    renderBoard()

    expect(await screen.findByText('Geführt auf KP Rück Offline')).toBeInTheDocument()
    expect(screen.getByText(/Neues erfassen geht, Bestehendes ändern nicht/)).toBeInTheDocument()
    expect(screen.getByTestId('can-edit')).toHaveTextContent('false')

    await userEvent.click(screen.getByRole('button', { name: 'Hier übernehmen …' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('2 Änderungen')).toBeInTheDocument()
    // The box was heard seconds ago: somebody may still be working there.
    expect(within(dialog).getByText(/Auf KP Rück Offline wird gerade gearbeitet/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hier übernehmen' }))

    expect(mocks.takeBackEvent).toHaveBeenCalledWith('ev-1')
    await vi.waitFor(() => expect(document.querySelector('[data-standby-band]')).toBeNull())
    expect(screen.getByTestId('can-edit')).toHaveTextContent('true')
  })

  it('says how long the box has been silent', async () => {
    mocks.getDeployment.mockResolvedValue(HOSTED)
    const silent = new Date(Date.now() - 14 * 60_000).toISOString()
    mocks.getStandby.mockResolvedValue({ mirror: false, leads: [lead('standby', { contact_at: silent })] })
    renderBoard()

    expect(await screen.findByText(/KP Rück Offline seit 14 Minuten nicht gehört/)).toBeInTheDocument()
  })

  it('keeps a way to the conflicts on the hosted board once it leads again', async () => {
    mocks.getDeployment.mockResolvedValue(HOSTED)
    mocks.getStandby.mockResolvedValue({ mirror: false, leads: [lead('hosted', { open_conflicts: 3 })] })
    renderBoard()

    expect(await screen.findByRole('button', { name: '3 Konflikte ›' })).toBeInTheDocument()
    expect(screen.getByTestId('can-edit')).toHaveTextContent('true')
  })
})
