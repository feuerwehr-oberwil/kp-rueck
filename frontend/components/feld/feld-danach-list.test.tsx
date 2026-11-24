import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { FeldDanachList } from './feld-danach-list'

const plan = (over: Partial<Parameters<typeof FeldDanachList>[0]['planned'][number]>) => ({
  id: 'p1',
  incident_id: 'op-2',
  incident_group_id: null,
  place: 'Mühlemattstrasse 12',
  description: 'Wasser im Keller',
  position: 1,
  ready: false,
  ...over,
})

// Owner pick 5C (24.11.2026): Danach on /feld, unmistakably not active, read-only.
describe('FeldDanachList', () => {
  it('labels it «nicht aktiv», in queue order, with no button to report on it', () => {
    renderWithIntl(<FeldDanachList planned={[plan({}), plan({ id: 'p2', place: 'Post 6', position: 2 })]} />)
    expect(screen.getAllByText('DANACH · NICHT AKTIV')).toHaveLength(2)
    expect(screen.getByText('· 2. Danach')).toBeInTheDocument()
    expect(screen.getAllByText(/Noch nicht losfahren/)).toHaveLength(2)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says when the KP can make it the Einsatz now', () => {
    renderWithIntl(<FeldDanachList planned={[plan({ ready: true })]} />)
    expect(screen.getByText(/Du bist frei/)).toBeInTheDocument()
  })
})
