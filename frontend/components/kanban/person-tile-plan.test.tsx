import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { PersonPickTile } from '@/components/kanban/assignment-list-section'
import { tilePlan } from '@/components/kanban/person-tile-facts'
import { loadMessages } from '@/lib/i18n-messages'
import { createTranslator } from 'next-intl'

/**
 * #3 mock 7A: every picker tile says «bis 22:00»; somebody who leaves within the hour is
 * amber, and – once ticked – the tile says so in an advice that never blocks.
 */
// Untyped like notification-format.test.ts's translator: tilePlan takes any `common.personPick` t.
const t = createTranslator({ locale: 'de', messages: loadMessages('de'), namespace: 'common.personPick' }) as unknown as Parameters<
  typeof tilePlan
>[2]
const now = new Date(2026, 10, 19, 19, 31).getTime()
const iso = (h: number, m = 0) => new Date(2026, 10, 19, h, m).toISOString()

describe('tilePlan', () => {
  it('«bis» without advice while there is time, the advice under 60 minutes and once past', () => {
    expect(tilePlan({ plannedUntil: iso(22) }, now, t)).toEqual({ label: 'bis 22:00', soon: false, advice: null })
    expect(tilePlan({ plannedUntil: iso(20) }, now, t)).toEqual({
      label: 'bis 20:00', soon: true, advice: "Geht um 20:00 – in 29'. Zuweisen geht trotzdem.",
    })
    expect(tilePlan({ plannedUntil: iso(19) }, now, t)?.advice).toBe('Wollte um 19:00 gehen. Zuweisen geht trotzdem.')
    expect(tilePlan({ plannedFrom: iso(20), plannedUntil: iso(23) }, now, t)?.label).toBe('ab 20:00')
    expect(tilePlan({}, now, t)).toBeNull()
  })
})

describe('PersonPickTile with a plan', () => {
  const plan = { label: 'bis 20:00', soon: true, advice: "Geht um 20:00 – in 29'. Zuweisen geht trotzdem." }

  it('names the time on the line, and the advice only once ticked – still a button that works', () => {
    const { rerender } = renderWithIntl(<PersonPickTile name="Frei Marc" rank="Wm" plan={plan} checked={false} onClick={() => {}} />)
    expect(screen.getByText('bis 20:00')).toHaveClass('text-warning-foreground')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(<PersonPickTile name="Frei Marc" rank="Wm" plan={plan} checked onClick={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('Zuweisen geht trotzdem.')
    expect(screen.getByRole('button', { name: /Frei Marc/ })).toBeEnabled()
  })
})
