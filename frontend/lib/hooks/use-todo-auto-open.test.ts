import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTodoAutoOpen } from './use-todo-auto-open'

function setup(initial: string[]) {
  const open = vi.fn()
  const close = vi.fn()
  const hook = renderHook(({ ids }) => useTodoAutoOpen(ids, true, { open, close }), { initialProps: { ids: initial } })
  return { open, close, rerender: (ids: string[]) => hook.rerender({ ids }) }
}

// Owner pick C (bell round 24.11.2026): the rail opens itself on a new to-do, closes when empty.
describe('useTodoAutoOpen', () => {
  it('opens on a new to-do – also one waiting from before the reload', () => {
    const { open, rerender } = setup(['a'])
    expect(open).toHaveBeenCalledTimes(1)
    rerender(['a'])
    expect(open).toHaveBeenCalledTimes(1)
    rerender(['a', 'b'])
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('closes once the list is empty, only when it opened the rail itself', () => {
    const { close, rerender } = setup(['a'])
    rerender([])
    expect(close).toHaveBeenCalledTimes(1)
    rerender([])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('leaves a rail alone that nothing opened', () => {
    const { open, close, rerender } = setup([])
    rerender([])
    expect(open).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})
