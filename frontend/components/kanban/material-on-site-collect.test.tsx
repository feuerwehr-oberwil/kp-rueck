import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { MaterialOnSitePanel, type MaterialOnSiteEntry } from '@/components/kanban/material-on-site-panel'

// Owner pick 6A (24.11.2026): «Abgeholt» per unit, confirmed in place.

const ENTRIES: MaterialOnSiteEntry[] = [
  { materialId: 'm-1', name: 'Tauchpumpe S-Gr.', incidentId: 'i-1', assignmentId: 'a-1', address: 'Gartenstrasse 18', since: null },
  { materialId: 'm-2', name: 'Wassersauger', incidentId: 'i-1', assignmentId: 'a-2', address: 'Gartenstrasse 18', since: null },
]

async function openPanel(props: Partial<React.ComponentProps<typeof MaterialOnSitePanel>> = {}) {
  const onOpenIncident = vi.fn()
  const onCollect = vi.fn()
  renderWithIntl(<MaterialOnSitePanel entries={ENTRIES} onOpenIncident={onOpenIncident} onCollect={onCollect} {...props} />)
  await userEvent.click(screen.getByRole('button', { name: /2 Geräte vor Ort/ }))
  return { onOpenIncident, onCollect }
}

describe('MaterialOnSitePanel «Abgeholt»', () => {
  it('asks in place, then releases exactly that unit', async () => {
    const { onCollect, onOpenIncident } = await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Wassersauger abgeholt …' }))
    const confirm = screen.getByRole('group', { name: 'Abgeholt und zurück im Magazin?' })
    expect(confirm).toHaveTextContent(/Hält «abgeholt \d\d:\d\d» im Verlauf fest/)
    expect(onCollect).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Abgeholt – freigeben' }))
    expect(onCollect).toHaveBeenCalledExactlyOnceWith({ incidentId: 'i-1', assignmentId: 'a-2', name: 'Wassersauger' })
    expect(onOpenIncident).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Abgeholt und zurück im Magazin?' })).toBeNull()
  })

  it('«Abbrechen» writes nothing; the row click still opens the Einsatz', async () => {
    const { onCollect, onOpenIncident } = await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Tauchpumpe S-Gr. abgeholt …' }))
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onCollect).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('Tauchpumpe S-Gr.'))
    expect(onOpenIncident).toHaveBeenCalledWith('i-1')
  })

  // Owner, 24.11.2026: beside the text the narrow aside wrapped name and place badly.
  it('puts «Abgeholt» under the entry’s text, not beside it', async () => {
    await openPanel()
    const collect = screen.getByRole('button', { name: 'Wassersauger abgeholt …' })
    const row = collect.closest('li')!
    const text = screen.getByTitle('Wassersauger steht noch bei Gartenstrasse 18')
    // Both stack straight in the list item: no shared flex row, the text first.
    expect([...row.children]).toEqual([text, collect])
  })

  it('read-only without `onCollect`', async () => {
    await openPanel({ onCollect: undefined })
    expect(screen.queryByRole('button', { name: /abgeholt …/ })).toBeNull()
  })
})
