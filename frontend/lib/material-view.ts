/**
 * The Material-Leiste's «Filter & Sortierung» (owner note on #370, 24.11.2026 – the same
 * treatment as the Personen-Leiste, `lib/personnel-view.ts`): which of the devices the search
 * left are shown, and how they are grouped.
 *
 * It composes AFTER the search – `useResourceFiltering` narrows by the query, this narrows
 * that result by Status, Standort and Typ and lays it out. Pure, so the sidebar, its popover
 * counts and the tests read one rule:
 *
 *   const { shown, groups } = viewMaterials(searched, prefs)   // what the list draws
 *   const facets = materialFacets(searched, prefs)             // the popover's options and counts
 *
 * Standort and Typ are each «one of»: a device lies in one depot and has one type. Status is
 * `materialResourceState`, the predicate the rows, the counter and the old «Nur Verfügbare»
 * toggle use – Frei is exactly what that toggle kept. The prefs are per browser
 * (`kp-board-materialView`, `usePersistedState`).
 */

import { materialResourceState } from '@/lib/resource-status'

export const MATERIAL_STATUSES = ['all', 'free', 'bound', 'not-ready'] as const
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number]

/** `location` is today's depot list; `type` regroups by Typ, the depots inside each group. */
export const MATERIAL_SORTS = ['location', 'type'] as const
export type MaterialSort = (typeof MATERIAL_SORTS)[number]

export interface MaterialViewPrefs {
  status: MaterialStatus
  /** Depots as stored on the device (`category`); `''` is «no Standort». */
  locations: string[]
  /** Typ values as stored (`type`); `''` is «no Typ». */
  types: string[]
  sort: MaterialSort
}

/** localStorage key – the `kp-board-*` family of the other per-device board prefs. */
export const MATERIAL_VIEW_KEY = 'kp-board-materialView'

export const DEFAULT_MATERIAL_VIEW: MaterialViewPrefs = {
  status: 'all',
  locations: [],
  types: [],
  sort: 'location',
}

/** The fields the view reads – a `Material` fits, and so does a test row. */
export type ViewableMaterial = Parameters<typeof materialResourceState>[0] & {
  name: string
  category: string
  type: string
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  options.some((option) => option === value)

/** Guard for the stored prefs – a key written by another build must not reach the list. */
export function isMaterialViewPrefs(value: unknown): value is MaterialViewPrefs {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isOneOf(MATERIAL_STATUSES, v.status) &&
    isOneOf(MATERIAL_SORTS, v.sort) &&
    isStringArray(v.locations) &&
    isStringArray(v.types)
  )
}

/** The number on the filter button: each chosen value counts; the sort is not a filter. */
export function materialFilterCount(prefs: MaterialViewPrefs): number {
  return (prefs.status === 'all' ? 0 : 1) + prefs.locations.length + prefs.types.length
}

/** True when the list is today's: every device, by depot. */
export function isDefaultMaterialView(prefs: MaterialViewPrefs): boolean {
  return materialFilterCount(prefs) === 0 && prefs.sort === DEFAULT_MATERIAL_VIEW.sort
}

/** Frei, Gebunden (on an Einsatz or Auftrag) or «Nicht einsatzbereit». Consumables are frei. */
export function materialStatusOf(material: ViewableMaterial): Exclude<MaterialStatus, 'all'> {
  const state = materialResourceState(material)
  if (state === 'available') return 'free'
  return state === 'assigned' ? 'bound' : 'not-ready'
}

function matches(material: ViewableMaterial, prefs: MaterialViewPrefs): boolean {
  if (prefs.status !== 'all' && materialStatusOf(material) !== prefs.status) return false
  if (prefs.locations.length > 0 && !prefs.locations.includes(material.category)) return false
  return prefs.types.length === 0 || prefs.types.includes(material.type)
}

/** Distinct keys in first-seen order, with how often each occurs. */
function countInOrder<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1)
  return counts
}

/** Typ order: alphabetical (de-CH), «no Typ» last. */
const compareTypes = (a: string, b: string) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0) || a.localeCompare(b, 'de-CH')

/** One heading of the list and its depots: by depot, the one depot itself; by Typ, each
 *  depot that holds devices of that type, in the station's depot order. */
export interface MaterialGroupView<T> {
  key: string
  places: { location: string; items: T[] }[]
}

function byLocation<T extends ViewableMaterial>(items: readonly T[]): { location: string; items: T[] }[] {
  const places = new Map<string, T[]>()
  for (const item of items) {
    const list = places.get(item.category)
    if (list) list.push(item)
    else places.set(item.category, [item])
  }
  return [...places].map(([location, list]) => ({ location, items: list }))
}

/**
 * What the list draws: the shown devices (for the counter) and their groups, input order kept
 * inside each – the API's depot order, then name. By depot one group per depot (the sidebar
 * draws its modules there); by Typ one group per type, its depots as sub-groups, so two
 * identical devices in different depots never fold into one row.
 */
export function viewMaterials<T extends ViewableMaterial>(
  materials: readonly T[],
  prefs: MaterialViewPrefs,
): { shown: T[]; groups: MaterialGroupView<T>[] } {
  const shown = materials.filter((material) => matches(material, prefs))
  if (prefs.sort === 'location') {
    return { shown, groups: byLocation(shown).map((place) => ({ key: place.location, places: [place] })) }
  }
  const types = [...countInOrder(shown, (material) => material.type).keys()].sort(compareTypes)
  return {
    shown,
    groups: types.map((type) => ({ key: type, places: byLocation(shown.filter((m) => m.type === type)) })),
  }
}

export interface MaterialFacet {
  key: string
  count: number
}

/**
 * The popover's options, counted over every device the search left (not narrowed by the other
 * filters – the numbers say how big each choice is). Units, not rows: «Tauchpumpe 3/4» is 4.
 *
 * Standorte in the station's depot order, Typen alphabetical. A chosen value no device carries
 * any more stays listed with 0, so it can be seen and unticked instead of silently emptying
 * the list.
 */
export function materialFacets(
  materials: readonly ViewableMaterial[],
  prefs: MaterialViewPrefs,
): { status: Record<MaterialStatus, number>; locations: MaterialFacet[]; types: MaterialFacet[] } {
  const status: Record<MaterialStatus, number> = { all: materials.length, free: 0, bound: 0, 'not-ready': 0 }
  for (const material of materials) status[materialStatusOf(material)] += 1

  const withChosen = (counts: Map<string, number>, chosen: readonly string[]) => {
    for (const key of chosen) if (!counts.has(key)) counts.set(key, 0)
    return [...counts].map(([key, count]) => ({ key, count }))
  }
  const locations = withChosen(countInOrder(materials, (m) => m.category), prefs.locations)
  const types = withChosen(countInOrder(materials, (m) => m.type), prefs.types).sort((a, b) =>
    compareTypes(a.key, b.key),
  )
  return { status, locations, types }
}
