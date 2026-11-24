import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import de from '@/messages/de.json'

const api = vi.hoisted(() => ({ getRapportMaterialReturn: vi.fn(), unassignResource: vi.fn() }))
const refreshOperations = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: api,
}))
vi.mock('@/lib/contexts/operations-context', () => ({ useOperations: () => ({ refreshOperations }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { useMaterialRelease } from './use-material-release'

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">{children}</NextIntlClientProvider>
)
const unit = (id: string) => ({ assignment_id: id, material_id: `m-${id}`, name: id, location: null, used: true, answered: true })

beforeEach(() => {
  api.getRapportMaterialReturn.mockReset().mockResolvedValue({ returned: [unit('a-1'), unit('a-2')], left_on_site: [], left_on_site_named: [] })
  api.unassignResource.mockReset().mockResolvedValue(undefined)
})

describe('useMaterialRelease', () => {
  it('asks the server nothing before a rapport is filed', () => {
    const { result } = renderHook(() => useMaterialRelease('i-1', { enabled: false, refreshKey: 0 }), { wrapper })
    expect(api.getRapportMaterialReturn).not.toHaveBeenCalled()
    expect(result.current.units).toEqual([])
  })

  it('releases exactly the assignments it is given, then reloads the set', async () => {
    const { result } = renderHook(() => useMaterialRelease('i-1', { enabled: true, refreshKey: 0 }), { wrapper })
    await waitFor(() => expect(result.current.units).toHaveLength(2))

    // The caller dropped a-2: the form marks it «vor Ort» right now.
    await act(() => result.current.release(['a-1']))

    expect(api.unassignResource).toHaveBeenCalledExactlyOnceWith('i-1', 'a-1')
    expect(refreshOperations).toHaveBeenCalled()
    expect(api.getRapportMaterialReturn).toHaveBeenCalledTimes(2)
  })

  it('refetches when the rapport is filed again', async () => {
    const { rerender } = renderHook(({ key }) => useMaterialRelease('i-1', { enabled: true, refreshKey: key }), {
      wrapper,
      initialProps: { key: 0 },
    })
    await waitFor(() => expect(api.getRapportMaterialReturn).toHaveBeenCalledTimes(1))
    rerender({ key: 1 })
    await waitFor(() => expect(api.getRapportMaterialReturn).toHaveBeenCalledTimes(2))
  })

  it('drops a late answer to an older request', async () => {
    let answerFirst: (value: unknown) => void = () => {}
    api.getRapportMaterialReturn
      .mockReset()
      .mockImplementationOnce(() => new Promise(resolve => (answerFirst = resolve)))
      .mockResolvedValueOnce({ returned: [], left_on_site: [unit('a-1')], left_on_site_named: [] })
    const { result, rerender } = renderHook(({ key }) => useMaterialRelease('i-1', { enabled: true, refreshKey: key }), {
      wrapper,
      initialProps: { key: 0 },
    })

    // A save filed the rapport again (the pump is «vor Ort» now) before the first answer came.
    rerender({ key: 1 })
    await waitFor(() => expect(api.getRapportMaterialReturn).toHaveBeenCalledTimes(2))

    // The first, older answer still lists the pump as releasable – and is ignored.
    await act(async () => answerFirst({ returned: [unit('a-1')], left_on_site: [], left_on_site_named: [] }))
    expect(result.current.units).toEqual([])
  })
})
