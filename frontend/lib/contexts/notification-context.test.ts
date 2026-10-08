import { afterEach, describe, expect, it } from 'vitest'

import { localizeNotificationMessage } from './notification-context'

describe('localizeNotificationMessage', () => {
  afterEach(() => {
    document.cookie = 'NEXT_LOCALE=; path=/; max-age=0'
  })

  it('rebuilds the Feld-Code rotation in the operator’s language', () => {
    const rotated = { type: 'feld_code_rotated' as const, message: 'Feld-Code für Sturm nach zu vielen Fehlversuchen neu erzeugt' }

    expect(localizeNotificationMessage(rotated, 'Sturm')).toBe(
      'Feld-Code für Sturm nach zu vielen Fehlversuchen neu erzeugt'
    )
    document.cookie = 'NEXT_LOCALE=fr; path=/'
    expect(localizeNotificationMessage(rotated, 'Sturm')).toBe(
      'Nouveau code terrain pour Sturm après trop de tentatives erronées'
    )
  })

  it('leaves every server-composed message alone', () => {
    document.cookie = 'NEXT_LOCALE=fr; path=/'
    const pickup = { type: 'field_pickup' as const, message: 'Abholung nötig: Hauptstrasse 1' }

    expect(localizeNotificationMessage(pickup, 'Sturm')).toBe('Abholung nötig: Hauptstrasse 1')
  })

  it('says the grouped time-on-duty warning in the operator’s language — German unchanged', () => {
    const many = {
      type: 'personnel_fatigue' as const,
      message: '7 Personen seit über 4 h im Einsatz: Müller Hans (6 h), Meier Anna (5 h) und 5 weitere',
    }
    const one = { type: 'personnel_fatigue' as const, message: 'Seit über 4 h im Einsatz: Müller Hans (5 h)' }

    expect(localizeNotificationMessage(many, 'Sturm')).toBe(many.message)
    expect(localizeNotificationMessage(one, 'Sturm')).toBe(one.message)
    document.cookie = 'NEXT_LOCALE=fr; path=/'
    expect(localizeNotificationMessage(many, 'Sturm')).toBe(
      '7 personnes en service depuis plus de 4 h : Müller Hans (6 h), Meier Anna (5 h) et 5 autres'
    )
    expect(localizeNotificationMessage(one, 'Sturm')).toBe('En service depuis plus de 4 h : Müller Hans (5 h)')
  })

  it('leaves an older per-person fatigue sentence as it came', () => {
    document.cookie = 'NEXT_LOCALE=fr; path=/'
    const legacy = { type: 'personnel_fatigue' as const, message: 'Müller Hans ist seit 5 Stunden im Einsatz' }
    expect(localizeNotificationMessage(legacy, 'Sturm')).toBe(legacy.message)
  })
})
