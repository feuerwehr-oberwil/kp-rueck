import { describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'

/**
 * «Quieter cards» on the phone list (review 2026-10, sweep 2026-10-23). Every
 * priority reads like the board card (`PRIORITY_CARD_CLASSES`): a 4px left edge,
 * red + wash + pulse for Hoch, amber for Mittel, plain for Niedrig — no status
 * tint, no dot. Pinned because the tint is one `cn()` argument away from coming back.
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
  it('draws Hoch with the board card red edge and pulse, without a dot or a 2px frame', () => {
    const card = cardOf(operation({ priority: 'high' }))
    expect(card).toHaveClass('border-l-4', 'border-l-destructive', 'priority-high-pulse')
    expect(card).not.toHaveClass('border-2')
    expect(card.querySelector('.rounded-full')).toBeNull()
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

  it('marks the Einsatzleiter with the desk «EL», never a star', () => {
    const card = cardOf(operation({ leaderName: 'Muster Max' }))
    expect(card.textContent).toMatch(/EL.*Muster Max/)
    expect(card.querySelector('svg.lucide-star')).toBeNull()
  })

  it('says «kein Rapport» as a quiet line, not a pill, and the type as text, not a chip', () => {
    const card = cardOf(operation({ status: 'active', hasBeenDispatched: true }))
    const line = Array.from(card.querySelectorAll('p')).find((p) => p.textContent === 'kein Rapport')
    expect(line).toHaveClass('text-muted-foreground')
    expect(line).not.toHaveClass('rounded-full')
    expect(card.querySelectorAll('[data-slot="badge"]')).toHaveLength(1)
  })
})
