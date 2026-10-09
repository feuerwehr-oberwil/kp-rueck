import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import de from '@/messages/de.json'
import fr from '@/messages/fr.json'
import type { ApiFieldRequest } from '@/lib/api/types'
import {
  assignTargetFor,
  fieldRequestLabel,
  fieldRequestStatusLabel,
  fieldSideState,
  isOpenRequest,
  representedNotificationIds,
  type RequestTranslator,
} from './field-requests'

const tDe = createTranslator({ locale: 'de', messages: de, namespace: 'feld.requests' }) as unknown as RequestTranslator
const tFr = createTranslator({ locale: 'fr', messages: fr, namespace: 'feld.requests' }) as unknown as RequestTranslator

function request(overrides: Partial<ApiFieldRequest> = {}): ApiFieldRequest {
  return {
    id: 'r1',
    incident_id: 'i1',
    kind: 'message',
    status: 'open',
    text: null,
    item: null,
    quantity: null,
    label: 'server label',
    created_at: '2026-10-08T20:00:00Z',
    created_by_name: 'Muster Hans',
    from_field: true,
    notification_id: 'n1',
    seen_at: null,
    in_progress_at: null,
    in_progress_by_name: null,
    done_at: null,
    done_by_name: null,
    ...overrides,
  }
}

describe('fieldRequestLabel', () => {
  it('words a material request as «Material: X ×n»', () => {
    const r = request({ kind: 'material', item: 'Tauchpumpe Gr.', quantity: 2 })
    expect(fieldRequestLabel(r, tDe)).toBe('Material: Tauchpumpe Gr. ×2')
    expect(fieldRequestLabel(r, tFr)).toBe('Matériel : Tauchpumpe Gr. ×2')
  })

  it('appends the note', () => {
    const r = request({ kind: 'material', item: 'Wassersauger', quantity: 1, text: 'in den Keller' })
    expect(fieldRequestLabel(r, tDe)).toBe('Material: Wassersauger ×1 – in den Keller')
  })

  it('counts people for Verstärkung, singular and plural', () => {
    expect(fieldRequestLabel(request({ kind: 'personnel', quantity: 1 }), tDe)).toBe('Verstärkung: 1 Person')
    expect(fieldRequestLabel(request({ kind: 'personnel', quantity: 4, item: 'Atemschutz' }), tDe)).toBe(
      'Verstärkung: 4 Personen Atemschutz',
    )
    expect(fieldRequestLabel(request({ kind: 'personnel', quantity: 2 }), tFr)).toBe('Renfort : 2 personnes')
  })

  it('a sentence is its own label; an unknown kind falls back to the server', () => {
    expect(fieldRequestLabel(request({ text: 'Pumpe läuft' }), tDe)).toBe('Pumpe läuft')
    expect(fieldRequestLabel(request({ kind: 'other' as never }), tDe)).toBe('server label')
  })
})

describe('states', () => {
  it('open and in_progress are owed, done is not', () => {
    expect(isOpenRequest({ status: 'open' })).toBe(true)
    expect(isOpenRequest({ status: 'in_progress' })).toBe(true)
    expect(isOpenRequest({ status: 'done' })).toBe(false)
  })

  it('status words', () => {
    expect(fieldRequestStatusLabel('open', tDe)).toBe('offen')
    expect(fieldRequestStatusLabel('in_progress', tDe)).toBe('in Arbeit')
    expect(fieldRequestStatusLabel('done', tDe)).toBe('erledigt')
  })

  it('the crew reads gesehen only once the KP dismissed the bell or worked it', () => {
    expect(fieldSideState({ status: 'open', seen_at: null })).toBe('sent')
    expect(fieldSideState({ status: 'open', seen_at: '2026-10-08T20:01:00Z' })).toBe('seen')
    expect(fieldSideState({ status: 'in_progress', seen_at: null })).toBe('in_progress')
    expect(fieldSideState({ status: 'done', seen_at: null })).toBe('done')
  })
})

describe('assignTargetFor', () => {
  it('maps material and Verstärkung onto the assignment dialog, nothing else', () => {
    expect(assignTargetFor({ kind: 'material', item: 'Tauchpumpe Gr.' })).toEqual({
      resourceType: 'materials',
      search: 'Tauchpumpe Gr.',
    })
    expect(assignTargetFor({ kind: 'personnel', item: null })).toEqual({ resourceType: 'crew' })
    expect(assignTargetFor({ kind: 'message', item: null })).toBeNull()
    expect(assignTargetFor({ kind: 'pickup', item: null })).toBeNull()
  })
})

describe('representedNotificationIds', () => {
  it('only open requests stand in for their bell entry', () => {
    const ids = representedNotificationIds([
      { notification_id: 'a', status: 'open' },
      { notification_id: 'b', status: 'done' },
      { notification_id: null, status: 'open' },
    ])
    expect([...ids]).toEqual(['a'])
  })
})
