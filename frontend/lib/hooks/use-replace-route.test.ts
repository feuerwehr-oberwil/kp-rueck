import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

import { useReplaceRoute } from './use-replace-route'

describe('useReplaceRoute', () => {
  it('replaces the route once the page names a target, and not while it stays', () => {
    const { rerender } = renderHook(({ href }) => useReplaceRoute(href), {
      initialProps: { href: null as string | null },
    })
    expect(replace).not.toHaveBeenCalled()

    rerender({ href: '/display/board?token=t' })
    expect(replace).toHaveBeenCalledExactlyOnceWith('/display/board?token=t')
  })
})
