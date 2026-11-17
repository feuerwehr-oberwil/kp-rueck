import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import {
  FormMessage,
  fieldMessageProps,
  focusFirstBlockingField,
  formMessageId,
  useRequiredField,
} from '@/components/ui/form-message'
import { Input } from '@/components/ui/input'

/**
 * The message under a field (#21). Red blocks and is an alert; amber advises
 * and is polite. The field has to be TIED to it — a screen reader that
 * announces «ungültig» and never the reason is the gap this closes.
 */
function Field({ tone }: { tone: 'error' | 'advice' | null }) {
  return (
    <div>
      <label htmlFor="phone">Telefonnummer</label>
      <Input id="phone" {...fieldMessageProps('phone', tone)} />
      {tone && (
        <FormMessage id={formMessageId('phone')} tone={tone}>
          {tone === 'error' ? 'Nummer fehlt.' : 'Nummer hat nur 8 Ziffern – bitte prüfen.'}
        </FormMessage>
      )}
    </div>
  )
}

describe('FormMessage', () => {
  it('an error is an alert, the field is invalid and described by it', () => {
    render(<Field tone="error" />)
    const field = screen.getByLabelText('Telefonnummer')
    const message = screen.getByRole('alert')

    expect(message.textContent).toBe('Nummer fehlt.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAttribute('aria-describedby', message.id)
    expect(field).toHaveAccessibleDescription('Nummer fehlt.')
  })

  it('advice is a polite status, the field is described but NOT invalid', () => {
    render(<Field tone="advice" />)
    const field = screen.getByLabelText('Telefonnummer')
    const message = screen.getByRole('status')

    expect(message).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(field).not.toHaveAttribute('aria-invalid')
    expect(field).toHaveAccessibleDescription('Nummer hat nur 8 Ziffern – bitte prüfen.')
  })

  it('nothing to say, nothing wired', () => {
    render(<Field tone={null} />)
    const field = screen.getByLabelText('Telefonnummer')
    expect(field).not.toHaveAttribute('aria-describedby')
    expect(field).not.toHaveAttribute('aria-invalid')
  })

  it('renders nothing for an empty message', () => {
    const { container } = render(<FormMessage id="x">{''}</FormMessage>)
    expect(container.firstChild).toBeNull()
  })

  it('focusFirstBlockingField skips what is not there and focuses the first that is', () => {
    render(
      <>
        <input id="a" aria-label="a" />
        <input id="b" aria-label="b" />
      </>,
    )
    focusFirstBlockingField([null, 'missing', 'b', 'a'])
    expect(screen.getByLabelText('b')).toHaveFocus()
  })
})

/** A submit that stays live: an empty name is said under the field, not by a grey button. */
function NameForm({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState('')
  const field = useRequiredField('group-name', name, 'Name fehlt.')
  return (
    <>
      <label htmlFor="group-name">Name</label>
      <input {...field.controlProps} value={name} onChange={(e) => setName(e.target.value)} />
      <FormMessage id={formMessageId('group-name')}>{field.error}</FormMessage>
      <button type="button" onClick={() => field.check() && onSubmit(name)}>
        Speichern
      </button>
    </>
  )
}

describe('useRequiredField', () => {
  it('says what is missing under the field, puts the cursor there, and clears once typed', async () => {
    const user = userEvent.setup()
    const submitted: string[] = []
    render(<NameForm onSubmit={(name) => submitted.push(name)} />)
    const field = screen.getByLabelText('Name')
    expect(screen.queryByRole('alert')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(submitted).toEqual([])
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Name fehlt.')

    await user.type(field, 'Pumpen')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(submitted).toEqual(['Pumpen'])
  })
})
