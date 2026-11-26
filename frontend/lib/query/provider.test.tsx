import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  getDeployment: vi.fn(),
  getIntegrations: vi.fn(),
  getGpsSimulations: vi.fn(),
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
      useQuery({ queryKey: queryKeys.integrations, queryFn: () => mocks.getIntegrations(), enabled: isEditor })
      useQuery({ queryKey: queryKeys.gpsSimulations, queryFn: () => mocks.getGpsSimulations() })
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
})
