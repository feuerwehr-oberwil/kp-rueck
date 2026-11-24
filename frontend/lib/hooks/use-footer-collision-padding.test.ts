import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

import { useFooterCollisionPadding } from './use-footer-collision-padding'

afterEach(() => {
  document.documentElement.style.removeProperty('--nav-reserve')
})

// Sol review H: a Select rendered before the phone nav measured itself kept 8px and opened over the nav.
describe('useFooterCollisionPadding', () => {
  it('picks up the nav height published after the menu rendered', async () => {
    const { result } = renderHook(() => useFooterCollisionPadding())
    expect(result.current.bottom).toBe(8)

    act(() => {
      document.documentElement.style.setProperty('--nav-reserve', '65px')
    })
    await waitFor(() => expect(result.current.bottom).toBe(69))
    expect(result.current).toEqual({ top: 8, left: 8, right: 8, bottom: 69 })
  })
})
