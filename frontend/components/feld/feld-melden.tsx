'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'

import { FeldMeldenSheet } from '@/components/feld/feld-melden-sheet'
import { Button } from '@/components/ui/button'
import type { ApiFeldAssignment, ApiFeldOwnReport } from '@/lib/api-client'

/** Reporting a Schadenplatz is for whoever is standing in front of one. The
 *  Magazin and the Kommandoposten are at the station — the KP types theirs on
 *  the board. The Telefondienst is at the station too and keeps it, because
 *  their form writes down somebody *else's* report. */
const atTheStation = (roles: readonly string[]) =>
  !roles.includes('telefondienst') &&
  (roles.includes('magazin') || roles.includes('kommandoposten'))

/**
 * «＋ Neuer Schadenplatz» — the crew reporting something they are standing in front of.
 *
 * The ink square on the right of the header (owner pick 1A, 14.11.2026), on
 * the list and on the detail alike. The person who spots the next tree is the
 * one already four taps deep at a Schadenplatz, and having to find the way
 * back to the list first is how a Meldung turns into a radio call — or into
 * nothing. In the header it is one tap from every screen and sits on nothing:
 * the in-flow outline button it replaces had to be scrolled to, and the
 * floating one before that covered «danach: Rapport …». Only one of the two
 * views is mounted at a time, so this stays a single sheet with a single piece
 * of state; the sheet closing when the crew leaves the detail is wanted.
 *
 * The Telefondienst's form writes down somebody else's report, so their
 * square says «Anruf erfassen».
 *
 * The page puts `button` in the identity bar's trailing slot, `sheet` on the list and on the
 * detail, `correctionSheet` on the list, and hands `editReport` to «Was ich gemeldet habe».
 * `reload` refetches the list after a Meldung; `onCorrected` folds a correction into it.
 */
export function useFeldMelden({
  token,
  personnelId,
  functions,
  assignments,
  reload,
  onCorrected,
}: {
  token: string | null
  personnelId: string | undefined
  functions: readonly string[]
  assignments: readonly ApiFeldAssignment[]
  reload: (personnelId: string) => void
  onCorrected: (report: ApiFeldOwnReport) => void
}) {
  const t = useTranslations('feld')
  const [meldenOpen, setMeldenOpen] = useState(false)
  /** The Meldung being corrected, if any. */
  const [editingReport, setEditingReport] = useState<ApiFeldOwnReport | null>(null)

  const showMelden = !!token && !!personnelId && !atTheStation(functions)
  const meldenLabel = functions.includes('telefondienst') ? t('melden.fabPhone') : t('melden.fab')
  const meldenButton = showMelden ? (
    <Button
      size="icon"
      className="shrink-0"
      aria-label={meldenLabel}
      title={meldenLabel}
      onClick={() => setMeldenOpen(true)}
    >
      <Plus className="size-5" />
    </Button>
  ) : null
  const meldenSheet =
    showMelden && token && personnelId ? (
      <FeldMeldenSheet
        open={meldenOpen}
        onOpenChange={setMeldenOpen}
        personnelId={personnelId}
        token={token}
        isPhoneDesk={functions.includes('telefondienst')}
        // A Reko trupp cannot "take it on": they were sent to look and
        // report back. The escape hatch is crew work the reko fallback
        // cannot swallow — a squad assigned to an Auftrag holds no personnel
        // row on any stop, so those rows really do come back as `crew`
        // (`visibility.py`, the route block). A reko holder given ordinary
        // per-incident crew rows reads as reko throughout the Ereignis, and
        // that collapse is deliberate and documented there.
        canTakeOver={!functions.includes('reko') || assignments.some(item => item.source === 'crew')}
        onReported={() => reload(personnelId)}
      />
    ) : null

  // The correction sheet — the same form, prefilled. Keyed by incident so
  // opening a second Meldung remounts it rather than showing the first
  // one's text. Mounted only while one is being corrected, which is what
  // keeps the create sheet's own state untouched.
  const correctionSheet = editingReport && token && personnelId ? (
    <FeldMeldenSheet
      key={editingReport.incident_id}
      open
      onOpenChange={open => !open && setEditingReport(null)}
      personnelId={personnelId}
      token={token}
      isPhoneDesk={functions.includes('telefondienst')}
      editing={editingReport}
      onReported={corrected => {
        // Fold it back locally so the row changes under the thumb, and
        // refetch for the board's side of the story (it may have been
        // disponiert in the meantime).
        onCorrected(corrected)
        setEditingReport(null)
        reload(personnelId)
      }}
    />
  ) : null

  return { button: meldenButton, sheet: meldenSheet, correctionSheet, editReport: setEditingReport }
}
