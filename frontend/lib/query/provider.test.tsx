import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  getDeployment: vi.fn(),
  getIntegrations: vi.fn(),
  getGpsSimulations: vi.fn(),
  getCrew: vi.fn(),
  user: null as { id: string; role: string } | null,
}))
vi.mock('@/lib/api-client', () => ({
  apiClient: { getDeployment: mocks.getDeployment, getIntegrations: mocks.getIntegrations },
}))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/lib/websocket-client', () => ({
  wsClient: { on: () => () => {}, onStatusChange: () => () => {}, getStatus: () => 'disconnected' },
}))

import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/contexts/auth-context'
import { QueryProvider } from './provider'
import { queryKeys } from './keys'
import { useReader } from './reader'
import { useDeployment } from '@/lib/hooks/use-deployment'

function Role() {
  return <p>{useDeployment().role}</p>
}

describe('QueryProvider', () => {
  it('keeps the deployment role through a sign-in', async () => {
    mocks.getDeployment.mockResolvedValueOnce({ role: 'standby', label: null, blocked_domains: [] })
    const { rerender } = render(<QueryProvider><Role /></QueryProvider>)
    expect(await screen.findByText('standby')).toBeInTheDocument()

    // Signed in; the backend is slow to answer now.
    mocks.getDeployment.mockReturnValue(new Promise(() => {}))
    mocks.user = { id: 'u-1', role: 'editor' }
    rerender(<QueryProvider><Role /></QueryProvider>)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(screen.getByText('standby')).toBeInTheDocument()
  })

  it('asks again with the new user\'s options only', async () => {
    // A read only an editor makes, and one everybody makes.
    function EditorRead() {
      const isEditor = useAuth().user?.role === 'editor'
      const reader = useReader()
      useQuery({ queryKey: queryKeys.integrations.for(reader), queryFn: () => mocks.getIntegrations(), enabled: isEditor })
      useQuery({ queryKey: queryKeys.gpsSimulations.for(reader), queryFn: () => mocks.getGpsSimulations() })
      return null
    }
    mocks.getIntegrations.mockResolvedValue({})
    mocks.getGpsSimulations.mockResolvedValue([])
    mocks.user = { id: 'editor-1', role: 'editor' }
    const { rerender } = render(<QueryProvider><EditorRead /></QueryProvider>)
    await vi.waitFor(() => expect(mocks.getIntegrations).toHaveBeenCalledTimes(1))

    mocks.user = { id: 'viewer-1', role: 'viewer' }
    rerender(<QueryProvider><EditorRead /></QueryProvider>)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(mocks.getIntegrations).toHaveBeenCalledTimes(1)
    expect(mocks.getGpsSimulations).toHaveBeenCalledTimes(2)
  })

  it('never shows user A\'s answer on user B\'s first frame', async () => {
    // A panel deep in the page: the provider's re-render alone does not reach it.
    function Crew() {
      const crew = useQuery({ queryKey: queryKeys.incidentParticipants.of(useReader(), 'inc-1'), queryFn: () => mocks.getCrew() })
      return <p>{crew.data ?? 'lädt'}</p>
    }
    const page = <Crew />
    mocks.getCrew.mockResolvedValueOnce('Crew für A')
    mocks.user = { id: 'user-a', role: 'editor' }
    const { rerender } = render(<QueryProvider>{page}</QueryProvider>)
    expect(await screen.findByText('Crew für A')).toBeInTheDocument()

    // A token refresh hands the tab user B – no sign-out between.
    mocks.getCrew.mockReturnValue(new Promise(() => {}))
    mocks.user = { id: 'user-b', role: 'editor' }
    rerender(<QueryProvider>{page}</QueryProvider>)

    expect(screen.queryByText('Crew für A')).not.toBeInTheDocument()
  })
})
