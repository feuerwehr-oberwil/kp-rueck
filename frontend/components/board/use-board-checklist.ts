"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { apiClient } from "@/lib/api-client"
import { summarizeChecklist } from "@/lib/checklist-tasks"
import { useChecklistFacts } from "@/lib/hooks/use-checklist-facts"
import { usePersistedState } from "@/lib/hooks/use-persisted-state"
import { isStringArray } from "@/lib/utils/safe-storage"
import type { Event } from "@/lib/types/incidents"

/** Events whose Bereitschaft checklist the operator has closed — see the auto-open effect. */
const CHECKLIST_DISMISSED_KEY = "kp-board-checklistDismissedEvents"
/** How many dismissals to keep; enough for a season of Einsätze, bounded on purpose. */
const CHECKLIST_DISMISSED_LIMIT = 30

export interface UseBoardChecklistInput {
  selectedEvent: Event | null
  isMounted: boolean
}

/**
 * The Bereitschaft checklist popover: open state, live readiness progress and the
 * once-per-Ereignis auto-open that respects a persisted dismissal. Moved verbatim
 * out of app/page.tsx.
 */
export function useBoardChecklist(input: UseBoardChecklistInput) {
  const {
    selectedEvent,
    isMounted,
  } = input

  // Checklist popover state and live readiness progress (persistent reference)
  const [checklistPopoverOpen, setChecklistPopoverOpen] = useState(false)
  // Bumped when the popover ticks or un-ticks a row: those overrides live in
  // localStorage, which no snapshot or socket event will ever report.
  const [checklistOverridesVersion, setChecklistOverridesVersion] = useState(0)
  const autoOpenedEventRef = useRef<string | null>(null)
  // What is remembered is the DISMISSAL, per event — not whether the popover
  // happened to be open. A checklist the operator closed stays closed for that
  // Einsatz across navigation and reload; a genuinely new event may still
  // auto-open once. The popover itself always starts closed, since restoring an
  // open overlay on load is not what «bleibt zu» means.
  const [dismissedChecklistEvents, setDismissedChecklistEvents] = usePersistedState<string[]>(
    CHECKLIST_DISMISSED_KEY,
    [],
    isStringArray,
  )

  const handleChecklistOpenChange = useCallback(
    (open: boolean) => {
      setChecklistPopoverOpen(open)
      if (open || !selectedEvent) return
      setDismissedChecklistEvents((previous) =>
        previous.includes(selectedEvent.id)
          ? previous
          : [...previous, selectedEvent.id].slice(-CHECKLIST_DISMISSED_LIMIT),
      )
    },
    [selectedEvent, setDismissedChecklistEvents],
  )

  // The setup checklist is an operational aid for real callouts (printer, real
  // check-in workflow, offline maps). It's noise in the public demo, so hide it
  // there entirely. Fetched once — demo mode never changes mid-session.
  const [isDemo, setIsDemo] = useState(false)
  useEffect(() => {
    apiClient.getDemoStatus().then((s) => setIsDemo(!!s?.demo)).catch(() => {})
  }, [])

  // Readiness progress for the persistent "Bereitschaft" badge, live even while
  // the popover is closed. Rare users forget the steps, not the app — keeping
  // "what still needs doing" visible at a glance, every callout. Derived from
  // the board's snapshot (see useChecklistFacts) rather than polled per badge.
  const checklistEnabled = !!selectedEvent && isMounted && !isDemo
  const checklistFacts = useChecklistFacts({ enabled: checklistEnabled })
  const checklistProgress = useMemo(() => {
    // Disabled in the demo — keep progress empty so the badge/popover never show.
    // Until the facts arrive: nothing yet, same as before the first poll landed.
    if (!checklistEnabled || !selectedEvent || !checklistFacts) return { completed: 0, total: 0 }
    return summarizeChecklist(selectedEvent.id, checklistFacts)
    // checklistOverridesVersion: the summary reads the overrides from localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklistEnabled, selectedEvent, checklistFacts, checklistOverridesVersion])

  // Auto-open the checklist once per event whenever setup is still incomplete
  // (regardless of event age), then hand off to the persistent button so it
  // never re-nags after the user has dismissed it — not this session (the ref)
  // and not on the next reload either (the persisted dismissal). The dismissal
  // list is read from localStorage on mount, well before `checklistProgress`
  // arrives from the API, so it always gets the first word.
  useEffect(() => {
    if (!selectedEvent || !isMounted) return
    if (checklistProgress.total === 0) return
    if (checklistProgress.completed >= checklistProgress.total) return
    if (autoOpenedEventRef.current === selectedEvent.id) return
    if (dismissedChecklistEvents.includes(selectedEvent.id)) return
    autoOpenedEventRef.current = selectedEvent.id
    setChecklistPopoverOpen(true)
  }, [selectedEvent, isMounted, checklistProgress, dismissedChecklistEvents])

  return {
    checklistPopoverOpen,
    setChecklistOverridesVersion,
    handleChecklistOpenChange,
    checklistProgress,
  }
}
