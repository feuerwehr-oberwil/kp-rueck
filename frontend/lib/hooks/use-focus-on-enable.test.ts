import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFocusOnEnable } from './use-focus-on-enable'

describe('useFocusOnEnable', () => {
  const button = document.createElement('button')
  document.body.append(button)
  const ref = { current: button }
  afterEach(() => button.blur())

  it('focuses when enabled turns true, not on the first render', () => {
    const { rerender } = renderHook(({ enabled }) => useFocusOnEnable(ref, enabled), { initialProps: { enabled: true } })
    expect(button).not.toHaveFocus()

    rerender({ enabled: false })
    expect(button).not.toHaveFocus()
    rerender({ enabled: true })
    expect(button).toHaveFocus()
  })
})
