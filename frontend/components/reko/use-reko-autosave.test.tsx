import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { EMPTY_REKO_FORM } from '@/components/reko/reko-report-form'

const createRekoReportAsEditor = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { createRekoReportAsEditor, updateRekoReport: vi.fn() },
}))

import { useRekoAutosave } from '@/components/reko/use-reko-autosave'

type Autosave = ReturnType<typeof useRekoAutosave>

/** Mounts the hook the way the board does – inside Strict Mode, rendered directly (RTL's
 *  `renderHook` wrapper does not get Strict Mode's double effect run). */
function mount(): { hook: () => Autosave; unmount: () => void } {
  let current: Autosave | null = null
  function Host() {
    current = useRekoAutosave({ incidentId: 'i-strict', userId: 'u-1' })
    return null
  }
  const { unmount } = render(<StrictMode><Host /></StrictMode>)
  return { hook: () => current!, unmount }
}

// Sol pass 3, S1: Strict Mode runs setup – cleanup – setup. The cleanup must not evict the
// idle session the second setup goes on using, or the next mount starts from nothing.
describe('useRekoAutosave under Strict Mode', () => {
  it('keeps one session per Einsatz through the double setup', async () => {
    createRekoReportAsEditor.mockReturnValue(new Promise(() => {}))
    const first = mount()
    await act(async () => {}) // a deferred eviction would run here

    const edited = { ...EMPTY_REKO_FORM, summary_text: 'Keller voll' }
    act(() => {
      first.hook().resume(null)
      first.hook().schedule(edited)
      first.hook().flush()
    })
    first.unmount()

    expect(mount().hook().resume(null)).toEqual(edited)
  })
})
