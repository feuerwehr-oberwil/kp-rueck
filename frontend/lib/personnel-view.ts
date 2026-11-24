/**
 * The Personen-Leiste's «Filter & Sortierung» (owner pick 4A, 23.11.2026): which of the
 * people the search left are shown, and in what order.
 *
 * It composes AFTER the search – `useResourceFiltering` narrows by the query, this narrows
 * that result by Status, Grad and Tags and lays it out. Pure, so the sidebar, its popover
 * counts and the tests read one rule:
 *
 *   const view = viewPersonnel(searched, prefs)      // what the list draws
 *   const facets = personnelFacets(searched, prefs)  // the popover's options and counts
 *
 * Grad is «one of» (Wm OR Kpl), Tags are «all of» (F AND Hö): a grade is exclusive, tags pile
 * up. «Frei» / «Gebunden» are `isPersonOccupied`, the same predicate the counter and the cards
 * use. The prefs are per browser (`kp-board-personnelView`, `usePersistedState`).
 */

import { isPersonOccupied } from '@/lib/resource-status'
import { compareByName, compareByRankThenName } from '@/lib/roster-order'

export const PERSONNEL_STATUSES = ['all', 'free', 'bound'] as const
export type PersonnelStatus = (typeof PERSONNEL_STATUSES)[number]

/** `free-first` is today's Frei · n / Gebunden · n groups; the other two are one flat list. */
export const PERSONNEL_SORTS = ['free-first', 'rank', 'name'] as const
export type PersonnelSort = (typeof PERSONNEL_SORTS)[number]

export interface PersonnelViewPrefs {
  status: PersonnelStatus
  /** Grad values as stored on the person (`role`); `''` is «no Grad». */
  grades: string[]
  tags: string[]
  sort: PersonnelSort
}

/** localStorage key – the `kp-board-*` family of the other per-device board prefs. */
export const PERSONNEL_VIEW_KEY = 'kp-board-personnelView'

export const DEFAULT_PERSONNEL_VIEW: PersonnelViewPrefs = {
  status: 'all',
  grades: [],
  tags: [],
  sort: 'free-first',
}

/** The fields the view reads – a `Person` fits, and so does a test row. */
export type ViewablePerson = Parameters<typeof isPersonOccupied>[0] & {
  name: string
  role?: string | null
  roleSortOrder?: number | null
  tags?: readonly string[] | null
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isOneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  options.some((option) => option === value)

/** Guard for the stored prefs – a key written by another build must not reach the list. */
export function isPersonnelViewPrefs(value: unknown): value is PersonnelViewPrefs {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isOneOf(PERSONNEL_STATUSES, v.status) &&
    isOneOf(PERSONNEL_SORTS, v.sort) &&
    isStringArray(v.grades) &&
    isStringArray(v.tags)
  )
}

/** The number on the filter button: each chosen value counts; the sort is not a filter. */
export function activeFilterCount(prefs: PersonnelViewPrefs): number {
  return (prefs.status === 'all' ? 0 : 1) + prefs.grades.length + prefs.tags.length
}

/** True when the list is today's: everybody, Frei above Gebunden. */
export function isDefaultView(prefs: PersonnelViewPrefs): boolean {
  return activeFilterCount(prefs) === 0 && prefs.sort === DEFAULT_PERSONNEL_VIEW.sort
}

export const gradeKey = (person: { role?: string | null }): string => person.role ?? ''

function matches(person: ViewablePerson, prefs: PersonnelViewPrefs): boolean {
  if (prefs.status !== 'all' && isPersonOccupied(person) !== (prefs.status === 'bound')) return false
  if (prefs.grades.length > 0 && !prefs.grades.includes(gradeKey(person))) return false
  return prefs.tags.every((tag) => person.tags?.includes(tag))
}

export type PersonnelLayout<T> =
  | { kind: 'grouped'; free: T[]; bound: T[] }
  | { kind: 'flat'; people: T[] }

/**
 * What the list draws: the shown people (for the counters) and how they are laid out.
 *
 * `free-first` splits by the question the board's sidebar answers first – who can I still
 * send? – alphabetical (de-CH) inside each group, rank only a suffix on the row. `rank` and
 * `name` are one flat list in the roster's own orders (`lib/roster-order.ts`).
 */
export function viewPersonnel<T extends ViewablePerson>(
  people: readonly T[],
  prefs: PersonnelViewPrefs,
): { shown: T[]; layout: PersonnelLayout<T> } {
  const shown = people.filter((person) => matches(person, prefs))
  if (prefs.sort !== 'free-first') {
    const flat = [...shown].sort(prefs.sort === 'rank' ? compareByRankThenName : compareByName)
    return { shown: flat, layout: { kind: 'flat', people: flat } }
  }
  const free: T[] = []
  const bound: T[] = []
  for (const person of shown) (isPersonOccupied(person) ? bound : free).push(person)
  free.sort(compareByName)
  bound.sort(compareByName)
  return { shown: [...free, ...bound], layout: { kind: 'grouped', free, bound } }
}

export interface GradeFacet {
  key: string
  count: number
}

export interface TagFacet {
  tag: string
  count: number
}

/**
 * The popover's options, counted over everybody the search left (not narrowed by the other
 * filters – the numbers say how big each choice is, so they add up to the roster).
 *
 * Grades in the station's roster order; tags most used first. A chosen value nobody carries
 * any more (a remembered «Lt» on a roster without one) stays listed with 0, so it can be seen
 * and unticked instead of silently emptying the list.
 */
export function personnelFacets(
  people: readonly ViewablePerson[],
  prefs: PersonnelViewPrefs,
): { status: Record<PersonnelStatus, number>; grades: GradeFacet[]; tags: TagFacet[] } {
  const bound = people.reduce((n, person) => (isPersonOccupied(person) ? n + 1 : n), 0)

  const gradeOrder = new Map<string, { count: number; order: number }>()
  const tagCounts = new Map<string, number>()
  for (const person of people) {
    const key = gradeKey(person)
    const grade = gradeOrder.get(key)
    if (grade) grade.count += 1
    else gradeOrder.set(key, { count: 1, order: person.roleSortOrder ?? 0 })
    for (const tag of new Set(person.tags ?? [])) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  for (const key of prefs.grades) {
    if (!gradeOrder.has(key)) gradeOrder.set(key, { count: 0, order: Number.POSITIVE_INFINITY })
  }
  for (const tag of prefs.tags) if (!tagCounts.has(tag)) tagCounts.set(tag, 0)

  const grades = [...gradeOrder]
    .sort(([a, x], [b, y]) => x.order - y.order || a.localeCompare(b, 'de-CH'))
    .map(([key, { count }]) => ({ key, count }))
  const tags = [...tagCounts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b, 'de-CH'))
    .map(([tag, count]) => ({ tag, count }))

  return { status: { all: people.length, free: people.length - bound, bound }, grades, tags }
}
