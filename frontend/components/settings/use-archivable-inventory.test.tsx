import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import de from '@/messages/de.json'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { useInventoryList } from './use-archivable-inventory'

type Row = { id: string; name: string; archived_at: string | null }

const rows: Row[] = [
  { id: '1', name: 'B', archived_at: null },
  { id: '2', name: 'Z', archived_at: '2026-07-01T00:00:00Z' },
  { id: '3', name: 'A', archived_at: null },
]

const byName = (a: Row, b: Row) => a.name.localeCompare(b.name)

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Zurich">
      {children}
    </NextIntlClientProvider>
  )
}

describe('useInventoryList', () => {
  it('keeps archived rows at the bottom in either direction', async () => {
    const { result } = renderHook(
      () =>
        useInventoryList<Row, 'name'>({
          list: async () => rows,
          compare: byName,
          initialSort: 'name',
          loadError: 'x',
          logLabel: 'rows',
        }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.sorted).toHaveLength(3))
    expect(result.current.sorted.map((r) => r.name)).toEqual(['A', 'B', 'Z'])

    // Same column again flips the direction – the archived row stays last.
    act(() => result.current.sort.toggle('name'))
    expect(result.current.sort.direction).toBe('desc')
    expect(result.current.sorted.map((r) => r.name)).toEqual(['B', 'A', 'Z'])
  })
})
