/**
 * The arithmetic behind the Excel-import balance sheet.
 *
 * The preview endpoint answers two unrelated things: how many rows it parsed out
 * of the file, and — for the chosen mode — how many rows already in the database
 * the import would delete. On their own neither number tells an operator what the
 * station looks like afterwards. This turns them into one line per resource:
 *
 *     Bestand heute → aus Datei → wird gelöscht → Bestand nachher
 *
 * Kept free of React so the one thing that must not be wrong — the "nachher"
 * column — is testable without rendering anything.
 *
 * The two halves of that line have different provenance, and the difference is
 * the whole point of this module: «wird gelöscht» is counted by the backend and
 * is a fact, «nachher» is arithmetic and is only as good as its `before`. So the
 * balance says which source answered `before` (`beforeSource`) and never lets a
 * missing or stale one hide the deletion figures.
 */

import type {
  ApiExcelImportDeletions,
  ApiExcelImportPreview,
  ExcelImportMode,
} from '@/lib/api/types/admin'

export const IMPORT_RESOURCES = ['personnel', 'vehicles', 'materials'] as const

export type ImportResource = (typeof IMPORT_RESOURCES)[number]

/** How many rows each table holds right now, counted from the live lists. */
export type ImportStock = Record<ImportResource, number>

export interface ImportBalanceRow {
  resource: ImportResource
  /** Rows in the database before the import – `null` when nothing authoritative says. */
  before: number | null
  /** Rows the preview parsed out of the workbook. */
  fromFile: number
  /** Rows the import would delete – always 0 in `append`. */
  deleted: number
  /** `before - deleted + fromFile`, or `null` while `before` is unknown. */
  after: number | null
}

/**
 * Where the «Bestand heute» column – and with it «Bestand nachher» – comes from.
 *
 * The two sources are not equally trustworthy and the card has to be able to say
 * which one it is showing:
 *
 * - `preview` – the backend counted it in the same request that parsed the file,
 *   so `nachher` is arithmetic on ONE answer and is exact.
 * - `stock`   – a second, independently timed fetch. Anything that happened in
 *   between (a colleague adding two people on another machine) makes `nachher` a
 *   good guess, not a fact.
 * - `unknown` – that fetch failed. No `before`, no `nachher`; the deletion
 *   figures are unaffected and still shown.
 */
export type BeforeSource = 'preview' | 'stock' | 'unknown'

/**
 * A resource the workbook carries no rows for. Rendered explicitly, because
 * "no rows" used to render as nothing at all — visually identical to a sheet the
 * file does not contain, which is the case `replace` refuses with a 409.
 *
 * `ambiguous` is that collision, and the frontend genuinely cannot resolve it:
 * the parser knows whether a sheet was `present`, the preview payload only
 * reports totals. So the copy has to name both outcomes rather than pick one.
 */
export interface EmptySheetNotice {
  resource: ImportResource
  ambiguous: boolean
}

/**
 * Assignment rows the import would leave pointing at a deleted resource, beyond
 * the incident-level ones the card has always shown. Same hazard, one level up:
 * an Auftrag owns its squad on the route, not on any of its stops.
 *
 * Kept as a list rather than two more fields because the backend may not report
 * them at all – see `ApiExcelImportDeletions`. A field that is absent is not the
 * same as a field that is zero, and only the reported ones may be rendered.
 */
export const DANGLING_GROUP_KEYS = [
  'incident_group_assignments',
  'active_incident_group_assignments',
] as const

export type DanglingGroupKey = (typeof DANGLING_GROUP_KEYS)[number]

/**
 * Rows that do NOT dangle – they disappear. `personnel.id` is a real foreign key
 * with ON DELETE CASCADE in all three tables, so a roster `replace` takes them
 * with it and no cleanup on the board brings them back, only a backup.
 */
export const CASCADE_KEYS = [
  'cascade_event_attendance',
  'cascade_event_special_functions',
  'cascade_personnel_identities',
] as const

export type CascadeKey = (typeof CASCADE_KEYS)[number]

/** One reported, non-zero consequence. Absent and zero counts never become one of these. */
export interface ConsequenceCount<K extends string> {
  key: K
  count: number
}

export interface ImportBalance {
  mode: ExcelImportMode
  rows: ImportBalanceRow[]
  /** Column sums, so the card does not re-add them in JSX. */
  totals: Omit<ImportBalanceRow, 'resource'>
  /** Which of the two sources answered `before` – see `BeforeSource`. */
  beforeSource: BeforeSource
  /** `after` was computed across two independently timed answers: a guess, and labelled as one. */
  afterIsEstimate: boolean
  /**
   * `replace` only: the separately fetched stock disagrees with the counts the
   * backend just returned, which proves the fetched ones are stale. The table is
   * unaffected (it uses the backend's), but the per-mode cost shown next to the
   * mode buttons is quoting the outdated numbers and should say so.
   */
  stockOutdated: boolean
  /** Incident assignments that would be left pointing at a deleted resource. */
  orphanedAssignments: number
  /** The subset of those still on a running incident. Counts towards the backend's refusal. */
  activeOrphanedAssignments: number
  /** The same on Aufträge – empty when this backend does not report them. */
  danglingGroupAssignments: ConsequenceCount<DanglingGroupKey>[]
  /** Rows deleted along with the resource itself – empty when not reported. */
  cascadeDeletions: ConsequenceCount<CascadeKey>[]
  /** Nothing is deleted at all – `append`, or a `replace` onto an empty board. */
  deletesNothing: boolean
  /** `replace` cannot be executed: the backend answers 409 while this is true. */
  replaceBlocked: boolean
}

