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

/**
 * The Grad as a row suffix — «Wachtmeister» would eat half a 240px sidebar
 * row. Known grades map to their Swiss service abbreviations; an unknown one
 * that is still long is cut to its first six letters with a period. Whoever
 * needs the full word gets it from the row's tooltip.
 */
const RANK_ABBREVIATIONS: Record<string, string> = {
  Rekrut: 'Rekr',
  Soldat: 'Sdt',
  Feuerwehrmann: 'Fwm',
  Feuerwehrfrau: 'Fwf',
  Mannschaft: 'Mschft',
  Gefreiter: 'Gfr',
  Korporal: 'Kpl',
  Wachtmeister: 'Wm',
  Feldweibel: 'Fw',
  Fourier: 'Four',
  Adjutant: 'Adj',
  Leutnant: 'Lt',
  Oberleutnant: 'Oblt',
  Hauptmann: 'Hptm',
  Major: 'Maj',
  Gruppenführer: 'Grfhr',
  Zugführer: 'Zfhr',
  'Zugführer-Stv.': 'Zfhr-Stv',
  Offizier: 'Of',
  Offiziere: 'Of',
  Kommandant: 'Kdt',
  'Kommandant-Stv.': 'Kdt-Stv',
}

/** The settings key holding the station's own abbreviations (JSON object). */
export const RANK_ABBREVIATIONS_KEY = 'personnel.role_abbreviations'

/**
 * Station overrides, mirrored module-level from the settings load — same
 * pattern as the home city (`setGlobalHomeCity`), so the memoized sidebar rows
 * need no provider to read it.
 */
let globalRankOverrides: Record<string, string> = {}

export function setGlobalRankAbbreviations(json: string): void {
  try {
    const parsed: unknown = JSON.parse(json || '{}')
    globalRankOverrides =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {}
  } catch {
    globalRankOverrides = {}
  }
}

export function abbreviateRank(role: string): string {
  const override = globalRankOverrides[role]?.trim()
  if (override) return override
  const known = RANK_ABBREVIATIONS[role]
  if (known) return known
  return role.length > 8 ? `${role.slice(0, 6)}.` : role
}

/** Compare two roster rows by name. Pass to `Array.prototype.sort`. */
export function compareByName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'de-CH')
}

/** The roster in reading order. Copies rather than sorting in place — the lists
 *  it feeds come straight out of state and must not be mutated under React. */
export function sortByName<T extends { name: string }>(people: readonly T[]): T[] {
  return [...people].sort(compareByName)
}

/** A row that also carries where its rank sits in the station's own order. */
export interface RankedPerson {
  name: string
  role?: string | null
  roleSortOrder?: number | null
}

/**
 * Rank first, then name — for the surfaces that GROUP by Grad.
 *
 * Two orders are correct in this app, and the difference is what the list is
 * for. A roll call is read out name by name and is flat alphabetical
 * (`compareByName`): somebody hunting for their own name must not have to know
 * their rank first. A picker the KP assigns *from* is grouped by rank, because
 * "wer ist als Offizier noch frei" is the question it answers.
 *
 * `role_sort_order` is the station's own ordering, editable in Einstellungen —
 * the rank *label* is only the tie-break behind it, and `de-CH` there for the
 * same reason names use it: rank names are roster data, not interface copy.
 */
export function compareByRankThenName(a: RankedPerson, b: RankedPerson): number {
  const rank = (a.roleSortOrder ?? 0) - (b.roleSortOrder ?? 0)
  if (rank !== 0) return rank
  const label = (a.role ?? '').localeCompare(b.role ?? '', 'de-CH')
  return label !== 0 ? label : compareByName(a, b)
}
