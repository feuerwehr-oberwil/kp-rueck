import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiFieldRequest } from '@/lib/api/types'
import { FieldRequestCardRows, FieldRequestItem } from './field-requests'

function request(overrides: Partial<ApiFieldRequest> = {}): ApiFieldRequest {
  return {
    id: 'r-1',
    incident_id: 'inc-1',
    kind: 'material',
    status: 'open',
    text: null,
    item: 'Tauchpumpe Gr.',
    quantity: 2,
    label: 'Material: Tauchpumpe Gr. ×2',
    created_at: '2026-10-08T20:00:00Z',
    created_by_name: 'Muster Hans',
    from_field: true,
    notification_id: 'n-1',
    seen_at: null,
    in_progress_at: null,
    in_progress_by_name: null,
    done_at: null,
    done_by_name: null,
    ...overrides,
  }
}

describe('FieldRequestCardRows', () => {
  it('shows what is owed as «label — status», two rows and a count', () => {
    renderWithIntl(
      <FieldRequestCardRows
        requests={[
          request(),
          request({ id: 'r-2', kind: 'personnel', item: null, quantity: 3, status: 'in_progress' }),
          request({ id: 'r-3', kind: 'message', item: null, quantity: null, text: 'Pumpe läuft' }),
        ]}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('Material: Tauchpumpe Gr. ×2')).toBeInTheDocument()
    expect(screen.getByText('— offen')).toBeInTheDocument()
    expect(screen.getByText('Verstärkung: 3 Personen')).toBeInTheDocument()
    expect(screen.getByText('— in Arbeit')).toBeInTheDocument()
    expect(screen.getByText('+1 weitere')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3 offene Anforderungen vom Feld' })).toBeInTheDocument()
  })

  it('renders nothing once everything is handled', () => {
    const { container } = renderWithIntl(
      <FieldRequestCardRows requests={[request({ status: 'done' })]} onOpen={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('FieldRequestItem', () => {
  it('«Material zuteilen» opens the assignment flow searched for the item and starts the work', async () => {
    const user = userEvent.setup()
    const onAssign = vi.fn()
    const onSetStatus = vi.fn()
    renderWithIntl(
      <ul>
        <FieldRequestItem request={request()} canEdit busy={false} onAssign={onAssign} onSetStatus={onSetStatus} />
      </ul>,
    )
    await user.click(screen.getByRole('button', { name: 'Material zuteilen' }))
    expect(onAssign).toHaveBeenCalledWith('inc-1', 'materials', 'Tauchpumpe Gr.')
    expect(onSetStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-1' }), 'in_progress')
  })

  it('offers In Arbeit and Erledigt on an open request', async () => {
    const user = userEvent.setup()
    const onSetStatus = vi.fn()
    renderWithIntl(
      <ul>
        <FieldRequestItem request={request({ kind: 'message', item: null, text: 'Pumpe läuft' })} canEdit busy={false} onSetStatus={onSetStatus} />
      </ul>,
    )
    expect(screen.queryByRole('button', { name: /zuteilen/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Erledigt' }))
    expect(onSetStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-1' }), 'done')
    await user.click(screen.getByRole('button', { name: 'In Arbeit' }))
    expect(onSetStatus).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'r-1' }), 'in_progress')
  })

  it('a handled request says who and when, and can be re-opened', () => {
    renderWithIntl(
      <ul>
        <FieldRequestItem
          request={request({ status: 'done', done_at: '2026-10-08T20:10:00Z', done_by_name: 'Eichenberger' })}
          canEdit
          busy={false}
          onSetStatus={vi.fn()}
        />
      </ul>,
    )
    expect(screen.getByText(/erledigt .* · Eichenberger/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wieder öffnen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Erledigt' })).not.toBeInTheDocument()
  })

  it('an Abholung is closed as «Abholung disponiert», never started or re-opened', () => {
    renderWithIntl(
      <ul>
        <FieldRequestItem request={request({ kind: 'pickup', item: null, quantity: null })} canEdit busy={false} onSetStatus={vi.fn()} />
      </ul>,
    )
    expect(screen.getByRole('button', { name: 'Abholung disponiert' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'In Arbeit' })).not.toBeInTheDocument()
  })

  it('a viewer reads it but gets no buttons', () => {
    renderWithIntl(
      <ul>
        <FieldRequestItem request={request({ seen_at: '2026-10-08T20:01:00Z' })} canEdit={false} busy={false} onSetStatus={vi.fn()} />
      </ul>,
    )
    expect(screen.getByText(/Muster Hans · .* · gesehen/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
