import { describe, expect, it } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { DisplaySearchProvider, useDisplaySearch } from '@/lib/contexts/display-search-context'
import { DisplaySearchHits } from '@/components/display/display-search-hits'

/** A filtered wall says so (hunt 2026-11-24, owner pick «Suchfeld über den Spalten»). */
describe('DisplaySearchHits', () => {
  let setQuery: (query: string) => void = () => {}
  function Probe() {
    setQuery = useDisplaySearch().setQuery
    return <DisplaySearchHits shown={1} total={23} />
  }

  it('says how many of the Einsätze a search leaves, and nothing without one', () => {
    renderWithIntl(
      <DisplaySearchProvider>
        <Probe />
      </DisplaySearchProvider>,
    )
    expect(screen.queryByRole('status')).toBeNull()

    act(() => setQuery('Keller Marco'))
    expect(screen.getByRole('status')).toHaveTextContent('1 von 23 Einsätzen')
  })
})
