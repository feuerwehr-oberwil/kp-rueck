import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRosterSnapshot } from '@/lib/api/types'

// The roster-snapshot block under Einstellungen › Integrationen is the feature's only surface.
// What it must say at a glance: nothing at all on a station without a source; for a held run,
// how many people it would deactivate, that nothing changed, and how to release it; for a normal
// run, the counts, who it could not place and which Dienstgrade it did not know.

const getRosterSnapshot = vi.fn<() => Promise<ApiRosterSnapshot>>()
vi.mock('@/lib/api-client', () => ({ apiClient: { getRosterSnapshot: () => getRosterSnapshot() } }))

import { RosterSnapshotStatus } from './roster-snapshot-status'

const base = { configured: true, intervalMinutes: 60, maxDeactivatePct: 20 }

describe('RosterSnapshotStatus', () => {
  beforeEach(() => getRosterSnapshot.mockReset())

  it('renders nothing on a station without a source', async () => {
    getRosterSnapshot.mockResolvedValue({ ...base, configured: false, status: null })
    const { container } = renderWithIntl(<RosterSnapshotStatus />)
    await waitFor(() => expect(getRosterSnapshot).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('a held run names the numbers, says nothing changed and how to release it', async () => {
    getRosterSnapshot.mockResolvedValue({
      ...base,
      status: {
        held: true,
        pendingDeactivations: 10,
        activeBefore: 30,
        deactivationLimit: 6,
        outcome: { refused: 'held: …', unmatched: [{ display_name: 'Meier Anna', reason: 'absent_from_snapshot' }] },
      },
    })
    renderWithIntl(<RosterSnapshotStatus />)
    expect(await screen.findByText(/10 von 30 verfügbaren Personen/)).toBeTruthy()
    expect(screen.getByText(/Nichts geändert/)).toBeTruthy()
    expect(screen.getByText(/run --force/)).toBeTruthy()
    expect(screen.getByText(/Betroffen: Meier Anna/)).toBeTruthy()
  })

  it('a normal run reads as counts, with the unplaced names and unknown ranks', async () => {
    getRosterSnapshot.mockResolvedValue({
      ...base,
      status: {
        outcome: {
          created: 2,
          updated: 1,
          deactivated: 0,
          unknown_ranks: ['zgf'],
          unmatched: [
            { display_name: 'Meier Peter', reason: 'ambiguous_name' },
            { display_name: 'Alt Ehemals', reason: 'inactive_in_snapshot' },
          ],
        },
        lastGood: { generatedAt: '2026-10-08T04:00:00+00:00', count: 40, provider: 'wehr' },
        postponed: [{ display_name: 'Keller Urs', reason: 'absent_from_snapshot' }],
        via: 'index',
        index: {
          generatedAt: '2026-10-09T04:00:00+00:00',
          files: [
            { kind: 'roster', schema: 'roster-snapshot/1', read: true, known: true },
            { kind: 'vehicles', schema: 'vehicles-snapshot/1', read: false, known: false },
          ],
        },
      },
    })
    renderWithIntl(<RosterSnapshotStatus />)
    expect(await screen.findByText(/2 neu · 1 geändert · 0 deaktiviert/)).toBeTruthy()
    expect(screen.getByText(/1 nicht zugeordnet: Meier Peter/)).toBeTruthy() // a former member is not a problem
    expect(screen.getByText(/zgf/)).toBeTruthy()
    expect(screen.getByText(/nicht mehr im Einsatz sind: Keller Urs/)).toBeTruthy()
    expect(screen.getByText(/Über den Stationsdaten-Index/)).toBeTruthy()
    expect(screen.getByText(/noch nicht gelesen: vehicles/)).toBeTruthy()
  })
})
