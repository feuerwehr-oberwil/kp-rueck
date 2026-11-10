/**
 * A `getByText` matcher for an address drawn by `AddressText`
 * (components/kanban/address-text.tsx): the house number rides in its own span, so the plain
 * string matcher – which reads an element's OWN text nodes – no longer finds «Hauptstrasse 1».
 * Matches the element that holds that span (the card heading, the detail title), whose text
 * ends in the address (the card's heading starts with the Einsatz number).
 *
 * Usage: `screen.getByText(byAddress("Hauptstrasse 1"))`
 */
export function byAddress(address: string) {
  return (_content: string, element: Element | null) =>
    element !== null &&
    (element.textContent ?? "").endsWith(address) &&
    Array.from(element.children).some((child) => child.classList.contains("whitespace-nowrap"))
}
