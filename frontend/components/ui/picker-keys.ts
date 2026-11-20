import type { KeyboardEvent } from 'react'

/** Marks a tile the arrows walk (PersonPickTile, the vehicle and material tiles). */
export const PICK_TILE_ATTR = 'data-pick-tile'
/** Marks the footer whose last button is the picker's main answer. */
export const PICKER_FOOTER_ATTR = 'data-picker-footer'

export const PICK_TILE = { [PICK_TILE_ATTR]: '' } as const
export const PICKER_FOOTER = { [PICKER_FOOTER_ATTR]: '' } as const

const STEPS: Partial<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }

/**
 * The keys of a picker (owner, 19.11.2026: «space = select, enter = finish selection / move on
 * to next stage»). One handler for every picker – `PickerDialog` (Fahrer, Reko zuweisen /
 * übertragen, Reko-Modus) and the assignment dialog (Mannschaft, Fahrzeuge, Material) – put on
 * the element that holds the search, the list and the footer: `onKeyDown={onPickerKeyDown}`.
 *
 * - **Space** ticks / unticks the focused tile: tiles are buttons, so that is the browser's own
 *   activation, untouched here. In the search field Space types a space (names have spaces).
 * - **Enter** anywhere in the picker – the search field and the tiles included – is the main
 *   answer: the LAST button of the `PICKER_FOOTER` («Übernehmen», «Fertig», «Als Reko
 *   markieren»), and only while it is enabled. Another control (Abbrechen, «Filter
 *   zurücksetzen», the ✕) keeps its own Enter.
 * - **↓** from the search field goes to the first tile; ↓ / ↑ (and → / ←) walk the tiles in
 *   the order they are drawn; ↑ on the first tile goes back to the search field.
 *
 * The 1–9 keys stay with the assignment dialog. A key from a layer portalled out of the
 * picker (a menu, a question over it) is not the picker's: React bubbles it here, the DOM does not.
 */
export function onPickerKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  const picker = event.currentTarget
  const target = event.target
  if (!(target instanceof HTMLElement) || !picker.contains(target)) return

  const tile = target.closest<HTMLElement>(`[${PICK_TILE_ATTR}]`)
  const search = picker.querySelector<HTMLInputElement>('input[type="text"]')

  if (event.key === 'Enter') {
    if (target instanceof HTMLTextAreaElement) return
    const ownControl = !tile && !(target instanceof HTMLInputElement) && target.closest('button, a[href], [role="button"]')
    if (ownControl) return
    event.preventDefault()
    event.stopPropagation()
    const buttons = picker.querySelector(`[${PICKER_FOOTER_ATTR}]`)?.querySelectorAll('button')
    const main = buttons?.[buttons.length - 1]
    if (main && !main.disabled) main.click()
    return
  }

  const step = STEPS[event.key]
  if (step === undefined) return
  const tiles = [...picker.querySelectorAll<HTMLElement>(`[${PICK_TILE_ATTR}]:not(:disabled)`)]
  let next: HTMLElement | null | undefined
  if (tile) {
    const at = tiles.indexOf(tile)
    next = at === 0 && step < 0 && event.key === 'ArrowUp' ? search : tiles[at + step]
  } else if (target === search && event.key === 'ArrowDown') {
    next = tiles[0]
  }
  if (!next) return
  event.preventDefault()
  event.stopPropagation()
  next.focus()
}
