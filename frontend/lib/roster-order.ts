/**
 * One order for the roster, wherever it is read.
 *
 * Three surfaces list the same people and each had grown its own comparator:
 * the Anwesenheit modal on the board sorted the full name in `de-CH`, the
 * `/check-in` tablet sorted the lowercased *first word* in the browser's
 * locale, and the `/feld` picker sorted the full name in whatever locale the
 * phone had picked. They agree on almost every roster and then disagree on
 * exactly the rows a roll call trips over — two Müller, an Ö, a double surname.
 * A person hunting for their own name must not have to learn three lists.
 *
 * **`de-CH`, not the UI locale.** Names are roster data, not interface copy: the
 * KP reading the list out and the crew scanning it on a phone in French must see
 * the same sequence, or "der Dritte von unten" stops being a usable sentence.
 *
 * The names are written «NACHNAME Vorname», so comparing the whole string sorts
 * by surname and then by first name — which is why the special-cased first word
 * was never needed and only cost the tie-break.
 */

/** Compare two roster rows by name. Pass to `Array.prototype.sort`. */
export function compareByName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'de-CH')
}

/** The roster in reading order. Copies rather than sorting in place — the lists
 *  it feeds come straight out of state and must not be mutated under React. */
export function sortByName<T extends { name: string }>(people: readonly T[]): T[] {
  return [...people].sort(compareByName)
}
