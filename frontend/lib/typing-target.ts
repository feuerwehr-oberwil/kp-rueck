/**
 * True when a key event's target is a field somebody is typing into – a bare `s`
 * or a Shift+1 must never be eaten out of one. The one rule for every keyboard
 * surface: the board, the map, the wall display, the incident detail and the
 * global `g`-navigation. (`isTypingTarget` in `lib/viewport-insets` asks a
 * different question – «does this raise an on-screen keyboard?».)
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (!(target instanceof HTMLElement)) return false
  // The attribute too, not only `isContentEditable`: a key typed into a child
  // of an editor (a <span> inside a rich-text field) must count as typing.
  if (target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])')) return true
  const role = target.getAttribute("role")
  return role === "combobox" || role === "listbox" || role === "option"
}
