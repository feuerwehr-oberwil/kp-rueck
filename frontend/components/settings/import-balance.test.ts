import { describe, expect, it } from 'vitest'
import type { ApiExcelImportPreview, ExcelImportMode } from '@/lib/api/types/admin'
import {
  buildImportBalance,
  emptySheetNotices,
  type ImportStock,
} from '@/components/settings/import-balance'

/**
 * Every number here is its own literal, and no two of them are equal.
 *
 * The previous fixture built the preview's `deletions` out of the same `STOCK`
 * constant it then asserted against, so `before - deleted + parsed` could have
 * been any expression at all as long as it cancelled — a test that agreed with
 * the code by construction. Independent, distinct values mean a drift in the
 * arithmetic changes a number the assertions name explicitly.
 */
const STOCK: ImportStock = { personnel: 18, vehicles: 5, materials: 26 }
/** What the backend says it would delete – deliberately NOT `STOCK`. */
const DELETIONS = { personnel: 21, vehicles: 4, materials: 30 }
/** What the workbook holds. */
const PARSED = { personnel: 2, vehicles: 7, materials: 13 }

/**
 * The consequence counts, all distinct for the same reason as the three above:
 * a line rendered with the wrong neighbour's number has to change a number an
 * assertion names.
 */
const IMPACT = {
  incident_assignments: 24,
  active_incident_assignments: 7,
  incident_group_assignments: 9,
  active_incident_group_assignments: 3,
  cascade_event_attendance: 41,
  cascade_event_special_functions: 6,
  cascade_personnel_identities: 15,
}

function preview(
  mode: ExcelImportMode,
  overrides: Partial<ApiExcelImportPreview> = {},
): ApiExcelImportPreview {
  const replacing = mode === 'replace'
  const zeroed = Object.fromEntries(
    Object.keys(IMPACT).map((key) => [key, 0]),
  ) as typeof IMPACT
  return {
    personnel_preview: [],
    personnel_total: PARSED.personnel,
    vehicles_preview: [],
    vehicles_total: PARSED.vehicles,
    materials_preview: [],
    materials_total: PARSED.materials,
    mode,
    deletions: {
      personnel: replacing ? DELETIONS.personnel : 0,
      vehicles: replacing ? DELETIONS.vehicles : 0,
      materials: replacing ? DELETIONS.materials : 0,
      ...(replacing ? IMPACT : zeroed),
    },
    ...overrides,
  }
}

describe('buildImportBalance – replace', () => {
  it('takes «Bestand heute» from the backend, not from the separate stock fetch', () => {
    const balance = buildImportBalance(preview('replace'), STOCK)
    expect(balance.beforeSource).toBe('preview')
    // 21/4/30 come from `deletions`; 18/5/26 are the stale stock and must not appear.
    expect(balance.rows.map((row) => row.before)).toEqual([21, 4, 30])
    expect(balance.totals.before).toBe(55)
  })

  it('leaves exactly what the file holds, because replace empties the tables first', () => {
    const balance = buildImportBalance(preview('replace'), STOCK)
    expect(balance.rows.map((row) => [row.resource, row.after])).toEqual([
      ['personnel', 2],
      ['vehicles', 7],
      ['materials', 13],
    ])
    expect(balance.totals).toEqual({ before: 55, fromFile: 22, deleted: 55, after: 22 })
    expect(balance.afterIsEstimate).toBe(false)
  })

  it('is unchanged when the stock fetch failed – the deletion figures do not need it', () => {
    const withStock = buildImportBalance(preview('replace'), STOCK)
    const without = buildImportBalance(preview('replace'), null)
    expect(without.rows).toEqual(withStock.rows)
    expect(without.totals).toEqual(withStock.totals)
    expect(without.beforeSource).toBe('preview')
    expect(without.stockOutdated).toBe(false)
  })

  it('flags a stock fetch that disagrees with the backend', () => {
    expect(buildImportBalance(preview('replace'), STOCK).stockOutdated).toBe(true)
    const agreeing: ImportStock = { ...DELETIONS }
    expect(buildImportBalance(preview('replace'), agreeing).stockOutdated).toBe(false)
  })

  it('blocks replace while assignments sit on running incidents', () => {
    expect(buildImportBalance(preview('replace'), STOCK).replaceBlocked).toBe(true)
  })

  it('does not block a replace whose orphans are all on closed incidents', () => {
    const stale = preview('replace')
    const balance = buildImportBalance(
      {
        ...stale,
        deletions: {
          ...stale.deletions,
          active_incident_assignments: 0,
          active_incident_group_assignments: 0,
        },
      },
      STOCK,
    )
    expect(balance.replaceBlocked).toBe(false)
    expect(balance.orphanedAssignments).toBe(24)
    // Still deletes 55 rows – "not blocked" is not "harmless".
    expect(balance.deletesNothing).toBe(false)
  })

  it('blocks on an Auftrag alone – the backend sums both active counts for its 409', () => {
    const stale = preview('replace')
    const balance = buildImportBalance(
      { ...stale, deletions: { ...stale.deletions, active_incident_assignments: 0 } },
      STOCK,
    )
    // 3 assignments on a running Auftrag, none on an incident: the import still 409s.
    expect(balance.replaceBlocked).toBe(true)
  })

  it('lists the Auftrag rows that would dangle, separately from the cascaded ones', () => {
    const balance = buildImportBalance(preview('replace'), STOCK)
    expect(balance.danglingGroupAssignments).toEqual([
      { key: 'incident_group_assignments', count: 9 },
      { key: 'active_incident_group_assignments', count: 3 },
    ])
    expect(balance.cascadeDeletions).toEqual([
      { key: 'cascade_event_attendance', count: 41 },
      { key: 'cascade_event_special_functions', count: 6 },
      { key: 'cascade_personnel_identities', count: 15 },
    ])
  })

  it('skips a consequence the backend counted as zero – no rows of noughts', () => {
    const stale = preview('replace')
    const balance = buildImportBalance(
      {
        ...stale,
        deletions: {
          ...stale.deletions,
          active_incident_group_assignments: 0,
          cascade_event_special_functions: 0,
        },
      },
      STOCK,
    )
    expect(balance.danglingGroupAssignments.map((c) => c.key)).toEqual([
      'incident_group_assignments',
    ])
    expect(balance.cascadeDeletions.map((c) => c.key)).toEqual([
      'cascade_event_attendance',
      'cascade_personnel_identities',
    ])
  })

  it('reports nothing new against a backend that does not send the new counts', () => {
    // The five optional fields are absent, exactly as an older backend answers.
    const older = preview('replace', {
      deletions: {
        personnel: DELETIONS.personnel,
        vehicles: DELETIONS.vehicles,
        materials: DELETIONS.materials,
        incident_assignments: IMPACT.incident_assignments,
        active_incident_assignments: IMPACT.active_incident_assignments,
      },
    })
    const balance = buildImportBalance(older, STOCK)
    expect(balance.danglingGroupAssignments).toEqual([])
    expect(balance.cascadeDeletions).toEqual([])
    // The half it does report is unaffected.
    expect(balance.orphanedAssignments).toBe(24)
    expect(balance.activeOrphanedAssignments).toBe(7)
    expect(balance.replaceBlocked).toBe(true)
    expect(balance.totals.deleted).toBe(55)
  })

  it('treats a replace onto an empty board as deleting nothing', () => {
    const first = preview('replace', {
      deletions: {
        personnel: 0,
        vehicles: 0,
        materials: 0,
        incident_assignments: 0,
        active_incident_assignments: 0,
      },
    })
    const balance = buildImportBalance(first, { personnel: 0, vehicles: 0, materials: 0 })
    expect(balance.deletesNothing).toBe(true)
    expect(balance.rows.map((row) => row.before)).toEqual([0, 0, 0])
    expect(balance.totals.after).toBe(22)
  })
})

