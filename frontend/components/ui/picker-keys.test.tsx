import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { PickerDialog } from '@/components/ui/picker-dialog'
import { SearchInput } from '@/components/ui/search-input'
import { PersonPickTile } from '@/components/kanban/assignment-list-section'
import { renderWithIntl } from '@/test-utils/render-with-intl'

vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => false }))

const PEOPLE = ['Bendik Dimitri', 'Degen Florian', 'Eschbach Marysol']

/** A Mannschaft-style picker: search, three tiles, Abbrechen + «Übernehmen» (enabled once ticked). */
function Picker({ onApply }: { onApply: (names: string[]) => void }) {
  const [query, setQuery] = useState('')
  const [ticked, setTicked] = useState<string[]>([])
  return (
    <PickerDialog
      open
      onOpenChange={() => {}}
      title="Mannschaft zuweisen"
      description="Blumenweg 21"
      toolbar={<SearchInput value={query} onValueChange={setQuery} placeholder="Suchen" />}
      footer={
        <>
          <Button variant="outline">Abbrechen</Button>
          <Button disabled={ticked.length === 0} onClick={() => onApply(ticked)}>
            Übernehmen
          </Button>
        </>
      }
    >
      {PEOPLE.map((name) => (
        <PersonPickTile
          key={name}
          name={name}
          checked={ticked.includes(name)}
          onClick={() => setTicked((t) => (t.includes(name) ? t.filter((n) => n !== name) : [...t, name]))}
        />
      ))}
    </PickerDialog>
  )
}

const tile = (name: string) => screen.getByRole('button', { name: new RegExp(name) })

describe('picker keys', () => {
  it('↓ from the search goes into the tiles, ↑ on the first goes back', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Picker onApply={vi.fn()} />)
    const search = screen.getByPlaceholderText('Suchen')
    search.focus()

    await user.keyboard('{ArrowDown}')
    expect(tile(PEOPLE[0])).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(tile(PEOPLE[1])).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(search).toHaveFocus()
  })

  it('Space ticks the focused tile and types a space in the search', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Picker onApply={vi.fn()} />)
    const search = screen.getByPlaceholderText('Suchen')
    search.focus()

    await user.keyboard('Degen F')
    expect(search).toHaveValue('Degen F')

    await user.keyboard('{ArrowDown} ')
    expect(tile(PEOPLE[0])).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard(' ')
    expect(tile(PEOPLE[0])).toHaveAttribute('aria-pressed', 'false')
  })

  it('Enter is the main answer – from a tile and from the search – without ticking', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    renderWithIntl(<Picker onApply={onApply} />)
    const search = screen.getByPlaceholderText('Suchen')
    search.focus()

    await user.keyboard('{ArrowDown} {ArrowDown}{Enter}')
    expect(onApply).toHaveBeenLastCalledWith([PEOPLE[0]])
    expect(tile(PEOPLE[1])).toHaveAttribute('aria-pressed', 'false')

    search.focus()
    await user.keyboard('{Enter}')
    expect(onApply).toHaveBeenCalledTimes(2)
  })

  it('Enter does nothing while the main answer is disabled', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    renderWithIntl(<Picker onApply={onApply} />)
    screen.getByPlaceholderText('Suchen').focus()

    await user.keyboard('{ArrowDown}{Enter}')
    expect(onApply).not.toHaveBeenCalled()
    expect(tile(PEOPLE[0])).toHaveAttribute('aria-pressed', 'false')
  })
})
