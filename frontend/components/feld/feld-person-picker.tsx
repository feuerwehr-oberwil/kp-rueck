'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { User } from 'lucide-react'

import { BELOW_LINK_PAGE_HEADER_CLASS, LinkPageHeader } from '@/components/link-page/link-page'
import { PersonName, PersonNamingProvider } from '@/components/person-name'
import { SearchEmptyState } from '@/components/ui/empty-state'
import { SearchInput } from '@/components/ui/search-input'
import type { ApiFeldPersonnel } from '@/lib/api-client'
import { sortByName } from '@/lib/roster-order'
import { cn } from '@/lib/utils'

/**
 * The /feld picker: the Ereignis as the heading, a search that stays under the bar, and the
 * roster as rows – a tap claims that person (`onSelect`). The page owns `searchTerm`, so a
 * forget clears it and a failed claim keeps it.
 */
export function FeldPersonPicker({
  eventName,
  personnel,
  loading,
  searchTerm,
  onSearchTermChange,
  onSelect,
}: {
  eventName: string
  personnel: ApiFeldPersonnel[]
  loading: boolean
  searchTerm: string
  onSearchTermChange: (term: string) => void
  onSelect: (person: ApiFeldPersonnel) => void
}) {
  const t = useTranslations('feld')
  const tKanbanCommon = useTranslations('kanban.common')

  const filteredPersonnel = useMemo(() => {
    // The board's Anwesenheit and the /check-in tablet order the same roster with
    // the same comparator (`lib/roster-order.ts`). Deliberately NOT the UI locale:
    // names are roster data, and the list must read the same on a French phone.
    const sorted = sortByName(personnel)
    const term = searchTerm.trim().toLowerCase()
    if (!term) return sorted
    return sorted.filter(p => p.name.toLowerCase().includes(term) || (p.role ?? '').toLowerCase().includes(term))
  }, [personnel, searchTerm])

  return (
    <div className="min-h-dvh bg-background pb-20">
      {/* The Ereignis is the heading. "Schadenplatz-Rapport" was the name of a
          FORM, printed over the screen where somebody looks for themselves in
          a list — and half the people reading it (Fahrer, Magazin, Telefon)
          never file one. What they want confirmed after scanning a poster is
          which Ereignis they just walked into. `t('title')` survives as the
          fallback for the case that has no name yet. In the shared link-page
          header, the same bar the list and the detail carry with the person. */}
      <LinkPageHeader title={eventName || t('title')} />

      <div className="max-w-md mx-auto px-4">
        {/* The intro and the search stay under the bar while the names scroll (owner,
            24.11.2026): in a long roster the field to narrow it was a scroll away. */}
        <div data-testid="feld-picker-head" className={cn(BELOW_LINK_PAGE_HEADER_CLASS, '-mx-4 px-4 pt-4 pb-4')}>
          <p className="mb-4 text-sm text-muted-foreground">{t('picker.description')}</p>
          <SearchInput
            value={searchTerm}
            onValueChange={onSearchTermChange}
            placeholder={t('picker.searchPlaceholder')}
            size="lg"
          />
        </div>

        <div className="space-y-3">
          {loading ? null : filteredPersonnel.length === 0 && personnel.length > 0 && searchTerm.trim() ? (
            <SearchEmptyState query={searchTerm} onClear={() => onSearchTermChange('')} />
          ) : filteredPersonnel.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {personnel.length === 0 ? t('picker.empty') : t('picker.noneFound')}
            </div>
          ) : (
            // Namesakes on the picker list show their Kennung — this is where a
            // person picks themselves, and two «Meier Alex» must not look alike.
            <PersonNamingProvider roster={personnel.map(p => ({ id: p.personnel_id, name: p.name, kennung: p.kennung }))}>
            {filteredPersonnel.map(person => (
              <button
                key={person.personnel_id}
                onClick={() => onSelect(person)}
                className="w-full cursor-pointer flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors text-left"
              >
                <div className="flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center bg-muted">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  {/* Wrapped, never cut: this is where a person finds their own name. */}
                  <div className="font-medium break-words">
                    <PersonName name={person.name} kennung={person.kennung ?? null} display={person.name.trim() || tKanbanCommon('unknownResource')} />
                  </div>
                  {person.role && <div className="text-sm text-muted-foreground break-words">{person.role}</div>}
                </div>
                {/* Only for somebody with work: «0 Schadenplätze» on most rows squeezed the
                    names onto two lines and drowned the rows that matter. */}
                {person.incident_count > 0 && (
                  <div className="flex-shrink-0 text-right">
                    <div className="text-sm font-medium">
                      {t('picker.incidentCount', { count: person.incident_count })}
                    </div>
                    {person.missing_rapport_count > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t('picker.missingRapport', { count: person.missing_rapport_count })}
                      </div>
                    )}
                  </div>
                )}
              </button>
            ))}
            </PersonNamingProvider>
          )}
        </div>
      </div>
    </div>
  )
}
