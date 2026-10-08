/**
 * One real backend sentence per template, taken apart into what / where · who.
 * The strings are the backend's own (see the file list in notification-format.ts);
 * if a template changes there, the matching case here is the one to update.
 */
import { describe, expect, it } from 'vitest'

import { notificationDetail, notificationParts } from './notification-format'

const labels = { fieldReport: 'Neuer Schadenplatz', fieldReportDirect: 'Neuer Schadenplatz – Trupp fährt direkt hin' }
const parts = (type: string, message: string) =>
  notificationParts({ type: type as never, message }, labels)

describe('notificationParts', () => {
  it('field_message: what is asked first, then where · who (the owner\'s case)', () => {
    const p = parts('field_message', 'Meldung vom Feld (Bendik Dimitri) – Bahnhofstrasse 1, Coop Center: Verstärkung nötig')
    expect(p).toEqual({ what: 'Verstärkung nötig', where: 'Bahnhofstrasse 1, Coop Center', who: 'Bendik Dimitri', source: 'feld' })
    expect(notificationDetail(p)).toBe('Bahnhofstrasse 1, Coop Center · Bendik Dimitri')
  })

  it('field_message: keeps a colon inside the message text', () => {
    expect(parts('field_message', 'Meldung vom Feld (im KP erfasst) – Hauptstrasse 41: Bitte: 2 Pumpen').what).toBe('Bitte: 2 Pumpen')
  })

  it('field_message: a structured request (R13) reads as its one-line label', () => {
    const p = parts('field_message', 'Meldung vom Feld (Muster Hans) – Hauptstrasse 1: Material: Tauchpumpe Gr. ×2 – in den Keller')
    expect(p.what).toBe('Material: Tauchpumpe Gr. ×2 – in den Keller')
    expect(p.where).toBe('Hauptstrasse 1')
  })

  it('field_message without person and place is just the text', () => {
    expect(parts('field_message', 'Meldung vom Feld: Strom ist weg')).toEqual({ what: 'Strom ist weg', source: 'feld' })
  })

  it('field_report: a new Schadenplatz, plain and taken over', () => {
    expect(parts('field_report', 'Meldung vom Feld: Hauptstrasse 41 (Fabio Wyss)')).toEqual({
      what: 'Neuer Schadenplatz', where: 'Hauptstrasse 41', who: 'Fabio Wyss', source: 'feld',
    })
    expect(parts('field_report', 'Meldung vom Feld – Trupp fährt direkt hin: Hauptstrasse 41 (Fabio Wyss)').what).toBe(
      'Neuer Schadenplatz – Trupp fährt direkt hin',
    )
  })

  it('field_arrived / field_complete / rapport_submitted: prefix, place, actor suffix', () => {
    expect(parts('field_arrived', 'Angekommen: Mühlemattstrasse 18 · Bendik Dimitri')).toEqual({
      what: 'Angekommen', where: 'Mühlemattstrasse 18', who: 'Bendik Dimitri', source: 'feld',
    })
    expect(parts('field_complete', 'Einsatz beendet gemeldet: Mühlemattstrasse 18 · automatisch (GPS)')).toMatchObject({
      what: 'Einsatz beendet gemeldet', who: 'automatisch (GPS)',
    })
    expect(parts('rapport_submitted', 'Rapport erfasst: Bahnhofstrasse 1, Coop Center · im KP erfasst')).toMatchObject({
      what: 'Rapport erfasst', where: 'Bahnhofstrasse 1, Coop Center', who: 'im KP erfasst',
    })
  })

  it('field_pickup: the note belongs to what is asked', () => {
    expect(
      parts('field_pickup', 'Abholung nötig: Bahnhofstrasse 1, Coop Center (2 Personen beim Hintereingang) · Bendik Dimitri'),
    ).toEqual({
      what: 'Abholung nötig – 2 Personen beim Hintereingang', where: 'Bahnhofstrasse 1, Coop Center', who: 'Bendik Dimitri', source: 'feld',
    })
    expect(parts('field_pickup', 'Abholung erledigt: Mühlemattstrasse 18 · Bendik Dimitri')).toMatchObject({
      what: 'Abholung erledigt', where: 'Mühlemattstrasse 18',
    })
  })

  it('reko_arrived: with and without the name', () => {
    expect(parts('reko_arrived', 'Reko vor Ort: Lisa Hoffmann bei Mühlemattstrasse 18')).toEqual({
      what: 'Reko vor Ort', where: 'Mühlemattstrasse 18', who: 'Lisa Hoffmann', source: 'reko',
    })
    expect(parts('reko_arrived', 'Reko vor Ort: Mühlemattstrasse 18')).toEqual({
      what: 'Reko vor Ort', where: 'Mühlemattstrasse 18', source: 'reko',
    })
  })

  it('reko_submitted: the verdict is what matters', () => {
    expect(parts('reko_submitted', 'Reko abgeschlossen: Hauptstrasse 41 von Lisa Hoffmann – Einsatz relevant (3 Pers., ~2h)')).toEqual({
      what: 'Reko abgeschlossen – Einsatz relevant (3 Pers., ~2h)', where: 'Hauptstrasse 41', who: 'Lisa Hoffmann', source: 'reko',
    })
    expect(parts('reko_submitted', 'Reko abgeschlossen: Hauptstrasse 41 – Kein Einsatz nötig')).toEqual({
      what: 'Reko abgeschlossen – Kein Einsatz nötig', where: 'Hauptstrasse 41', source: 'reko',
    })
  })

  it('vehicle_arrived / vehicle_returned', () => {
    expect(parts('vehicle_arrived', 'TLF vor Ort: Mühlemattstrasse 18')).toEqual({
      what: 'TLF vor Ort', where: 'Mühlemattstrasse 18', source: 'vehicle',
    })
    expect(parts('vehicle_returned', 'TLF zurück im Magazin')).toEqual({ what: 'TLF zurück im Magazin', source: 'vehicle' })
  })

  it('time_overdue: the place comes first in the sentence, second on screen', () => {
    expect(parts('time_overdue', 'Mühlemattstrasse 18: 56m im Status «Disponiert»')).toEqual({
      what: '56m im Status «Disponiert»', where: 'Mühlemattstrasse 18', source: 'time',
    })
    expect(parts('time_overdue', 'Hauptstrasse 41: seit 1h 5m abgeschlossen, nicht archiviert').what).toBe(
      'seit 1h 5m abgeschlossen, nicht archiviert',
    )
  })

  it('training_emergency: escalation, breakdown, new exercise', () => {
    expect(parts('training_emergency', 'Lage verschärft: Wasser im Keller – Wasser steigt, Stromverteiler betroffen')).toEqual({
      what: 'Lage verschärft – Wasser steigt, Stromverteiler betroffen', where: 'Wasser im Keller', source: 'alarm',
    })
    expect(parts('training_emergency', 'Fahrzeug TLF ausgefallen: Wasser im Keller – Ersatz disponieren')).toMatchObject({
      what: 'Fahrzeug TLF ausgefallen – Ersatz disponieren', where: 'Wasser im Keller',
    })
    expect(parts('training_emergency', 'Neuer Übungs-Einsatz: Kellerbrand (Bahnhofstrasse 1, 4104 Oberwil)')).toEqual({
      what: 'Neuer Übungs-Einsatz', where: 'Kellerbrand (Bahnhofstrasse 1, 4104 Oberwil)', source: 'alarm',
    })
  })

  it('system notifications stay one sentence', () => {
    for (const [type, message] of [
      ['no_personnel', 'Kein Personal mehr verfügbar - alle eingecheckten Personen sind zugewiesen'],
      ['no_materials', "Nur noch 2 Einheiten von 'Depot' verfügbar"],
      ['personnel_fatigue', 'Müller Hans ist seit 5 Stunden im Einsatz'],
      ['missing_location', "Einsatz 'Kellerbrand' hat keine geokodierte Position"],
      ['feld_code_rotated', 'Feld-Code für Unwetter nach zu vielen Fehlversuchen neu erzeugt'],
    ]) {
      const p = parts(type, message)
      expect(p).toEqual({ what: message, source: 'system' })
      expect(notificationDetail(p)).toBeUndefined()
    }
  })

  it('falls back to the whole sentence when a template does not match', () => {
    expect(parts('field_message', 'Neue Meldung vom Feld')).toEqual({ what: 'Neue Meldung vom Feld', source: 'feld' })
    expect(parts('reko_submitted', 'Reko abgeschlossen')).toEqual({ what: 'Reko abgeschlossen', source: 'reko' })
    expect(parts('field_arrived', 'Angekommen')).toEqual({ what: 'Angekommen', source: 'feld' })
  })
})
