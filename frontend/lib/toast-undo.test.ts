/**
 * One «Rückgängig» toast: unmuted, timed like a toast with a button, one shot –
 * and ⌘Z reaches the newest one still standing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type Data = {
  duration?: number
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void
  onAutoClose?: () => void
}
const shown = vi.hoisted(() => [] as Array<{ kind: string; message: unknown; data: Data }>)
const dismissed = vi.hoisted(() => [] as Array<string | number>)
vi.mock('sonner', () => {
  let next = 0
  const record = (kind: string) => (message: unknown, data: Data) => {
    shown.push({ kind, message, data })
    return ++next
  }
  return {
    toast: Object.assign(record('bare'), {
      success: record('success'),
      dismiss: (id: string | number) => dismissed.push(id),
    }),
  }
})

import { undoNewest, undoToast } from './toast-undo'
import { TOAST_ACTION_MIN_MS } from './toast-lifetime'

afterEach(() => {
  // Leave no toast standing for the next test.
  for (const { data } of shown) data.onDismiss?.()
  shown.length = 0
  dismissed.length = 0
})

describe('undoToast', () => {
  it('is a bare toast (shown on quiet surfaces) with «Rückgängig» and the button floor', () => {
    undoToast('Fahrzeug freigegeben', { onUndo: vi.fn() })
    const [{ kind, data }] = shown
    expect(kind).toBe('bare')
    expect(data.action?.label).toBe('Rückgängig')
    expect(data.duration).toBeGreaterThanOrEqual(TOAST_ACTION_MIN_MS)
  })

  it('runs the undo once, however often the button is pressed', () => {
    const onUndo = vi.fn()
    undoToast('Fahrzeug freigegeben', { onUndo })
    shown[0].data.action?.onClick()
    shown[0].data.action?.onClick()
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
})

describe('undoToast with a key', () => {
  // «Fahrer bleibt vor Ort», then «kehrt zurück»: one toast, and ⌘Z goes back one step.
  it('replaces the standing toast with that key, and only the newest undo stays', () => {
    const first = vi.fn()
    const second = vi.fn()
    const other = vi.fn()
    undoToast('Andere', { onUndo: other })
    const replaced = undoToast('Mowa: Fahrer bleibt vor Ort', { key: 'driver-stay:op-1:v-mowa', onUndo: first })
    undoToast('Mowa: Fahrer kehrt zurück', { key: 'driver-stay:op-1:v-mowa', onUndo: second })
    expect(dismissed).toEqual([replaced])

    expect(undoNewest()).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(undoNewest()).toBe(true)
    expect(first).not.toHaveBeenCalled()
    expect(other).toHaveBeenCalledTimes(1)
  })
})

describe('undoNewest (⌘Z)', () => {
  it('runs the newest standing undo and closes its toast', () => {
    const first = vi.fn()
    const second = vi.fn()
    undoToast('A', { onUndo: first })
    const id = undoToast('B', { onUndo: second })

    expect(undoNewest()).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(dismissed).toEqual([id])

    expect(undoNewest()).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('skips toasts that timed out, were closed or were already used', () => {
    const timedOut = vi.fn()
    const closed = vi.fn()
    const used = vi.fn()
    undoToast('A', { onUndo: timedOut })
    undoToast('B', { onUndo: closed })
    undoToast('C', { onUndo: used })
    shown[0].data.onAutoClose?.()
    shown[1].data.onDismiss?.()
    shown[2].data.action?.onClick()

    expect(undoNewest()).toBe(false)
    expect(timedOut).not.toHaveBeenCalled()
    expect(closed).not.toHaveBeenCalled()
    expect(used).toHaveBeenCalledTimes(1)
  })
})
