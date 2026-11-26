import { useEffect, useRef } from "react"

/**
 * A double-click on a marker or its label opens the Einsatz (`onOpen`) — and only that.
 *
 * Native listener, not React's `onDoubleClick`: MapLibre's double-click zoom listens on the
 * canvas container, which the DOM markers sit in, and React's synthetic events are handled at
 * the root — after the container already zoomed. Stopping the native event here keeps the map
 * where it is while the detail opens.
 */
export function useOpenOnDoubleClick(onOpen?: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(onOpen)
  useEffect(() => { latest.current = onOpen }, [onOpen])
  const enabled = !!onOpen
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) return
    const handler = (event: MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      latest.current?.()
    }
    element.addEventListener("dblclick", handler)
    return () => element.removeEventListener("dblclick", handler)
  }, [enabled])
  return ref
}
