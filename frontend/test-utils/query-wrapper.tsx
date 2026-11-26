import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeQueryClient } from '@/lib/query/client'

/**
 * A wrapper with a fresh query cache, for `renderHook(() => useX(), { wrapper: queryWrapper() })`
 * on a hook that reads through lib/query. `renderWithIntl` brings its own.
 */
export function queryWrapper() {
  const client = makeQueryClient()
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}
