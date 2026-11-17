import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/types'
import { restoreDeletedIncident } from './restore-incident'

const mocks = vi.hoisted(() => ({ restore: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/api-client', async () => ({
  ApiError: (await import('@/lib/api/types')).ApiError,
  apiClient: { restoreIncident: mocks.restore },
}))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))

beforeEach(() => vi.resetAllMocks())

describe('incident recovery', () => {
  it('refreshes silently after another board restored it', async () => {
    mocks.restore.mockRejectedValue(new ApiError('Already restored', 409, true, 'incident_already_restored'))
    const refresh = vi.fn()
    expect(await restoreDeletedIncident('i1', refresh)).toBe(true)
    expect(refresh).toHaveBeenCalledOnce()
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it.each([
    new ApiError('Pumpe ist nicht verfügbar', 409, true, 'incident_restore_resource_conflict'),
    new ApiError('Conflict', 409, true),
    new Error('Offline'),
  ])('offers a fresh attempt on a real failure', async (error) => {
    mocks.restore.mockRejectedValueOnce(error).mockResolvedValueOnce({ id: 'i1' })
    const refresh = vi.fn()
    expect(await restoreDeletedIncident('i1', refresh)).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
    const options = mocks.error.mock.calls[0][1]
    if (error instanceof ApiError) expect(options.description).toBe(error.message)
    options.action.onClick()
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledOnce())
    expect(refresh).toHaveBeenCalledOnce()
  })
})
