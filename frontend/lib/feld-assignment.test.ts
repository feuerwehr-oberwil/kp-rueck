import { describe, it, expect } from 'vitest'
import {
  assignmentRapportApplies,
  decodeFeldCredential,
  feedBucket,
  incidentHasRapport,
  isLiveAssignment,
  journeyState,
  owesRapport,
  rekoWindowClosed,
} from './feld-assignment'
import type { ApiFeldAssignment, ApiFeldReko } from '@/lib/api/types'

// Same defaults as app/feld/page.test.tsx: an own, live crew row on an active
// Schadenplatz with no rapport yet.
function assignment(overrides: Partial<ApiFeldAssignment> = {}): ApiFeldAssignment {
  return {
    incident_id: 'inc-1',
    incident_title: 'Keller Wasser',
    incident_type: 'elementarereignis',
    incident_status: 'active',
    description: null,
    contact: null,
    contact_phone: null,
    crew: [],
    vehicles: [],
    materials: [],
    reko: null,
    location_address: 'Hauptstrasse 1',
    location_lat: null,
    location_lng: null,
    is_active_assignment: true,
    source: 'crew',
    rapport_state: 'none',
    arrived_at: null,
    arrived_by_automation: false,
    field_complete_reported_at: null,
    pickup_needed: false,
    pickup_note: null,
    pickup_requested_at: null,
    leader_personnel_id: null,
    leader_name: null,
    group_id: null,
    group_name: null,
    group_position: null,
    ...overrides,
  }
}

const reko = (overrides: Partial<ApiFeldReko> = {}): ApiFeldReko => ({
  summary: null,
  notes: null,
  dangers: [],
  is_relevant: true,
  submitted_at: '2026-09-23T08:00:00Z',
  submitted_by_name: 'Reko',
  ...overrides,
})

/** A JWT-shaped string with the given payload; header and signature are junk —
 *  the decode is routing only and never looks at them. */
function token(payload: unknown, { padded = false } = {}): string {
  let body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_')
  if (!padded) body = body.replace(/=+$/, '')
  return `eyJhbGciOiJIUzI1NiJ9.${body}.sig`
}

describe('rekoWindowClosed', () => {
  it('closes a Reko row once the KP has disponiert without a Reko-Meldung', () => {
    for (const status of ['enroute', 'active', 'returning', 'complete']) {
      expect(rekoWindowClosed(assignment({ source: 'reko', incident_status: status }))).toBe(true)
    }
  })

  it('stays open before «Disponiert»', () => {
    for (const status of ['incoming', 'reko', 'reko_done']) {
      expect(rekoWindowClosed(assignment({ source: 'reko', incident_status: status }))).toBe(false)
    }
  })

  it('never closes once a Reko has landed, and never for a non-Reko row', () => {
    expect(rekoWindowClosed(assignment({ source: 'reko', incident_status: 'active', reko: reko() }))).toBe(false)
    expect(rekoWindowClosed(assignment({ source: 'crew', incident_status: 'complete' }))).toBe(false)
    expect(rekoWindowClosed(assignment({ source: 'driver', incident_status: 'complete' }))).toBe(false)
  })
})

describe('isLiveAssignment', () => {
  it('is the assignment flag, minus a Reko row whose window closed', () => {
    expect(isLiveAssignment(assignment())).toBe(true)
    expect(isLiveAssignment(assignment({ is_active_assignment: false }))).toBe(false)
    expect(isLiveAssignment(assignment({ source: 'reko', incident_status: 'active' }))).toBe(false)
    expect(isLiveAssignment(assignment({ source: 'reko', incident_status: 'reko' }))).toBe(true)
  })
})

describe('incidentHasRapport / assignmentRapportApplies', () => {
  it('a Schadenplatz nobody was sent to has no rapport', () => {
    const row = assignment({ incident_status: 'incoming', has_been_dispatched: false })
    expect(incidentHasRapport(row)).toBe(false)
    expect(assignmentRapportApplies(row)).toBe(false)
  })

  it('a dispatched one has it — on every row, but it is only the crew row\'s to file', () => {
    const crew = assignment({ incident_status: 'complete', has_been_dispatched: true })
    expect(incidentHasRapport(crew)).toBe(true)
    expect(assignmentRapportApplies(crew)).toBe(true)
    for (const source of ['driver', 'reko', 'magazin'] as const) {
      const other = assignment({ source, incident_status: 'complete', has_been_dispatched: true })
      expect(incidentHasRapport(other)).toBe(true)
      expect(assignmentRapportApplies(other)).toBe(false)
    }
  })

  it('an existing rapport row always keeps the rapport reachable', () => {
    const row = assignment({ incident_status: 'incoming', has_been_dispatched: false, rapport_state: 'draft' })
    expect(incidentHasRapport(row)).toBe(true)
  })

  it('«Kein Einsatz nötig» on a closed card owes no rapport', () => {
    const row = assignment({
      incident_status: 'complete',
      has_been_dispatched: true,
      reko: reko({ is_relevant: false }),
    })
    expect(incidentHasRapport(row)).toBe(false)
  })
})

