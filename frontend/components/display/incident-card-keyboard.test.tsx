import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { DisplayIncidentCard } from '@/components/display/incident-card'
import { makeOperation } from '@/test-utils/operation-fixtures'

/** A keyboard reaches an open-able wall card: its address is a button (hunt 2026-11-24). */
const operation = makeOperation({
  id: 'op-2',
  location: 'Mühlemattstrasse 12, 4104 Oberwil',
  dispatchTime: new Date('2026-08-09T10:00:00Z'),
  priority: 'low',
})

describe('DisplayIncidentCard — keyboard', () => {
  it.each(['{Enter}', ' '])('opens with %s on the focused address', async (key) => {
    const onClick = vi.fn()
    renderWithIntl(<DisplayIncidentCard operation={operation} onClick={onClick} />)
    const user = userEvent.setup()

    await user.tab()
    expect(screen.getByRole('button', { name: /Mühlemattstrasse 12/ })).toHaveFocus()
    await user.keyboard(key)

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('stays plain text on a card that opens nothing', () => {
    renderWithIntl(<DisplayIncidentCard operation={operation} />)
    expect(screen.queryByRole('button', { name: /Mühlemattstrasse 12/ })).toBeNull()
  })
})
