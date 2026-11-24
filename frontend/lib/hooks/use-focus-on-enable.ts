import { type RefObject, useEffect, useRef } from 'react'

/**
 * Focus `ref` each time `enabled` turns true after being false – a disabled button drops
 * the focus, and the answer Enter gives must get it back once it is live again. The first
 * render focuses nothing: the opening focus is the dialog's own.
 *
 *   useFocusOnEnable(confirmRef, open && busy === null && !confirmDisabled)
 */
export function useFocusOnEnable(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  const wasEnabled = useRef(enabled)
  useEffect(() => {
    if (enabled && !wasEnabled.current) ref.current?.focus({ preventScroll: true })
    wasEnabled.current = enabled
  }, [enabled, ref])
}
