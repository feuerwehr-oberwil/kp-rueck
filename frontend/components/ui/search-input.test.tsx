import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithIntl } from '@/test-utils/render-with-intl'

import { SearchInput } from '@/components/ui/search-input'

/** The one search field (#6): «Suche leeren», focus kept, touch floors, count. */
function Controlled({ count, onChange }: { count?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <SearchInput
      placeholder="Person suchen …"
      value={value}
      onValueChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
      count={count}
    />
  )
}

describe('SearchInput', () => {
  it('shows a ✕ named «Suche leeren» only while there is something to clear', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Controlled />)

    expect(screen.queryByRole('button', { name: 'Suche leeren' })).toBeNull()
    await user.type(screen.getByPlaceholderText('Person suchen …'), 'xyz')
    expect(screen.getByRole('button', { name: 'Suche leeren' })).toBeDefined()
  })

  it('the ✕ empties the field and keeps the cursor in it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithIntl(<Controlled onChange={onChange} />)
    const field = screen.getByPlaceholderText('Person suchen …')

    await user.type(field, 'xyz')
    await user.click(screen.getByRole('button', { name: 'Suche leeren' }))

    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(screen.queryByRole('button', { name: 'Suche leeren' })).toBeNull()
  })

  it('is at least 44px with 16px text on a phone or under a finger, whatever the caller sets', () => {
    renderWithIntl(<SearchInput size="sm" className="h-8 text-sm" value="" onValueChange={() => {}} placeholder="s" />)
    const cls = screen.getByPlaceholderText('s').className
    for (const floor of ['max-md:min-h-11', 'max-md:text-base', 'pointer-coarse:min-h-11', 'pointer-coarse:text-base']) {
      expect(cls).toContain(floor)
    }
  })

  it('announces an optional hit count politely', () => {
    renderWithIntl(<Controlled count="3 Treffer" />)
    const count = screen.getByText('3 Treffer')
    expect(count).toHaveAttribute('aria-live', 'polite')
  })
})