describe('buildImportBalance – append', () => {
  it('adds the file to the counted stock and marks the total as an estimate', () => {
    const balance = buildImportBalance(preview('append'), STOCK)
    expect(balance.beforeSource).toBe('stock')
    expect(balance.rows.map((row) => row.before)).toEqual([18, 5, 26])
    // 18+2, 5+7, 26+13 – nothing is deleted, so `before` is the only unknown.
    expect(balance.rows.map((row) => row.after)).toEqual([20, 12, 39])
    expect(balance.totals).toEqual({ before: 49, fromFile: 22, deleted: 0, after: 71 })
    expect(balance.afterIsEstimate).toBe(true)
    expect(balance.deletesNothing).toBe(true)
    expect(balance.replaceBlocked).toBe(false)
  })

  it('leaves «nachher» open rather than guessing when the stock fetch failed', () => {
    const balance = buildImportBalance(preview('append'), null)
    expect(balance.beforeSource).toBe('unknown')
    expect(balance.rows.map((row) => row.before)).toEqual([null, null, null])
    expect(balance.rows.map((row) => row.after)).toEqual([null, null, null])
    expect(balance.totals.before).toBeNull()
    expect(balance.totals.after).toBeNull()
    // An estimate is something we show; this is nothing we show.
    expect(balance.afterIsEstimate).toBe(false)
    // The half that is certain survives the missing half.
    expect(balance.totals.fromFile).toBe(22)
    expect(balance.totals.deleted).toBe(0)
    expect(balance.deletesNothing).toBe(true)
  })

  it('never claims deletions the backend did not report', () => {
    const balance = buildImportBalance(preview('append'), STOCK)
    expect(balance.rows.map((row) => row.deleted)).toEqual([0, 0, 0])
    expect(balance.orphanedAssignments).toBe(0)
    expect(balance.activeOrphanedAssignments).toBe(0)
    // Counted as 0, not absent – and a counted zero is still not a line to render.
    expect(balance.danglingGroupAssignments).toEqual([])
    expect(balance.cascadeDeletions).toEqual([])
  })
})

describe('emptySheetNotices', () => {
  const noRows = { personnel_total: 0, vehicles_total: 0, materials_total: 0 }

  it('flags the resources the workbook says nothing about', () => {
    const notices = emptySheetNotices(
      preview('replace', { vehicles_total: 0, materials_total: 0 }),
    )
    expect(notices.map((n) => n.resource)).toEqual(['vehicles', 'materials'])
  })

  it('marks an empty sheet ambiguous only when replace would delete existing rows', () => {
    expect(emptySheetNotices(preview('replace', { vehicles_total: 0, materials_total: 0 }))).toEqual([
      { resource: 'vehicles', ambiguous: true },
      { resource: 'materials', ambiguous: true },
    ])
    // Append never deletes, so "no rows" has exactly one meaning.
    expect(emptySheetNotices(preview('append', { vehicles_total: 0, materials_total: 0 }))).toEqual([
      { resource: 'vehicles', ambiguous: false },
      { resource: 'materials', ambiguous: false },
    ])
  })

  it('says nothing when every sheet carries rows', () => {
    expect(emptySheetNotices(preview('append'))).toEqual([])
  })

  it('is not ambiguous when replace has nothing to delete either', () => {
    const emptyBoard = preview('replace', {
      ...noRows,
      deletions: {
        personnel: 0,
        vehicles: 0,
        materials: 0,
        incident_assignments: 0,
        active_incident_assignments: 0,
      },
    })
    expect(emptySheetNotices(emptyBoard).every((n) => !n.ambiguous)).toBe(true)
  })
})
