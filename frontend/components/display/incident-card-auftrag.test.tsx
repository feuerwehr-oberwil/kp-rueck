import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'
import type { GroupResources, IncidentGroup } from '@/lib/types/groups'

import { DisplayIncidentCard } from '@/components/display/incident-card'

/**
 * The Auftrag row on the WALL card, which is the surface where the one-line
 * version failed hardest: measured on the real board, the summary got 19px of a
 * 264px card at 1280 (39px of 284px at 1920) for 106px of content, so it
 * rendered «P…» — and a wall has nobody to hover the tooltip that could have
 * given it back. The tooltip could not have anyway: it carried the Auftrag NAME,
 * the one part of the row that was never cut off.
 *
 * So two things are pinned here, and nothing about styling: the row states the
 * stop position and the summary as TEXT (not truncated away into a `title`), and
 * the `title` carries the WHOLE row rather than just the name.
 */

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'stop-6',
    location: 'Allschwilerstrasse 14, 4104 Oberwil',
    vehicle: null,
    vehicles: [],
    incidentType: 'elementarereignis',
    dispatchTime: new Date('2026-08-09T10:00:00Z'),
    crew: [],
    priority: 'low',
    status: 'incoming',
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
    groupId: 'auftrag-1',
    groupPosition: 5,
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

const auftrag = {
  id: 'auftrag-1',
  name: 'Sturmholz Oberwil',
  color: null,
  notes: null,
  position: 0,
  stopIds: ['s1', 's2', 's3', 's4', 's5', 'stop-6', 's7'],
  assignments: [],
  progress: { total: 7, done: 0 },
  lastAnnounced: null,
} as unknown as IncidentGroup

const auftragResources: GroupResources = {
  vehicles: [{ assignmentId: 'a1', resourceId: 'v1', name: 'Pio' }],
  personnel: [
    { assignmentId: 'a2', resourceId: 'p1', name: 'Weber Martin', isLeader: true },
    { assignmentId: 'a3', resourceId: 'p2', name: 'Moser Lea' },
    { assignmentId: 'a4', resourceId: 'p3', name: 'Baumann Michael' },
  ],
  materials: [{ assignmentId: 'a5', resourceId: 'm1', name: 'Motorsäge Gr.' }],
}

function renderCard() {
  return renderWithIntl(
    <DisplayIncidentCard operation={operation()} auftrag={auftrag} auftragResources={auftragResources} />,
  )
}

describe('the wall card’s Auftrag row', () => {
  it('states the stop position and the route’s resources as text, not only in a tooltip', () => {
    renderCard()
    expect(screen.getByText('Sturmholz Oberwil')).toBeInTheDocument()
    // «Stopp», not «Stop» — and spelled out, so «6/7» cannot be read as a date.
    expect(screen.getByText('Stopp 6 von 7')).toBeInTheDocument()
    expect(screen.getByText(/Pio · 1 Gerät/)).toBeInTheDocument()
  })

  it('names the crew instead of counting it — the wall carries one field fewer', () => {
    renderCard()
    // The kanban card says «3 Pers» here because its chips stop at six. This one
    // draws all three names 4px below the line, so the count would only caption
    // a list the reader is already looking at.
    expect(screen.getByText('Weber Martin')).toBeInTheDocument()
    expect(screen.getByText('Moser Lea')).toBeInTheDocument()
    expect(screen.getByText('Baumann Michael')).toBeInTheDocument()
    expect(screen.queryByText(/3 Pers/)).not.toBeInTheDocument()
  })

  it('puts the whole row in the tooltip, not just the Auftrag name', () => {
    const { container } = renderCard()
    const row = container.querySelector('[title]:has(> svg.lucide-waypoints)')
    // Same one-field-fewer summary as the visible line — the tooltip exists for
    // the truncation case, not to smuggle back a field the wall dropped.
    expect(row?.getAttribute('title')).toBe('Sturmholz Oberwil · Stopp 6 von 7 · Pio · 1 Gerät')
  })

  it('falls back to the incident’s own group position when the route has lost the stop', () => {
    renderWithIntl(
      <DisplayIncidentCard
        operation={operation({ id: 'not-in-route' })}
        auftrag={auftrag}
        auftragResources={auftragResources}
      />,
    )
    expect(screen.getByText('Stopp 6 von 7')).toBeInTheDocument()
  })
})
