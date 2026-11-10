/**
 * An address as text that WRAPS without stranding its house number (hill climb r21): the
 * space before a number and the number itself ride in one `whitespace-nowrap` span, so
 * «Kirchgasse 3» never leaves the «3» alone on the next line, while the street name can still
 * break at a syllable (`WALL_TEXT_WRAP`'s hyphenation). A no-break space would not do: it
 * glues street and number into one «word» that the browser no longer hyphenates, and a 260px
 * column then cut «Reinacherstrass|e 30» mid-word.
 *
 * Render-time only – the stored address and every search keep the plain text. Only a space
 * after a letter or «.» and before a digit binds, so «28, 4104 Oberwil» still breaks after
 * the comma.
 *
 * Usage: `<AddressText text={getIncidentLocationLabel(op)} />` wherever an address heading wraps.
 */
export function AddressText({ text }: { text: string }) {
  return houseNumberParts(text).map((part, i) =>
    i % 2 === 1 ? <span key={i} className="whitespace-nowrap">{part}</span> : part,
  )
}

/** The address cut so that every odd part is « 3» – a space plus the house number after it. */
export function houseNumberParts(text: string): string[] {
  return text.split(/(?<=[\p{L}.])([ \t]+\d[^\s,]*)/u)
}
