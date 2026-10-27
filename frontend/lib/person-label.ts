/**
 * Telling two people of the same name apart («Kennung»).
 *
 * The Kennung (Jahrgang «1985», Personal-Nr. «412») is normally hidden. Only
 * when two or more people on the roster share a name does it follow the name,
 * everywhere a person is named: «Meier Alex · 1985» on the board, «Meier Alex
 * (1985)» in text that leaves it (radio, WhatsApp, Divera, print). A namesake
 * without a Kennung shows «?» — the operator has to know the name is not unique.
 *
 * Pure; the board reads it through `PersonName` / `usePersonNaming`
 * (`components/person-name.tsx`), which hold the roster's ambiguous set.
 */

export interface NamedPerson {
  name: string
  kennung?: string | null
}

/** How the backend's `name_key` compares names: trimmed, inner whitespace
 *  collapsed, case-insensitive. */
export function nameKey(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(" ").toLocaleLowerCase("de-CH")
}

/** The name keys that two or more people of `roster` share. */
export function ambiguousNameKeys(roster: Iterable<{ name: string }>): ReadonlySet<string> {
  const seen = new Set<string>()
  const ambiguous = new Set<string>()
  for (const person of roster) {
    const key = nameKey(person.name)
    if (!key) continue
    if (seen.has(key)) ambiguous.add(key)
    else seen.add(key)
  }
  return ambiguous
}

/** What follows the name: the Kennung, «?» when a namesake has none, or null
 *  when the name is unique on the roster. */
export function shownKennung(person: NamedPerson, ambiguous: ReadonlySet<string>): string | null {
  if (!ambiguous.has(nameKey(person.name))) return null
  return person.kennung?.trim() || "?"
}

/** The person as one line of text: «Meier Alex · 1985» (`style: "inline"`, for
 *  string-only UI slots such as a menu title) or «Meier Alex (1985)»
 *  (`style: "text"`, for radio / WhatsApp / Divera / print). Just the name when
 *  it is unique. */
export function personLabelText(
  person: NamedPerson,
  ambiguous: ReadonlySet<string>,
  style: "inline" | "text" = "text",
): string {
  const kennung = shownKennung(person, ambiguous)
  if (!kennung) return person.name
  return style === "inline" ? `${person.name} · ${kennung}` : `${person.name} (${kennung})`
}

/** How a text output names a person — `usePersonNaming().text` on the board.
 *  The formatters take one so they stay pure; without it they print the name. */
export type PersonText = (person: { name: string; personnelId?: string }) => string

export const plainName: PersonText = (person) => person.name
