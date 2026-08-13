import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'
import de from '@/messages/de.json'
import fr from '@/messages/fr.json'

// The strings the board uses to say «there is more than you can see» — on a
// card whose crew or material list is capped, in the footer's overflow button,
// and in a sidebar that is loading, filtered to nothing, or genuinely empty.
//
// They are pinned here rather than left to review because they are all counted
// nouns, and a counted noun written without a real ICU plural renders «1
// Personen» — a bug this catalogue has had before. The German wording also
// carries the agreed vocabulary: a countable single item is a Gerät, «Mittel»
// means medium priority and nothing else, and a route position is a «Stopp».
const t = (locale: 'de' | 'fr') =>
  createTranslator({
    locale,
    messages: locale === 'de' ? de : fr,
    namespace: 'kanban',
  }) as unknown as (key: string, values?: Record<string, string | number>) => string

describe('German board counters', () => {
  const de_ = t('de')

  it('inflects the hidden-crew tooltip for one and for many', () => {
    expect(de_('card.moreCrewTitle', { count: 1 })).toContain('1 weitere Person')
    expect(de_('card.moreCrewTitle', { count: 24 })).toContain('24 weitere Personen')
  })

  it('counts single items as Geräte, never as «Mittel»', () => {
    expect(de_('card.moreMaterialTitle', { count: 1 })).toContain('1 weiteres Gerät')
    expect(de_('card.moreMaterialTitle', { count: 6 })).toContain('6 weitere Geräte')
    expect(de_('card.auftragMatSummary', { count: 1 })).toBe('1 Gerät')
    expect(de_('card.auftragMatSummary', { count: 3 })).toBe('3 Geräte')
  })

  it('spells a route position as «Stopp N von M»', () => {
    expect(de_('card.auftragStopLine', { pos: 3, total: 7 })).toBe('Stopp 3 von 7')
  })

  it('inflects the footer overflow tooltip', () => {
    expect(de_('dashboard.moreTitle', { count: 1 })).toBe('1 weiteres Bedienelement')
    expect(de_('dashboard.moreTitle', { count: 4 })).toBe('4 weitere Bedienelemente')
  })

  it('never claims a number while the roster is still loading', () => {
    // «0/0 verfügbar» before the first response is a statement about the
    // station, not an absence of one. This string must contain no digit.
    expect(de_('common.counterLoading')).not.toMatch(/\d/)
  })

  it('says how much of the list is on screen while a search narrows it', () => {
    expect(de_('common.visibleCounter', { shown: 0, total: 17 })).toBe('0 von 17 sichtbar')
  })
})

describe('French board counters', () => {
  const fr_ = t('fr')

  it('inflects the same counts', () => {
    expect(fr_('card.moreCrewTitle', { count: 1 })).toContain('1 personne')
    expect(fr_('card.moreCrewTitle', { count: 24 })).toContain('24 personnes')
    expect(fr_('card.moreMaterialTitle', { count: 1 })).toContain('1 engin')
    expect(fr_('card.moreMaterialTitle', { count: 6 })).toContain('6 engins')
  })

  it('keeps the counter honest while loading', () => {
    expect(fr_('common.counterLoading')).not.toMatch(/\d/)
  })
})
