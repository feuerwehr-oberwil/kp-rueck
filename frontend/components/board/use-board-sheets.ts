"use client"

import { useCallback, useEffect, useState } from "react"
import { onAppEvent } from "@/lib/app-events"
import type { FooterSheet } from "@/components/board/board-footer"
import type { JournalComposeRequest } from "@/components/journal/journal-sheet"

/** The board's footer-sheet state – see `useBoardSheets`. */
export type BoardSheets = ReturnType<typeof useBoardSheets>

/**
 * Which footer sheet the board has open (one at a time), the Auftrag the Aufträge
 * sheet opens on, and the journal's compose request. The board page calls it once
 * and hands it to the hooks that open sheets.
 */
export function useBoardSheets() {
  // Single state for footer sheets - only one can be open at a time
  // `'print'` is the one print/export sheet: thermal slip, A4 status print and
  // per-event file export live in it together (`PrintHubSheet`).
  const [activeFooterSheet, setActiveFooterSheet] = useState<FooterSheet | null>(null)
  // «Eintrag in den Verlauf schreiben» (E): the journal opens with the caret in its line,
  // linked to the selected card. A fresh `at` per request.
  const [journalCompose, setJournalCompose] = useState<JournalComposeRequest | null>(null)
  const writeJournal = useCallback((incidentId: string | null) => {
    setActiveFooterSheet('journal')
    setJournalCompose({ incidentId, at: Date.now() })
  }, [])
  // When the Aufträge sheet is opened from a board chip, expand/scroll to this group.
  const [auftraegeFocusGroupId, setAuftraegeFocusGroupId] = useState<string | null>(null)

  // Board Auftrag chips signal the page via a window event (no prop threading
  // through the column/side-panel trees) to open the Aufträge sheet on that route.
  useEffect(
    () =>
      onAppEvent('kp:open-auftraege', ({ groupId }) => {
        setAuftraegeFocusGroupId(groupId)
        setActiveFooterSheet('auftraege')
      }),
    [],
  )

  return {
    activeFooterSheet,
    setActiveFooterSheet,
    journalCompose,
    writeJournal,
    auftraegeFocusGroupId,
    setAuftraegeFocusGroupId,
  }
}
