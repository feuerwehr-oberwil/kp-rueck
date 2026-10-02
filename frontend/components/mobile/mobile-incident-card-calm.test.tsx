import { describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'

/**
 * «Quieter cards» on the phone list (review 2026-10). Hoch keeps EXACTLY its
 * red treatment; Mittel/Niedrig lose the status tint and the dot, Mittel keeps
 * an amber left edge. Pinned because the tint is one `cn()` argument away from
 * coming back.
 */

vi.mock('@/lib/api-client', () => ({ apiClient: {} }))

import { MobileIncidentCard } from '@/components/mobile/mobile-incident-card'

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'incident-1',
    location: 'Hauptstrasse 1, 4104 Oberwil',
    vehicle: null,
    vehicles: [],
    incidentType: 'brandbekaempfung',
    dispatchTime: new Date('2026-08-09T10:00:00Z'),
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

function cardOf(op: Operation) {
  const { container } = renderWithIntl(
    <MobileIncidentCard operation={op} onClick={vi.fn()} formatLocation={(a) => a} />,
  )
  return container.querySelector('[data-slot="card"]') as HTMLElement
}

describe('the phone Einsatz card', () => {
  it('keeps the full red treatment on Hoch', () => {
    const card = cardOf(operation({ priority: 'high' }))
    expect(card).toHaveClass('border-2', 'border-red-500/40', 'bg-red-500/[0.04]')
    expect(card.querySelector('.bg-red-500.rounded-full')).not.toBeNull()
  })

  it('draws Mittel as a neutral card with an amber edge and no status tint or dot', () => {
    const card = cardOf(operation({ priority: 'medium' }))
    expect(card).toHaveClass('bg-card', 'border-l-4', 'border-l-warning')
    expect(card.className).not.toMatch(/bg-(orange|blue|emerald|teal|sky|slate|gray)-/)
    expect(card.querySelector('.rounded-full.bg-amber-500')).toBeNull()
  })

  it('draws Niedrig as a plain card', () => {
    const card = cardOf(operation({ priority: 'low' }))
    expect(card).toHaveClass('bg-card', 'border-l-border')
    expect(card.className).not.toMatch(/bg-(orange|blue|emerald|teal|sky|slate|gray)-/)
  })

  it('keeps the «kein Rapport» chip and the EL star neutral', () => {
    const card = cardOf(
      operation({ priority: 'high', status: 'active', hasBeenDispatched: true, leaderName: 'Muster Max' }),
    )
    expect(card.textContent).toMatch(/kein Rapport/)
    expect(card.textContent).toMatch(/Muster Max/)
    expect(card.innerHTML).not.toMatch(/amber-500\/15|text-amber-500/)
  })
})
