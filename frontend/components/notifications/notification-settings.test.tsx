import { describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '@/lib/types/notification'

const mocks = vi.hoisted(() => ({
  settings: null as unknown as NotificationSettings,
  updateSettings: vi.fn(async () => {}),
  resolveMaterials: (() => {}) as (materials: Array<{ location: string }>) => void,
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/contexts/notification-context', () => ({
  useNotifications: () => ({ settings: mocks.settings, updateSettings: mocks.updateSettings }),
}))
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getAllMaterials: () => new Promise((resolve) => (mocks.resolveMaterials = resolve)),
  },
}))

import { NotificationSettingsCard } from '@/components/notifications/notification-settings'

/**
 * Opening the Warnungen settings writes nothing.
 *
 * On a reload of /settings the card mounts with the provider's DEFAULTS (the station's
 * settings are still on their way). Its mount-only effect used to seed a threshold per
 * material location by PATCHing `{ ...settings, … }` from that first render – the defaults –
 * over the station's real configuration (FE-08: a silenced exhaustive-deps).
 */
describe('NotificationSettingsCard', () => {
  it('does not write the settings it mounted with once the materials arrive', async () => {
    mocks.settings = DEFAULT_NOTIFICATION_SETTINGS
    const { rerender } = renderWithIntl(<NotificationSettingsCard />)

    // The station's settings land, then the materials.
    mocks.settings = { ...DEFAULT_NOTIFICATION_SETTINGS, fatigue_hours: 9, material_depletion_threshold: { Atemschutz: 3 } }
    rerender(<NotificationSettingsCard />)
    await act(async () => mocks.resolveMaterials([{ location: 'Atemschutz' }, { location: 'Pumpen' }]))

    expect(mocks.updateSettings).not.toHaveBeenCalled()
    // A location without a threshold reads as off, the way the server treats it.
    expect(screen.getByRole('checkbox', { name: 'Pumpen' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Atemschutz' })).toBeChecked()
  })
})
