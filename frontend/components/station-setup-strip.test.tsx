/**
 * «Station einrichten» (owner pick UX-06 A): shown to the admin of a freshly claimed board,
 * with only the open steps as rows; nothing for an editor, nothing once the station is set up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithIntl } from '@/test-utils/render-with-intl'
import { StationSetupStrip } from './station-setup-strip'

const state = vi.hoisted(() => ({
  auth: { isAdmin: true, user: { username: 'admin' } },
  settings: {} as Record<string, string>,
  personnel: [] as unknown[],
  vehicles: [] as unknown[],
}))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => state.auth }))
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: {
    getAllSettings: async () => state.settings,
    getAllPersonnel: async () => state.personnel,
    getVehicles: async () => state.vehicles,
  },
}))

beforeEach(() => {
  window.localStorage.clear()
  state.auth = { isAdmin: true, user: { username: 'admin' } }
  state.settings = { firestation_latitude: '47.5596', firestation_longitude: '7.5886', home_city: 'Musterstadt, BL' }
  state.personnel = []
  state.vehicles = []
})

describe('StationSetupStrip', () => {
  it('names the account and offers the way out of both open steps', async () => {
    renderWithIntl(<StationSetupStrip />)
    const strip = await screen.findByRole('region', { name: 'Station einrichten' })
    expect(strip).toHaveTextContent('1 von 3 erledigt')
    expect(strip).toHaveTextContent('Angemeldet als admin')
    expect(screen.getByRole('button', { name: 'Adresse suchen …' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Excel importieren …' })).toHaveAttribute('href', '/settings?section=import')
  })

  it('is gone once location and inventory are the station’s own', async () => {
    state.settings = { firestation_latitude: '47.516377', firestation_longitude: '7.5618', home_city: 'Oberwil, BL' }
    state.personnel = [{}]
    state.vehicles = [{}]
    renderWithIntl(<StationSetupStrip />)
    await Promise.resolve()
    expect(screen.queryByRole('region', { name: 'Station einrichten' })).not.toBeInTheDocument()
  })

  it('shows nothing to an editor', async () => {
    state.auth = { isAdmin: false, user: { username: 'editor' } }
    renderWithIntl(<StationSetupStrip />)
    await Promise.resolve()
    expect(screen.queryByRole('region', { name: 'Station einrichten' })).not.toBeInTheDocument()
  })
})