describe('owesRapport', () => {
  it('owes one until it is submitted', () => {
    const base = { incident_status: 'complete', has_been_dispatched: true, is_active_assignment: false }
    expect(owesRapport(assignment({ ...base, rapport_state: 'none' }))).toBe(true)
    expect(owesRapport(assignment({ ...base, rapport_state: 'draft' }))).toBe(true)
    expect(owesRapport(assignment({ ...base, rapport_state: 'submitted' }))).toBe(false)
  })

  it('a driver row never owes one', () => {
    expect(owesRapport(assignment({ source: 'driver', incident_status: 'complete', has_been_dispatched: true }))).toBe(false)
  })
})

describe('feedBucket', () => {
  it('0 — standing there: live and arrived', () => {
    expect(feedBucket(assignment({ arrived_at: '2026-09-23T08:10:00Z' }))).toBe(0)
  })

  it('1 — left, but the rapport is still open (beats a newer live task)', () => {
    const left = assignment({
      is_active_assignment: false,
      incident_status: 'complete',
      has_been_dispatched: true,
    })
    const underway = assignment({ source: 'driver', incident_status: 'enroute', has_been_dispatched: true })
    expect(feedBucket(left)).toBe(1)
    expect(feedBucket(underway)).toBe(2)
    expect(feedBucket(left)).toBeLessThan(feedBucket(underway))
  })

  it('2 — live but not arrived; a crew row that already owes the rapport sorts as 1', () => {
    // `owesRapport` is checked before the plain live bucket, so a dispatched
    // crew row that has not arrived yet sorts with the owed ones.
    expect(feedBucket(assignment({ incident_status: 'enroute', has_been_dispatched: true }))).toBe(1)
    // A live row that owes nothing (a driver) is plain «unterwegs».
    expect(feedBucket(assignment({ source: 'driver', incident_status: 'enroute' }))).toBe(2)
  })

  it('3 — everything else', () => {
    expect(feedBucket(assignment({ is_active_assignment: false, rapport_state: 'submitted', has_been_dispatched: true }))).toBe(3)
    expect(feedBucket(assignment({ source: 'reko', incident_status: 'active' }))).toBe(3)
  })
})

describe('journeyState', () => {
  it('hin — dran — zurück, read off the crew\'s own taps', () => {
    expect(journeyState(assignment())).toBe('approach')
    expect(journeyState(assignment({ arrived_at: '2026-09-23T08:10:00Z' }))).toBe('onSite')
    expect(journeyState(assignment({ arrived_at: '2026-09-23T08:10:00Z', field_complete_reported_at: '2026-09-23T09:00:00Z' }))).toBe('returning')
  })

  it('the one board status that counts: Rückfahrt', () => {
    expect(journeyState(assignment({ incident_status: 'returning' }))).toBe('returning')
  })

  it('no chip for work that is not live', () => {
    expect(journeyState(assignment({ is_active_assignment: false }))).toBeNull()
    expect(journeyState(assignment({ source: 'reko', incident_status: 'active' }))).toBeNull()
  })
})

describe('decodeFeldCredential', () => {
  it('recognises a bound token and names its person', () => {
    const t = token({ type: 'feld', unlocked: true, personnel_id: 'p-7', claim_id: 'c-1' })
    expect(decodeFeldCredential(t)).toEqual({ personnelId: 'p-7' })
  })

  it('an unlocked token without a claim is a picker credential — no person', () => {
    expect(decodeFeldCredential(token({ type: 'feld', unlocked: true, personnel_id: 'p-7' }))).toEqual({ personnelId: null })
    expect(decodeFeldCredential(token({ type: 'feld', unlocked: true }))).toEqual({ personnelId: null })
  })

  it('works on padded payloads too', () => {
    const t = token({ type: 'feld', unlocked: true, personnel_id: 42, claim_id: 'c' }, { padded: true })
    expect(decodeFeldCredential(t)).toEqual({ personnelId: '42' })
  })

  it('anything else is not a credential: locked, wrong type, or not a JWT', () => {
    expect(decodeFeldCredential(token({ type: 'feld', unlocked: false }))).toBeNull()
    expect(decodeFeldCredential(token({ type: 'reko', unlocked: true }))).toBeNull()
    expect(decodeFeldCredential('poster-token-without-dots')).toBeNull()
    expect(decodeFeldCredential('a.!!!.c')).toBeNull()
  })
})
