import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({ getDeployment: vi.fn(), user: null as { id: string } | null }))
vi.mock('@/lib/api-client', () => ({ apiClient: { getDeployment: mocks.getDeployment } }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('@/lib/websocket-client', () => ({
  wsClient: { on: () => () => {}, onStatusChange: () => () => {}, getStatus: () => 'disconnected' },
}))

import { QueryProvider } from './provider'
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
    mocks.user = { id: 'u-1' }
    rerender(<QueryProvider><Role /></QueryProvider>)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(screen.getByText('standby')).toBeInTheDocument()
  })
})
