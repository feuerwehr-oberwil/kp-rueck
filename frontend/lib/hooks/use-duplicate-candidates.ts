'use client'

/**
 * Ask the server for «probably the same Schadenplatz» while a report is typed.
 *
 * Debounced (an address is typed, not picked), keyed on what is actually
 * compared, and silent on failure: the hint is advice, it never blocks creating
 * a card, so a lost request simply shows no hint.
 */

import { useEffect, useState } from 'react'

import type { ApiDuplicateCandidate, ApiDuplicateCandidatesResponse } from '@/lib/api-client'
import { duplicateQueryKey, type DuplicateQuery } from '@/lib/duplicates'

const DEBOUNCE_MS = 400

export function useDuplicateCandidates(
  query: DuplicateQuery | null,
  load: (query: DuplicateQuery) => Promise<ApiDuplicateCandidatesResponse>,
): { candidates: ApiDuplicateCandidate[]; key: string | null } {
  const key = duplicateQueryKey(query)
  const [result, setResult] = useState<{ key: string | null; candidates: ApiDuplicateCandidate[] }>({
    key: null,
    candidates: [],
  })

  useEffect(() => {
    if (!key || !query) return
    let cancelled = false
    const timer = setTimeout(() => {
      // Through a promise, so a loader that throws synchronously is just "no hint" too.
      Promise.resolve()
        .then(() => load(query))
        .then((response) => {
          if (!cancelled) setResult({ key, candidates: response?.candidates ?? [] })
        })
        .catch(() => {
          if (!cancelled) setResult({ key, candidates: [] })
        })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `query` is captured through `key`, which is its value; `load` is a stable callback per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // A stale answer for a different address is no answer.
  return { candidates: key && result.key === key ? result.candidates : [], key }
}
