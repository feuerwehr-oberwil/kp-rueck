import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'
import type { Person } from '@/lib/contexts/personnel-context'
import type { ApiIncidentTimelineEvent } from '@/lib/api-client'

const crew: Person = { id: 'p-1', name: 'Muster Hans', role: 'AdF', status: 'assigned', roleSortOrder: 0 }

vi.mock('@/lib/contexts/operations-context', () => ({
  useOperations: () => ({ refreshOperations: vi.fn() }),
}))
vi.mock('@/lib/contexts/personnel-context', () => ({
  usePersonnel: () => ({ personnel: [crew] }),
}))
vi.mock('@/lib/api-client', () => ({ apiClient: { setIncidentFieldReport: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { FieldMessageThread, FieldReportsRow } from '@/components/kanban/field-reports-row'

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'incident-1',
    location: 'Hauptstrasse 1',
    vehicle: null,
    vehicles: [],
    incidentType: 'elementarereignis',
    dispatchTime: new Date('2026-08-09T20:00:00Z'),
    crew: [],
    priority: 'low',
    status: 'active',
    coordinates: [47.1, 7.2],
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
    leaderName: null,
    crewAssignments: new Map(),
    materialAssignments: new Map(),
    vehicleAssignments: new Map(),
    vehicleCallsigns: new Map(),
    vehicleDriverStay: new Map(),
    ...overrides,
  } as Operation
}

function message(timestamp: string, text: string, actor: string | null): ApiIncidentTimelineEvent {
  return {
    event_type: 'field_message',
    timestamp,
    message: text,
    actor_name: actor,
    source: actor ? 'feld' : 'kp',
  } as ApiIncidentTimelineEvent
}

describe('the KP side of the field reports (§18.19)', () => {
  it('offers Abholung as a control — and Angekommen / Einsatz beendet not at all', () => {
    // Status belongs to the columns. A second settable control for the same
    // fact is a second truth to keep in step.
    renderWithIntl(<FieldReportsRow operation={operation()} />)

    expect(screen.getByRole('switch', { name: 'Abholung nötig' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Angekommen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Einsatz beendet' })).not.toBeInTheDocument()
  })
})

describe('the Meldungen thread', () => {
  const thread = (op: Operation, events: ApiIncidentTimelineEvent[] | null) =>
    renderWithIntl(
      <FieldMessageThread operation={op} events={events} isLoading={false} failed={false} onRetry={vi.fn()} />,
    )

  it('carries the two reports as entries, in time order with the messages', () => {
    thread(
      operation({
        fieldArrivedAt: new Date('2026-08-09T21:14:00Z'),
        fieldArrivedBy: 'p-1',
        fieldCompleteReportedAt: new Date('2026-08-09T21:41:00Z'),
        fieldCompleteReportedBy: 'p-1',
      }),
      [message('2026-08-09T21:30:00Z', 'Keller leer, Pumpe läuft noch', 'Muster Hans')],
    )

    const entries = screen.getAllByRole('listitem')
    expect(entries).toHaveLength(3)
    expect(within(entries[0]).getByText('Angekommen')).toBeInTheDocument()
    expect(within(entries[1]).getByText('Keller leer, Pumpe läuft noch')).toBeInTheDocument()
    expect(within(entries[2]).getByText('Einsatz beendet')).toBeInTheDocument()
    // Attributed, like every other entry: a personnel FK means the crew tapped it.
    expect(within(entries[0]).getByText(/vom Feld, Muster Hans/)).toBeInTheDocument()
  })

  it('says "im KP erfasst" for a report with no crew behind it', () => {
    thread(
      operation({ fieldCompleteReportedAt: new Date('2026-08-09T21:41:00Z'), fieldCompleteReportedBy: null }),
      [],
    )

    const entry = screen.getByRole('listitem')
    expect(within(entry).getByText('Einsatz beendet')).toBeInTheDocument()
    expect(within(entry).getByText(/im KP erfasst/)).toBeInTheDocument()
  })

  it('is empty only when nothing was reported and nothing was said', () => {
    thread(operation(), [])
    expect(screen.getByText('Noch keine Meldungen.')).toBeInTheDocument()
  })
})
