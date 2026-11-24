import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ApiRegieState } from '@/lib/api/types'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { crewMember } from '@/test-utils/operation-fixtures'

const ops = vi.hoisted(() => ({ list: [] as unknown[] }))
const api = vi.hoisted(() => ({
  getRegie: vi.fn(),
  getAllSettings: vi.fn(async () => ({})),
  runRegieStep: vi.fn(),
  simulateEscalation: vi.fn(async () => ({})),
}))
vi.mock('@/lib/contexts/operations-context', () => ({
  useOperations: () => ({ operations: ops.list, formatLocation: (s: string) => s, refreshOperations: vi.fn() }),
}))
vi.mock('@/lib/api-client', () => ({ apiClient: api, ApiError: { isConflictError: () => false } }))
vi.mock('@/lib/websocket-client', () => ({
  wsClient: { getStatus: () => 'connected', onStatusChange: () => () => {}, on: () => () => {} },
}))
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => false }))

import { RegieProvider } from './regie-provider'
import { RegieStoerung } from './regie-stoerung'
import { RegieTimeline } from './regie-timeline'

const operation = (id: string, location: string, status: string, priority = 'medium') => ({
  id,
  location,
  incidentType: 'Brand',
  status,
  priority,
  crew: [crewMember(`Muster ${id}`)],
  vehicles: [],
  pickupNeeded: false,
})

const regie = (overrides: Partial<ApiRegieState> = {}): ApiRegieState => ({
  event_id: 'e1',
  autopilot: true,
  tempo: 'normal',
  paused_at: null,
  started_at: '2026-11-24T19:00:00Z',
  automatik: { enabled: false, run: null },
  automatik_next_at: null,
  incidents: [],
  history: [],
  gps_available: true,
  magazin_configured: true,
  ...overrides,
})

const page = () =>
  renderWithIntl(
    <RegieProvider eventId="e1">
      <RegieTimeline />
      <RegieStoerung />
    </RegieProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  ops.list = [
    operation('i-done', 'Bachweg 3', 'complete'),
    operation('i-high', 'Hauptstrasse 1', 'active', 'high'),
    operation('i-open', 'Im Lohgraben 26', 'active'),
  ]
})

describe('Regie page', () => {
  it('«zufällig» throws an inject at a fitting open incident', async () => {
    api.getRegie.mockResolvedValue(regie())
    page()
    await userEvent.click(await screen.findByRole('button', { name: /Störung einspielen/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Lage verschärft sich/ }))
    // Closed and already-high incidents do not fit an escalation: only one is left.
    await waitFor(() => expect(api.simulateEscalation).toHaveBeenCalledWith('e1', 'i-open'))
  })

  it('«Jetzt» on «Einsatz beendet» asks whether the Trupp comes back by itself first', async () => {
    const step = {
      incident_id: 'i-open',
      key: 'field_complete' as const,
      due_at: new Date(Date.now() + 40_000).toISOString(),
      rolling: false,
      progress: null,
      eta_seconds: null,
    }
    api.getRegie.mockResolvedValue(
      regie({ incidents: [{ incident_id: 'i-open', held: false, mitspieler: false, steps: [step] }] }),
    )
    api.runRegieStep.mockResolvedValue(regie())
    page()
    expect(await screen.findByText('Im Lohgraben 26')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Jetzt' }))
    expect(api.runRegieStep).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Fährt selbst' }))
    await waitFor(() => expect(api.runRegieStep).toHaveBeenCalledWith('e1', 'i-open', 'field_complete', false))
  })
})
