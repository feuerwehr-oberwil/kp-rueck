/**
 * The keyboard's right-click: Shift+F10 or the ContextMenu key.
 *
 * Browsers turn these into a `contextmenu` event only on some platforms (not on macOS), so
 * a focused element that owns a menu checks the key itself – the card
 * (`draggable-operation.tsx`) and the resource chip (`removable-chip.tsx`).
 */
export function isContextMenuKey(event: Pick<KeyboardEvent, "key" | "shiftKey">): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")
}

/**
 * Opens a Radix `ContextMenu` whose trigger contains `element`, from the keyboard: the
 * trigger opens on a `contextmenu` event at its coordinates, so this sends one at the
 * element's top-left corner (inset a little, so the menu sits on the element).
 */
export function openContextMenuAt(element: HTMLElement): void {
  const rect = element.getBoundingClientRect()
  element.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + 16, clientY: rect.top + 16 }),
  )
}
