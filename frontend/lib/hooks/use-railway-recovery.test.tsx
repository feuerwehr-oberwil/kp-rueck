/**
 * «Railway ist wieder online» offers «Jetzt synchronisieren» to admins only – the sync
 * endpoint is admin-only, so an editor's click was a 403 behind a spinner that never
 * stopped. The spinner is now replaced in place by the outcome.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { SyncStatusResponse } from '@/types/sync'

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  loading: vi.fn(() => 'sync-toast'),
  error: vi.fn(),
  triggerSyncToRailway: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.success, loading: mocks.loading, error: mocks.error },
}))
vi.mock('@/lib/api-client', () => ({
  apiClient: { triggerSyncToRailway: mocks.triggerSyncToRailway },
}))
vi.mock('@/lib/contexts/notification-context', () => ({
  useNotifications: () => ({ isSidebarOpen: false }),
}))

import { useRailwayRecovery } from './use-railway-recovery'

const status = (railway_healthy: boolean) => ({ railway_healthy }) as SyncStatusResponse

/** Go down, come back, and return what the recovery toast was called with. */
function recover(canSync: boolean) {
  const { rerender } = renderHook(({ s }) => useRailwayRecovery(s, canSync), {
    initialProps: { s: status(false) },
  })
  rerender({ s: status(true) })
  expect(mocks.success).toHaveBeenCalledOnce()
  return mocks.success.mock.calls[0] as [string, { action?: { onClick: () => Promise<void> } }?]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useRailwayRecovery', () => {
  it('tells an editor Railway is back, without offering a sync it may not run', () => {
    const [, options] = recover(false)
    expect(options?.action).toBeUndefined()
  })

  it('offers an admin the sync, and replaces the progress toast with the outcome', async () => {
    mocks.triggerSyncToRailway.mockResolvedValue(undefined)
    const [, options] = recover(true)
    await options?.action?.onClick()
    expect(mocks.triggerSyncToRailway).toHaveBeenCalledOnce()
    expect(mocks.success).toHaveBeenLastCalledWith(expect.any(String), { id: 'sync-toast' })

    mocks.triggerSyncToRailway.mockRejectedValue(new Error('403'))
    await options?.action?.onClick()
    expect(mocks.error).toHaveBeenCalledWith('403', { id: 'sync-toast' })
  })
})
