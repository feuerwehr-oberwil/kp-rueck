/**
 * A hole in a sheet's backdrop over the ONE element under the pointer that may be grabbed.
 *
 * A footer sheet's backdrop absorbs the pointer on purpose (components/ui/sheet.tsx): the dimmed
 * board must not light up or take clicks. The Aufträge sheet still needs one thing from the
 * board – a card dragged onto an Auftrag (owner pick A, 26.11.2026). So while the pointer is over
 * an element matching `selector` under the backdrop, the backdrop's `clip-path` cuts that
 * element out: it shows undimmed, and because clip-path also clips hit testing, the pointer
 * reaches it – hover, press and drag as usual. Everywhere else the backdrop stays whole.
 *
 * Usage: call when the backdrop mounts, call the returned function when it unmounts.
 */
export function openHoleOver(backdrop: HTMLElement, selector: string): () => void {
  let current: Element | null = null
  let last: { x: number; y: number } | null = null
  let frame = 0

  /** What may be grabbed at this point, under the backdrop – null over the sheet or bare board. */
  const grabbableAt = (x: number, y: number) =>
    // no hit testing without layout (jsdom in the unit tests): no hole
    document.elementsFromPoint?.(x, y).find((node) => node !== backdrop)?.closest(selector) ?? null

  const draw = () => {
    if (!current) {
      backdrop.style.clipPath = ''
      return
    }
    const b = backdrop.getBoundingClientRect()
    const r = current.getBoundingClientRect()
    // 4px of air round the element, so its own focus/selection frame is not cut
    const x = r.left - b.left - 4
    const y = r.top - b.top - 4
    const w = r.width + 8
    const h = r.height + 8
    backdrop.style.clipPath = `path(evenodd, "M0 0H${b.width}V${b.height}H0Z M${x} ${y}h${w}v${h}h${-w}Z")`
  }

  const update = () => {
    frame = 0
    if (!last) return
    // drawn again even for the same element: it may have grown (a stop row after a drop)
    current = grabbableAt(last.x, last.y)
    draw()
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  // On the window: inside the hole the pointer is over the element, no longer over the backdrop.
  const onMove = (event: PointerEvent) => {
    last = { x: event.clientX, y: event.clientY }
    schedule()
  }
  // A native drag fires dragover, not pointermove. The hole stays put while it runs (no other
  // card opens under the dragged one); only where it ends is noted, for `reset` on dragend.
  const onDragOver = (event: DragEvent) => {
    last = { x: event.clientX, y: event.clientY }
  }
  // A column scrolled under a resting pointer, or a drag just ended (no pointermove until the
  // mouse moves again): the hole follows what is under the pointer now.
  const reset = () => {
    current = null
    draw()
    schedule()
  }

  window.addEventListener('pointermove', onMove, { capture: true, passive: true })
  window.addEventListener('scroll', reset, { capture: true, passive: true })
  window.addEventListener('dragover', onDragOver, { capture: true, passive: true })
  window.addEventListener('dragend', reset, { capture: true })
  return () => {
    window.removeEventListener('pointermove', onMove, { capture: true })
    window.removeEventListener('scroll', reset, { capture: true })
    window.removeEventListener('dragover', onDragOver, { capture: true })
    window.removeEventListener('dragend', reset, { capture: true })
    if (frame) cancelAnimationFrame(frame)
    backdrop.style.clipPath = ''
  }
}