/**
 * The reported, non-zero subset of `keys`, in the order given.
 *
 * `undefined` (an older backend that never counted this) and `0` (counted, no
 * damage) both drop out, and deliberately look the same here: neither is a line
 * worth a row on screen. They are NOT the same upstream – see
 * `ApiExcelImportDeletions` – which is why nothing else in this module coerces
 * a missing field to zero.
 */
function reportedCounts<K extends keyof ApiExcelImportDeletions>(
  deletions: ApiExcelImportDeletions,
  keys: readonly K[],
): ConsequenceCount<K>[] {
  return keys.flatMap((key) => {
    const count = deletions[key]
    return count ? [{ key, count }] : []
  })
}

/**
 * Build the balance from a preview and – where it is needed at all – the
 * separately fetched stock. Pass the preview the backend returned: its `mode`
 * wins over anything the UI thinks is selected, because its `deletions` were
 * counted for that mode.
 *
 * The preview leads because it is the honest half. Everything in it was counted
 * in one request: `deletions` and the parsed totals cannot disagree with each
 * other. `stock` is a second fetch on its own clock, so it is used only where
 * the preview says nothing – `append`, which deletes nothing and therefore
 * reports no stock – and the result is marked as the estimate it then is.
 *
 * In `replace` mode `deletions[resource]` IS the current stock: the backend
 * counts the whole table, because that is what `replace` empties. That identity
 * is load-bearing here – if `deletions` is ever narrowed to the sheets a
 * workbook actually contains, this derivation has to be narrowed with it.
 *
 * `stock` may be `null`: the balance still renders, because the deletion figures
 * are the half nobody may be left guessing about, and they do not need it.
 */
export function buildImportBalance(preview: ApiExcelImportPreview, stock: ImportStock | null): ImportBalance {
  const replacing = preview.mode === 'replace'
  const fromFile: ImportStock = {
    personnel: preview.personnel_total,
    vehicles: preview.vehicles_total,
    materials: preview.materials_total,
  }

  const beforeSource: BeforeSource = replacing ? 'preview' : stock ? 'stock' : 'unknown'

  const rows = IMPORT_RESOURCES.map<ImportBalanceRow>((resource) => {
    const deleted = preview.deletions[resource]
    const parsed = fromFile[resource]
    const before = replacing ? deleted : (stock?.[resource] ?? null)
    return {
      resource,
      before,
      fromFile: parsed,
      deleted,
      after: before === null ? null : before - deleted + parsed,
    }
  })

  const sum = (pick: (row: ImportBalanceRow) => number) => rows.reduce((total, row) => total + pick(row), 0)
  // One unknown row poisons the column sum – a total that quietly counts two of
  // three resources is worse than no total.
  const sumOrUnknown = (pick: (row: ImportBalanceRow) => number | null) =>
    rows.reduce<number | null>((total, row) => {
      const value = pick(row)
      return total === null || value === null ? null : total + value
    }, 0)

  return {
    mode: preview.mode,
    rows,
    totals: {
      before: sumOrUnknown((row) => row.before),
      fromFile: sum((row) => row.fromFile),
      deleted: sum((row) => row.deleted),
      after: sumOrUnknown((row) => row.after),
    },
    beforeSource,
    afterIsEstimate: beforeSource === 'stock',
    stockOutdated:
      replacing && stock !== null && IMPORT_RESOURCES.some((r) => stock[r] !== preview.deletions[r]),
    orphanedAssignments: preview.deletions.incident_assignments,
    activeOrphanedAssignments: preview.deletions.active_incident_assignments,
    danglingGroupAssignments: reportedCounts(preview.deletions, DANGLING_GROUP_KEYS),
    cascadeDeletions: reportedCounts(preview.deletions, CASCADE_KEYS),
    deletesNothing: sum((row) => row.deleted) === 0,
    // BOTH active counts, matching the backend's 409 condition. Blocking on the
    // incident table alone told an operator the import would go through and then
    // let it 409 on an Auftrag – the shape most likely to be holding the squad.
    replaceBlocked:
      replacing &&
      preview.deletions.active_incident_assignments +
        (preview.deletions.active_incident_group_assignments ?? 0) >
        0,
  }
}

/**
 * Which resources the workbook says nothing about. Derived from the preview
 * alone – no stock needed, because in `replace` mode `deletions[resource]` IS
 * the current stock, which is exactly the condition that makes an empty sheet
 * consequential.
 */
export function emptySheetNotices(preview: ApiExcelImportPreview): EmptySheetNotice[] {
  const totals: ImportStock = {
    personnel: preview.personnel_total,
    vehicles: preview.vehicles_total,
    materials: preview.materials_total,
  }
  return IMPORT_RESOURCES.filter((resource) => totals[resource] === 0).map((resource) => ({
    resource,
    ambiguous: preview.mode === 'replace' && preview.deletions[resource] > 0,
  }))
}
