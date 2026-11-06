import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { Operation } from '@/lib/contexts/operations-context'
import { ageLevel } from '@/lib/kanban-utils'

import { AGED_FROM_MINUTES, WallColumnAgeChip } from '@/components/display/wall-column-age-chip'

/**
 * The wall column's overdue mark says how many and from when, in the age
 * chip's colour for the worst one – amber from 60', red only from 120'.
 */

const MIN = 60_000

function op(id: string, minutesAgo: number): Operation {
  return {
    id,
    location: `Strasse ${id}`,
    status: 'active',
    dispatchTime: new Date(Date.now() - minutesAgo * MIN),
    statusChangedAt: null,
  } as Operation
}

describe('WallColumnAgeChip', () => {
  it('says «≥ 60\'» exactly where ageLevel turns warn', () => {
    expect(ageLevel(new Date(Date.now() - AGED_FROM_MINUTES * MIN))).toBe('warn')
    expect(ageLevel(new Date(Date.now() - (AGED_FROM_MINUTES - 1) * MIN))).toBe('normal')
  })

  it('renders nothing while every incident is under the threshold', () => {
    const { container } = renderWithIntl(<WallColumnAgeChip operations={[op('a', 59), op('b', 5)]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('counts the aged incidents in words and names them in its label', () => {
    renderWithIntl(<WallColumnAgeChip operations={[op('a', 70), op('b', 90), op('c', 10)]} />)
    const chip = screen.getByLabelText(/2 überfällig: Strasse a, Strasse b/)
    expect(chip).toHaveTextContent("2 ≥ 60'")
    expect(chip.className).toMatch(/amber/)
    expect(chip.className).not.toMatch(/red/)
  })

  it('turns red only once one of them is past 120\'', () => {
    renderWithIntl(<WallColumnAgeChip operations={[op('a', 70), op('b', 125)]} />)
    expect(screen.getByLabelText(/überfällig/).className).toMatch(/red/)
  })
})
