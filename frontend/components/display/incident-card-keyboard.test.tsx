import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'
import { DisplayIncidentCard } from '@/components/display/incident-card'

/** A keyboard reaches an open-able wall card: its address is a button (hunt 2026-11-24). */
const operation = {
  id: 'op-2',
  location: 'Mühlemattstrasse 12, 4104 Oberwil',
  vehicle: null,
  vehicles: [],
  incidentType: 'elementarereignis',
  dispatchTime: new Date('2026-08-09T10:00:00Z'),
  crew: [],
  priority: 'low',
  status: 'incoming',
  coordinates: null,
  materials: [],
  notes: '',
  contact: '',
  contactPhone: '',
  internalNotes: '',
  nachbarhilfe: false,
  nachbarhilfeNote: '',
  amWarten: false,
  amWartenNote: '',
  zuFuss: false,
  groupId: null,
  groupPosition: 0,
  statusChangedAt: null,
  hasCompletedReko: false,
  rekoArrivedAt: null,
  rekoSummary: null,
  assignedReko: null,
  leaderId: null,
  leaderName: null,
  materialAssignments: new Map(),
} as Operation

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
