import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

const storage = new Map<string, string>()

const mocks = vi.hoisted(() => ({
  pathname: '/login',
  isAuthenticated: false,
  getDemoStatus: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}))

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: mocks.isAuthenticated, loading: false }),
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { getDemoStatus: mocks.getDemoStatus },
}))

import { DemoBanner } from '@/components/demo-banner'

beforeEach(() => {
  mocks.pathname = '/login'
  mocks.isAuthenticated = false
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  localStorage.clear()
  mocks.getDemoStatus.mockReset()
  mocks.getDemoStatus.mockResolvedValue({
    demo: true,
    next_reset: '2026-07-24T00:00:00',
    seconds_until_reset: 3600,
    reset_interval_hours: 24,
  })
})

describe('DemoBanner', () => {
  it('shows the persistent ribbon without interrupting the login page', async () => {
    renderWithIntl(<DemoBanner />)

    expect(await screen.findByRole('note', { name: /Demo-Instanz/i })).toHaveTextContent('DEMO')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('welcomes an authenticated visitor with shared-data and midnight reset guidance', async () => {
    mocks.pathname = '/'
    mocks.isAuthenticated = true

    renderWithIntl(<DemoBanner />)

    expect(await screen.findByRole('dialog', { name: 'Willkommen bei KP Rück' })).toBeInTheDocument()
    expect(screen.getByText(/Sie ist jedoch nicht privat/i)).toBeInTheDocument()
    expect(screen.getByText(/täglich um 00:00 Uhr zurückgesetzt/i)).toBeInTheDocument()
  })

  it('stores dismissal so the welcome only appears once per browser', async () => {
    mocks.pathname = '/'
    mocks.isAuthenticated = true

    const first = renderWithIntl(<DemoBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Los geht’s' }))

    expect(localStorage.getItem('kp-rueck.demo-welcome.v1')).toBe('1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    first.unmount()
    renderWithIntl(<DemoBanner />)
    await screen.findByRole('note', { name: /Demo-Instanz/i })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
