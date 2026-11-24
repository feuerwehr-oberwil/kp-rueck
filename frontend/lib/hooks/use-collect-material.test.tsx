import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import de from '@/messages/de.json'

const api = vi.hoisted(() => ({ collectMaterial: vi.fn(), undoCollectMaterial: vi.fn() }))
const refreshOperations = vi.hoisted(() => vi.fn(async () => {}))
const undo = vi.hoisted(() => ({ undoToast: vi.fn() }))
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: api,
}))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ({ refreshOperations }) }))
vi.mock('@/lib/toast-undo', () => undo)
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { useCollectMaterial } from './use-collect-material'

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">{children}</NextIntlClientProvider>
)

beforeEach(() => {
  api.collectMaterial.mockReset().mockResolvedValue(undefined)
  api.undoCollectMaterial.mockReset().mockResolvedValue(undefined)
  undo.undoToast.mockReset()
})

describe('useCollectMaterial', () => {
  it('releases that one assignment, offers the undo, and the undo re-opens the same one', async () => {
    const { result } = renderHook(() => useCollectMaterial(), { wrapper })
    expect(await result.current({ incidentId: 'i-1', assignmentId: 'a-2', name: 'Wassersauger' })).toBe(true)
    expect(api.collectMaterial).toHaveBeenCalledExactlyOnceWith('i-1', 'a-2')
    expect(refreshOperations).toHaveBeenCalled()

    const [message, options] = undo.undoToast.mock.calls[0]
    expect(message).toBe('Wassersauger abgeholt – freigegeben')
    await options.onUndo()
    expect(api.undoCollectMaterial).toHaveBeenCalledExactlyOnceWith('i-1', 'a-2')
  })

  it('a refused release offers no undo', async () => {
    api.collectMaterial.mockRejectedValue(new Error('409'))
    const { result } = renderHook(() => useCollectMaterial(), { wrapper })
    expect(await result.current({ incidentId: 'i-1', assignmentId: 'a-2', name: 'Wassersauger' })).toBe(false)
    expect(undo.undoToast).not.toHaveBeenCalled()
  })
})
