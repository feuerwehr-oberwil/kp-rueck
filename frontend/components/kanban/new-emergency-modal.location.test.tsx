import { describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'

/**
 * «Neuer Einsatz» with the REAL Einsatzort field: it commits what is typed on Enter – the
 * same key event Ctrl ↵ creates on – so the dialog must create with that address, not with
 * the one committed before (hunt follow-up 25.11.). new-emergency-modal.test.tsx stubs the
 * field and cannot see this.
 */

const searchAddress = vi.hoisted(() => vi.fn().mockResolvedValue([]))
// «Hauptstrasse 12» gets a pin from the geocoder, every other text none.
const geocodeAddress = vi.hoisted(() =>
  vi.fn((address: string) => Promise.resolve(address === 'Hauptstrasse 12' ? { lat: 47.51, lon: 7.55 } : null)),
)
vi.mock('@/lib/geocoding', () => ({
  geocodeAddress,
  searchAddress,
  reverseGeocode: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/api-client', () => ({ apiClient: { getAllSettings: vi.fn().mockResolvedValue({}) } }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => false }))

import { NewEmergencyModal } from '@/components/kanban/new-emergency-modal'

describe('NewEmergencyModal — Ctrl ↵ in the Einsatzort', () => {
  it('creates with the address as typed, not the one committed before', async () => {
    const user = userEvent.setup()
    const onCreateOperation = vi.fn().mockResolvedValue(true)
    renderWithIntl(<NewEmergencyModal open onOpenChange={() => {}} onCreateOperation={onCreateOperation} />)
    const ort = document.getElementById('location_address') as HTMLInputElement

    await user.type(ort, 'Hauptstrasse 12{Enter}')
    await user.clear(ort)
    await user.type(ort, 'Bahnhofstrasse 4{Control>}{Enter}{/Control}')

    expect(onCreateOperation).toHaveBeenCalledTimes(1)
    expect(onCreateOperation).toHaveBeenCalledWith(expect.objectContaining({ location: 'Bahnhofstrasse 4' }))
  })

  it('an emptied Einsatzort refuses, and the next address does not get the old pin', async () => {
    const user = userEvent.setup()
    const onCreateOperation = vi.fn().mockResolvedValue(true)
    renderWithIntl(<NewEmergencyModal open onOpenChange={() => {}} onCreateOperation={onCreateOperation} />)
    const ort = document.getElementById('location_address') as HTMLInputElement

    await user.type(ort, 'Hauptstrasse 12{Enter}')
    await waitFor(() => expect(geocodeAddress).toHaveBeenCalledWith('Hauptstrasse 12', expect.anything()))
    await user.clear(ort)
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onCreateOperation).not.toHaveBeenCalled()

    await user.type(ort, 'Bahnhofstrasse 4{Control>}{Enter}{/Control}')
    expect(onCreateOperation).toHaveBeenCalledWith(
      expect.objectContaining({ location: 'Bahnhofstrasse 4', coordinates: null }),
    )
  })
})
