'use client'

/**
 * Ask the server for «probably the same Schadenplatz» while a report is typed.
 *
 * Debounced (an address is typed, not picked), keyed on what is actually
 * compared, and silent on failure: the hint is advice, it never blocks creating
 * a card, so a lost request simply shows no hint.
 */

import { useEffect, useState } from 'react'
import { useEffectEvent } from '@/lib/hooks/use-effect-event'

import { duplicateQueryKey, type DuplicateHintCandidate, type DuplicateQuery } from '@/lib/duplicates'

const DEBOUNCE_MS = 400

export function useDuplicateCandidates<C extends DuplicateHintCandidate>(
  query: DuplicateQuery | null,
  load: (query: DuplicateQuery) => Promise<{ candidates: C[] }>,
): { candidates: C[]; key: string | null } {
  const key = duplicateQueryKey(query)
  const [result, setResult] = useState<{ key: string | null; candidates: C[] }>({
    key: null,
    candidates: [],
  })

  // `key` is the query's value, so the effect runs on it alone; the query object and `load` are
  // read as they are when the debounce fires.
  const loadCurrent = useEffectEvent(() => (query ? load(query) : null))

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const timer = setTimeout(() => {
      // Through a promise, so a loader that throws synchronously is just "no hint" too.
      Promise.resolve()
        .then(() => loadCurrent())
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
  }, [key])

  // A stale answer for a different address is no answer.
  return { candidates: key && result.key === key ? result.candidates : [], key }
}
