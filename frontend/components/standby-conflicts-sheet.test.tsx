import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiStandbyConflict } from '@/lib/api/types'

const mocks = vi.hoisted(() => ({
  getStandbyConflicts: vi.fn(),
  resolveStandbyConflict: vi.fn(),
  refresh: vi.fn(),
  mirror: true,
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { getStandbyConflicts: mocks.getStandbyConflicts, resolveStandbyConflict: mocks.resolveStandbyConflict },
}))
vi.mock('@/lib/contexts/standby-context', () => ({
  useStandby: () => ({ mirror: mocks.mirror, refresh: mocks.refresh }),
}))

import { StandbyConflictsSheet } from '@/components/standby-conflicts-sheet'

const MELDUNG: ApiStandbyConflict = {
  id: 'c-1',
  table_name: 'incidents',
  row_id: 'i-7',
  kind: 'field',
  kept_on: 'standby',
  deleted_on: null,
  columns: {
    description: { kept: 'Fahrer gerettet, Auto bleibt.', lost: 'Polizei sperrt beidseitig.', text: true },
    updated_at: { kept: '2026-11-09T19:50:00+00:00', lost: '2026-11-09T19:51:00+00:00', text: false },
  },
  row: null,
  subject: { incident_id: 'i-7', number: 7, address: 'Bahnhofstrasse 22' },
  lost_at: '2026-11-09T19:51:00+00:00',
  detected_at: '2026-11-09T20:12:00+00:00',
  resolved_at: null,
  resolved_by: null,
  resolution: null,
}

const DELETED: ApiStandbyConflict = {
  ...MELDUNG,
  id: 'c-2',
  row_id: 'i-14',
  kind: 'deleted',
  deleted_on: 'hosted',
  columns: null,
  subject: { incident_id: 'i-14', number: 14, address: 'Poststrasse 6' },
}

function renderSheet() {
  return renderWithIntl(<StandbyConflictsSheet open onOpenChange={() => {}} eventId="ev-1" />)
}

beforeEach(() => {
  mocks.mirror = true
  mocks.getStandbyConflicts.mockReset().mockResolvedValue({ decidable: true, conflicts: [MELDUNG, DELETED] })
  mocks.resolveStandbyConflict.mockReset().mockResolvedValue(undefined)
  mocks.refresh.mockReset()
})

describe('StandbyConflictsSheet', () => {
  it('names each conflict by its Einsatz and field, bookkeeping left out', async () => {
    renderSheet()

    const card = await screen.findByRole('region', { name: 'Einsatz 7 · Bahnhofstrasse 22 · Meldung' })
    expect(within(card).getByRole('radio', { name: /Hier.*Fahrer gerettet/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(card).getByRole('radio', { name: /KP Rück Online.*Polizei sperrt/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Einsatz 14 · Poststrasse 6 · gelöscht' })).toBeInTheDocument()
  })

  it('joins both texts into one editable field and sends what was written', async () => {
    renderSheet()
    const card = await screen.findByRole('region', { name: /Einsatz 7/ })

    await userEvent.click(within(card).getByRole('radio', { name: /Beide zusammen/ }))
    const field = within(card).getByRole('textbox')
    expect(field).toHaveValue('Fahrer gerettet, Auto bleibt.\nPolizei sperrt beidseitig.')
    await userEvent.type(field, ' Abschleppdienst bestellt.')
    await userEvent.click(within(card).getByRole('button', { name: 'Übernehmen' }))

    expect(mocks.resolveStandbyConflict).toHaveBeenCalledWith('c-1', 'both', {
      description: 'Fahrer gerettet, Auto bleibt.\nPolizei sperrt beidseitig. Abschleppdienst bestellt.',
    })
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('offers no «Beide zusammen» for a deletion – keep it or delete it', async () => {
    renderSheet()
    const card = await screen.findByRole('region', { name: /Einsatz 14/ })

    expect(within(card).queryByRole('radio', { name: /Beide zusammen/ })).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('radio', { name: /Löschen/ }))
    await userEvent.click(within(card).getByRole('button', { name: 'Übernehmen' }))

    expect(mocks.resolveStandbyConflict).toHaveBeenCalledWith('c-2', 'other', undefined)
  })

  it('only shows the list on the system that does not lead', async () => {
    mocks.mirror = false // the hosted board, while the box leads
    mocks.getStandbyConflicts.mockResolvedValue({ decidable: false, conflicts: [MELDUNG] })
    renderSheet()

    const card = await screen.findByRole('region', { name: /Einsatz 7/ })
    expect(within(card).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Übernehmen' })).not.toBeInTheDocument()
    expect(within(card).getByText('Entschieden wird auf KP Rück Offline.')).toBeInTheDocument()
  })
})
