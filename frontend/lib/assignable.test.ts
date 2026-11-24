import { describe, expect, it } from 'vitest'
import { auftragTakesAssignments, takesAssignments } from './assignable'
import { incidentCommandsFor } from './contexts/command-palette-context'

const open = { status: 'active' }
const closed = { status: 'complete' }

describe('auftragTakesAssignments', () => {
  it('is closed only when every stop is closed', () => {
    expect(auftragTakesAssignments([closed, closed])).toBe(false)
    expect(auftragTakesAssignments([closed, open])).toBe(true)
    // No stop yet: a squad is often put on a route first.
    expect(auftragTakesAssignments([])).toBe(true)
    // A stop this board has not loaded counts as open – the server decides.
    expect(auftragTakesAssignments([closed, undefined])).toBe(true)
  })
})

describe('incidentCommandsFor', () => {
  const editor = { isEditor: true, printerEnabled: false }

  it('offers no «Zuweisen» and no «Übertragen» on a closed Einsatz', () => {
    expect(takesAssignments(closed)).toBe(false)
    expect(incidentCommandsFor({ ...closed, groupId: null }, editor)).not.toEqual(
      expect.arrayContaining(['assignCrew']),
    )
    expect(incidentCommandsFor({ ...closed, groupId: null }, editor)).not.toContain('transfer')
    expect(incidentCommandsFor({ ...closed, groupId: null }, editor)).toContain('complete')
  })

  it('offers no «Übertragen» on a stop', () => {
    expect(incidentCommandsFor({ ...open, groupId: 'g1' }, editor)).not.toContain('transfer')
    expect(incidentCommandsFor({ ...open, groupId: null }, editor)).toContain('transfer')
  })

  it('gives a viewer only the print, with a printer', () => {
    expect(incidentCommandsFor({ ...open, groupId: null }, { isEditor: false, printerEnabled: true })).toEqual(['print'])
  })
})
