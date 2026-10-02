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
})
