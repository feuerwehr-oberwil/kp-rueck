'use client'

/**
 * The Schadenplatz-Rapport form (plan 25, §5.3) — **one component, two mounts**.
 *
 * `/feld` renders it for a crew with a token and a personnel id; the board's
 * incident detail renders the *same* component with a different transport and a
 * different identity (decision 28, §6.1). Not a second form: divergence here is
 * exactly how the KP path silently loses a field six months later, and KP parity
 * is the acceptance criterion for this phase, not a convenience.
 *
 * Draft handling is copied from `components/reko/reko-form.tsx`, including the
 * `isSubmittingRef` guard and its reasoning — that ref exists because the
 * autosave interval captures a stale closure and a late draft-save un-submits
 * the report. Do not re-derive that bug.
 *
 * There is no offline queue (decision 11): localStorage plus a 30 s autosave
 * survives a closed tab and a dead network *while typing*, but not a dead server
 * *at submit*. For that day the blank `fahrzeugrapport.pdf` stays in the folder
 * as the Ausfall-Variante.
 *
 * **The two mounts save differently, and only there (§18.17).** `/feld` keeps an
 * explicit *Rapport abschliessen*: a crew on a phone needs a definite "I am
 * done" moment, and that is where the draft-vs-filed distinction earns its keep.
 * The KP has no submit button at all — the board autosaves everything else, and
 * a modal that makes an operator press Save is out of place on it. A KP save
 * therefore always writes `is_draft: false`: **a KP rapport is filed from its
 * first saved keystroke.** Two guards keep that honest — it saves only when the
 * form actually changed, and only once it has content — so opening a detail
 * never creates an empty rapport and never stamps a KP editor onto a crew's.
 * Because no KP save ever carries `is_draft: true`, no late KP autosave can
 * un-submit anything, which is the bug `isSubmittingRef` exists for.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, Copy, Loader2, Phone, RotateCcw, Send, UserRound } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FeldMaterialChecklist } from '@/components/feld/feld-material-checklist'
import { FeldPersonnelChecklist } from '@/components/feld/feld-personnel-checklist'
import { FeldSection, type FeldSectionState } from '@/components/feld/feld-section'
import { FeldVehicleChecklist } from '@/components/feld/feld-vehicle-checklist'
import PhotoUpload, { type PhotoTransport } from '@/components/reko/photo-upload'
import type {
  ApiRapportExtraPersonnel,
  ApiRapportMaterialRow,
  ApiRapportPersonnelRow,
  ApiRapportVehicleRow,
  ApiSchadenplatzRapport,
  ApiRapportUpdate,
} from '@/lib/api/types'
import { getActiveLocale } from '@/lib/i18n-messages'
import { telHref } from '@/lib/phone'
import { sanitizePhoneInput } from '@/lib/utils'
import {
  derivePersonnelCount,
  EMPTY_RAPPORT_FORM,
  hasContent,
  isCorrected,
  mergeDraft,
  toFormData,
  toUpdate,
  type RapportFormData,
} from '@/lib/rapport-draft'

/**
 * The only thing that differs between the two mounts.
 *
 * Passed in rather than branched on inside, so the form itself has no idea
 * whether it is on a phone in the rain or in the KP — and cannot grow a
 * "if (isKp)" that only one side ever tests.
 */
export interface RapportTransport {
  load: () => Promise<ApiSchadenplatzRapport>
  save: (update: ApiRapportUpdate) => Promise<ApiSchadenplatzRapport>
  /**
   * Photos, if this mount has a door for them (§6.1). The crew photographs the
   * cellar; the KP attaches the photo that arrived by WhatsApp — same storage,
   * different door, and the form knows about neither.
   *
   * Photos are NOT part of the autosaved draft: they are stored server-side the
   * moment they are taken, so a lost tab loses the typing, never the pictures.
   */
  photos?: PhotoTransport
}

interface FeldRapportFormProps {
  incidentId: string
  transport: RapportTransport
  /** Copy only — never behaviour. */
  mount?: 'feld' | 'kp'
  disabled?: boolean
  onSaved?: (rapport: ApiSchadenplatzRapport) => void
  /** Put the cursor in the Kurzbericht as soon as the form mounts. Set when the
   *  operator was SENT here to write it — from the Offene-Rapporte backlog or a
   *  notification — so the one field a rapport really wants filled is ready to
   *  type into. Never set when the detail was merely opened on this tab by hand;
   *  stealing focus from somebody who is reading is its own bug. */
  autoFocusKurzbericht?: boolean
}

const AUTOSAVE_MS = 30000
/**
 * How long "X bearbeitet diesen Rapport gerade" stays true after X's last
 * save. Mirrors ``CONCURRENT_EDITOR_WINDOW`` in `crud/feld/rapport.py`: the
 * server scopes the flag to this window on every response, but the form loads
 * once — without a client-side clock the banner outlived its window for as
 * long as the detail stayed open, naming an editor who had long stopped.
 */
export const CONCURRENT_EDITOR_TTL_MS = 5 * 60 * 1000
/**
 * The KP's own beat. The 30 s interval is a phone's compromise — a modal an
 * operator closes after dictating two sentences must not lose them, so the KP
 * mount also saves shortly after the typing stops (and once more on close).
 */
const KP_DEBOUNCE_MS = 2000

function localStorageKey(incidentId: string): string {
  return `feld-rapport-${incidentId}`
}

/**
 * One block of the rapport — folded on the phone, plainly open in the KP.
 *
 * Module level on purpose: declared inside the form it would be a new component
 * type on every render, and React would remount the whole block — which on a
 * form means the input being typed into loses focus mid-word.
 */
function RapportSection({
  collapsible,
  dense = false,
  title,
  summary,
  state,
  children,
}: {
  collapsible: boolean
  /** Desktop scale — see FeldSection. */
  dense?: boolean
  title: string
  summary: string
  state: FeldSectionState
  children: React.ReactNode
}) {
  if (!collapsible) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {children}
      </section>
    )
  }
  return (
    <FeldSection title={title} summary={summary} state={state} dense={dense}>
      {children}
    </FeldSection>
  )
}

function formatDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(getActiveLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function FeldRapportForm({ incidentId, transport, mount = 'feld', disabled, onSaved, autoFocusKurzbericht }: FeldRapportFormProps) {
  const t = useTranslations('feld.rapport')
  const isKp = mount === 'kp'

  const [rapport, setRapport] = useState<ApiSchadenplatzRapport | null>(null)
  const [formData, setFormData] = useState<RapportFormData>(EMPTY_RAPPORT_FORM)
  // Deliberately its own state, seeded once from the load and never re-seeded
  // from a save response: a photo is stored the moment it is taken, so the
  // upload's own answer is the newer truth and an autosave that started before
  // it must not roll the list back.
  const [photos, setPhotos] = useState<string[]>([])
  const [localStorageLoaded, setLocalStorageLoaded] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  // A ref, not state: the interval, the debounce and the unmount flush can all
  // fire within the same tick, and only a synchronous flag keeps two saves of
  // the same form off the wire.
  const isSavingRef = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Ref mirror of the submission state: the auto-save interval captures stale
  // closures, so it must check this ref (set synchronously on submit) instead
  // of the isSubmitting state. Once a submit succeeds it stays true forever so
  // no late draft-save can un-submit the report.
  const isSubmittingRef = useRef(false)
  // What the server last confirmed, serialised. Every save compares against it,
  // so an open modal that nobody typed in writes nothing at all — otherwise the
  // KP mount would stamp "zuletzt bearbeitet im KP durch X" on a crew's rapport
  // for the crime of being looked at, and the 30 s interval would create an
  // empty row for every incident anybody opened.
  const savedRef = useRef<string | null>(null)
  // The interval, the debounce and the unmount flush all read the CURRENT form,
  // never the one their closure was born with.
  const formRef = useRef<RapportFormData>(EMPTY_RAPPORT_FORM)
  formRef.current = formData
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [loadError, setLoadError] = useState(false)
  // Whether the form has moved on since the server last confirmed it. A filed
  // rapport is amendable (decision 3: one report per Schadenplatz, amendable),
  // and on `/feld` that used to mean a "Rapport ergänzen" button — which unlocked
  // nothing, because the fields were never locked in the first place. It read as
  // a dead tap, and worse: a crew that simply typed into a filed rapport had no
  // way of knowing the change was going nowhere. The edit itself is now the
  // signal, and the only button left is the one that sends it.
  const [dirty, setDirty] = useState(false)
  // Concurrency guard for the submit button. Separate from `isSubmittingRef`,
  // which stays true for the rest of the mount once a report is filed (so no
  // late draft-save can un-submit it) and therefore cannot say "a request is in
  // flight right now".
  const inFlightRef = useRef(false)

  // The concurrent-editor banner expires on its own (§P2.8): a timer clears it
  // the moment the server's window would — every save response re-seeds it,
  // because saves come back through `get_rapport` with the flag re-evaluated.
  const concurrentAt = rapport?.concurrent_editor?.at ?? null
  const [concurrentExpired, setConcurrentExpired] = useState(false)
  useEffect(() => {
    setConcurrentExpired(false)
    if (!concurrentAt) return
    const remaining = CONCURRENT_EDITOR_TTL_MS - (Date.now() - new Date(concurrentAt).getTime())
    if (remaining <= 0) {
      setConcurrentExpired(true)
      return
    }
    const timer = setTimeout(() => setConcurrentExpired(true), remaining)
    return () => clearTimeout(timer)
  }, [concurrentAt])

  const key = localStorageKey(incidentId)

  const saveToLocalStorage = useCallback(
    (data: RapportFormData) => {
      try {
        localStorage.setItem(key, JSON.stringify({ data, timestamp: new Date().toISOString() }))
      } catch (error) {
        console.error('Failed to save rapport draft locally:', error)
      }
    },
    [key],
  )

  const loadFromLocalStorage = useCallback((): { data: RapportFormData; timestamp: string | null } | null => {
    try {
      const stored = localStorage.getItem(key)
      if (!stored) return null
      const parsed = JSON.parse(stored)
      return { data: parsed.data as RapportFormData, timestamp: (parsed.timestamp as string | undefined) ?? null }
    } catch (error) {
      console.error('Failed to read rapport draft:', error)
      return null
    }
  }, [key])

  const clearLocalStorage = useCallback(() => {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error('Failed to clear rapport draft:', error)
    }
  }, [key])

  // ------------------------------------------------------------------ load
  const cancelledRef = useRef(false)
  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError(false)
    try {
      const data = await transport.load()
      if (cancelledRef.current) return
      // A local draft is untrusted input: it can have been written weeks ago by
      // a version of this form with different fields. A merge that throws must
      // cost the typing, never turn "there is no rapport yet" into "Rapport
      // konnte nicht geladen werden" — an absent rapport is the normal state.
      let merged: { form: RapportFormData; usedLocal: boolean }
      try {
        merged = mergeDraft(data, loadFromLocalStorage())
      } catch (error) {
        console.error('Discarding an unreadable local rapport draft:', error)
        clearLocalStorage()
        merged = { form: toFormData(data), usedLocal: false }
      }
      setRapport(data)
      setFormData(merged.form)
      savedRef.current = JSON.stringify(merged.form)
      setPhotos(data.photos ?? [])
      if (merged.usedLocal) toast.info(t('localRestored'))
      setLocalStorageLoaded(true)
    } catch (error) {
      console.error('Failed to load rapport:', error)
      if (!cancelledRef.current) setLoadError(true)
    } finally {
      if (!cancelledRef.current) setIsLoading(false)
    }
    // The transport identity changes on every render of the parent; the
    // incident is what actually decides which rapport this is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId])

  useEffect(() => {
    cancelledRef.current = false
    load()
    return () => {
      cancelledRef.current = true
    }
  }, [load])

  // Persist on every change, so a closed tab or a dead network loses nothing.
  useEffect(() => {
    if (!localStorageLoaded || isLoading) return
    saveToLocalStorage(formData)
  }, [formData, localStorageLoaded, isLoading, saveToLocalStorage])

  // "Is there anything the KP has not got yet?" — compared against the same
  // snapshot the auto-save compares against, so the button and the writer can
  // never disagree about whether something changed. `lastSaved` and `rapport`
  // are in the deps because a successful save moves that snapshot.
  useEffect(() => {
    setDirty(savedRef.current !== null && JSON.stringify(formData) !== savedRef.current)
  }, [formData, lastSaved, rapport])

  /**
   * The one write path for everything that is not the `/feld` submit.
   *
   * On `/feld` it is the 30 s draft-save it always was. On the KP mount it is
   * the *whole* save story and it files (`is_draft: false`) — see the module
   * docstring. Two guards, both load-bearing on the KP side: nothing is written
   * unless the form differs from what the server last confirmed, and nothing is
   * written until the form has content.
   */
  const autoSave = useCallback(async () => {
    // Check the ref (not isSubmitting state): stale interval closures would
    // otherwise fire a draft-save mid-/post-submit and un-submit the report.
    if (isSavingRef.current || isSubmittingRef.current || isLoading || disabled) return
    const data = formRef.current
    const serialised = JSON.stringify(data)
    if (serialised === savedRef.current) return
    if (isKp && !hasContent(data)) return
    isSavingRef.current = true
    try {
      const saved = await transport.save(toUpdate(data, !isKp))
      savedRef.current = serialised
      setRapport(saved)
      setLastSaved(new Date())
      onSaved?.(saved)
    } catch (error) {
      // Background save: no toast. The crew is typing, not watching.
      console.error('Rapport auto-save failed:', error)
    } finally {
      isSavingRef.current = false
    }
  }, [isLoading, disabled, isKp, transport, onSaved])

  // Same reason as `formRef`: the unmount flush must call the newest version.
  const autoSaveRef = useRef(autoSave)
  autoSaveRef.current = autoSave

  useEffect(() => {
    if (isLoading || isSubmitting || disabled) return
    const interval = setInterval(() => {
      void autoSaveRef.current()
    }, AUTOSAVE_MS)
    return () => clearInterval(interval)
  }, [isLoading, isSubmitting, disabled])

  // The KP's short debounce: an operator dictating from the radio gets the
  // sentence onto the shared board seconds after typing it, not half a minute.
  useEffect(() => {
    if (!isKp || isLoading || disabled) return
    const timer = setTimeout(() => {
      void autoSaveRef.current()
    }, KP_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [formData, isKp, isLoading, disabled])

  // …and once more when the detail closes, so the last two words are not lost
  // to a modal somebody dismissed straight after typing them.
  useEffect(() => {
    if (!isKp) return
    return () => {
      void autoSaveRef.current()
    }
  }, [isKp])

  const update = <K extends keyof RapportFormData>(field: K, value: RapportFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  /** Is the "…are you sure, these are empty" question on screen? */
  const [confirmGaps, setConfirmGaps] = useState(false)

  /** Files the rapport — and files it again for every later correction. */
  const handleSubmit = async () => {
    if (inFlightRef.current || disabled) return

    // No required field and no blocking gate (decision 10): a gate during a
    // storm is a gate people defeat with empty forms. The Restliste is what
    // surfaces a thin rapport, not a dialog in the rain.
    inFlightRef.current = true
    isSubmittingRef.current = true
    setIsSubmitting(true)
    try {
      const saved = await transport.save(toUpdate(formData, false))
      const next = toFormData(saved)
      setRapport(saved)
      setFormData(next)
      // Without this the form would still read as changed the moment it came
      // back, and the "Änderungen senden" button would never go away.
      savedRef.current = JSON.stringify(next)
      setDirty(false)
      clearLocalStorage()
      toast.success(t('submitted'))
      onSaved?.(saved)
      // Intentionally keep isSubmittingRef true on success so no late auto-save
      // can un-submit what was just filed (`/feld` saves drafts, `is_draft: true`).
    } catch (error) {
      console.error('Rapport submit failed:', error)
      toast.error(t('submitError'))
      isSubmittingRef.current = false
    } finally {
      inFlightRef.current = false
      setIsSubmitting(false)
    }
  }

  /**
   * "Melder übernehmen" — one tap that PREFILLS name and phone (§18.31).
   *
   * It fills each of the two fields **only when that field is still empty**:
   * the crew's own words about who owns the place beat a name the dispatcher
   * took down, and a crew that typed the owner's number but not their name must
   * keep the number. Melder and Eigentümer are frequently different people,
   * which is why this copies and never equates.
   */
  const takeOverMelder = () => {
    const prefill = rapport?.prefill
    if (!prefill) return
    setFormData(prev => ({
      ...prev,
      owner_name: prev.owner_name.trim() ? prev.owner_name : (prefill.melder_name ?? '').trim(),
      owner_phone: prev.owner_phone.trim() ? prev.owner_phone : (prefill.melder_phone ?? '').trim(),
    }))
  }

  const boardPersonnel = rapport?.prefill.board_personnel_count ?? 0

  const provenanceLines = useMemo(() => {
    if (!rapport) return []
    const lines: string[] = []
    if (rapport.created_by_name) {
      lines.push(
        t(rapport.created_in_kp ? 'createdInKp' : 'createdInField', {
          name: rapport.created_by_name,
          at: formatDateTime(rapport.submitted_at ?? rapport.updated_at),
        }),
      )
    }
    if (rapport.updated_by_name && rapport.updated_by_name !== rapport.created_by_name) {
      lines.push(
        t(rapport.updated_in_kp ? 'updatedInKp' : 'updatedInField', {
          name: rapport.updated_by_name,
          at: formatDateTime(rapport.updated_at),
        }),
      )
    }
    return lines
  }, [rapport, t])

  // Focus the Kurzbericht once, after the form has actually rendered it. The
  // rapport loads async and this component returns early while it does, so the
  // effect has to live ABOVE that return and wait on `isLoading` rather than
  // firing on mount. The one-shot ref also means a later autosave re-render
  // cannot yank the cursor back out of whatever field the operator moved on to.
  const kurzberichtRef = useRef<HTMLTextAreaElement>(null)
  const didAutoFocus = useRef(false)
  useEffect(() => {
    if (!autoFocusKurzbericht || disabled || isLoading || didAutoFocus.current) return
    didAutoFocus.current = true
    const field = kurzberichtRef.current
    if (!field) return
    field.focus()
    // …with the caret AFTER what is already written. A textarea whose value was
    // set programmatically focuses at offset 0, so an operator taking a
    // correction over the radio started typing into the middle of the sentence
    // the crew had filed. `setSelectionRange` is also what collapses the
    // select-all some browsers do on focus.
    const end = field.value.length
    field.setSelectionRange(end, end)
  }, [autoFocusKurzbericht, disabled, isLoading])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // A load that failed, and nothing else. "Es gibt noch keinen Rapport" is the
  // normal state of almost every Schadenplatz and is NOT this (§18.16) — the
  // GET computes a prefilled, non-existent rapport and writes nothing, so an
  // error here really does mean the request did not come back.
  if (loadError || !rapport) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{t('loadError')}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => load()}>
          <RotateCcw className="size-3.5" />
          {t('loadRetry')}
        </Button>
      </div>
    )
  }

  const submitted = !rapport.is_draft
  const readOnly = Boolean(disabled)

  // Folded blocks on the phone (§ the /feld length problem: 4.1 screens with
  // everything open).
  const collapsible = !isKp

  // The KP mount folds too now — but only the LISTS. Inside the incident detail
  // this form is one of four things in a tab, in a column of ~500px, and «kein
  // Rapport» still produced a Materialliste, a Mannschaftsliste, a
  // Fahrzeugliste, a photo block and an Eigentümer block to scroll past. Folded,
  // each states what is in it, which answers «habe ich das schon ausgefüllt?»
  // without opening anything.
  //
  // Kurzbericht stays open on both mounts: it is the one block a rapport really
  // wants filled, and on the KP side it is what somebody dictating over the
  // radio types into first.
  const foldLists = true



  // What each closed block says about itself. A fold that hides the answer to
  // "habe ich das schon ausgefüllt?" would just move the scrolling into taps.
  const materialCount =
    formData.materials.filter(row => row.used || row.left_on_site).length + formData.extra_materials.length
  const peopleCount = derivePersonnelCount(formData)
  const vehicleCount = formData.vehicles.filter(row => row.present).length
  const ownerSummary = formData.owner_name.trim() || formData.owner_phone.trim()
  const kurzberichtSummary = formData.kurzbericht.trim()

  // What the KP mount is FOR, and what it is not.
  //
  // The board already holds the Meldung, the Kontakt/Melder and their number on
  // Übersicht — one tab away. Asking for Eigentümer-/Halterdaten and «übergeben
  // an» a second time inside the rapport is asking an operator to retype what
  // the same modal shows above, and it is the block that made this form a page.
  // What the KP genuinely does here is confirm what went out and came back —
  // Mannschaft, Fahrzeuge, Material — add photos that arrived over WhatsApp,
  // and write the Kurzbericht.
  //
  // A block the crew ALREADY filled stays visible either way: hiding somebody
  // else's answer is worse than showing a field nobody needs.
  const showOwnerBlock = !isKp || ownerSummary.length > 0
  const showHandover = !isKp || Boolean(formData.handed_over_to.trim())

  /**
   * The sections that are still empty when «Rapport abschliessen» is tapped.
   *
   * Not a gate — decision 10 stands, and a blocking form during a storm is a
   * form people defeat with empty boxes. This is the one question in between:
   * the tap is irreversible in the operator's eyes (the board goes green, the
   * Restliste stops asking), and a rapport filed with four empty blocks is
   * almost always a fat finger rather than a decision.
   *
   * Eigentümerdaten only count where the block is actually on screen: the KP
   * mount hides it when nobody filled it, and asking about a field somebody
   * cannot see is worse than not asking.
   */
  const emptySections = [
    !kurzberichtSummary ? t('sections.kurzbericht') : null,
    peopleCount === 0 ? t('sections.confirm') : null,
    materialCount === 0 ? t('material.title') : null,
    showOwnerBlock && !ownerSummary ? t('sections.owner') : null,
  ].filter((section): section is string => section !== null)

  return (
    <div className="space-y-3">
      {/* No «Noch kein Rapport» line here any more (§18.16 revisited).
          The KP mount is never rendered bare: the section directly above it
          states the very same thing in its own header — «kein Rapport» /
          «erfasst» / «nicht disponiert» — and two lines saying it, one of them a
          dashed box, made an empty rapport look like a failure to load rather
          than the normal state of most Schadenplätze during a storm.

          What §18.16 was actually protecting is untouched: a genuine load
          failure still shows its error and its retry, on BOTH mounts, which is
          what tells «nothing filed» apart from «not loaded». */}

      {/* Visibility, not a lock (§3): two crews on one Schadenplatz overwriting
          each other's Kurzbericht is an accepted cost, and a real lock in the
          field is worse than the problem it solves. Expires with the window —
          see CONCURRENT_EDITOR_TTL_MS. */}
      {rapport.concurrent_editor && !concurrentExpired && (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('concurrentEditor', {
              name: rapport.concurrent_editor.name,
              at: formatDateTime(rapport.concurrent_editor.at),
            })}
          </span>
        </div>
      )}

      {/* No "Einsatzdaten" block (§18.20). Beginn und Ende Tätigkeit were two
          time inputs and are now derived for the outputs: the column the card
          sits in, the Angekommen- and Beendet-Meldungen and the status
          transitions already say when the work ran. Asking a crew in the rain
          to retype what the board watched happen only costs time.

          No address and no EL block either. Both mounts already state them in
          their own header — the modal's title line, and the /feld detail's
          header section with its LeaderLine — and a read-only copy of what is
          two centimetres above it is a form field that asks to be read and then
          answers nothing. */}

      {/* ------------------------------------------------- Kurzbericht */}
      <RapportSection
        collapsible={collapsible}
        title={t('sections.kurzbericht')}
        summary={kurzberichtSummary || t('summary.kurzberichtEmpty')}
        // The one block a rapport really wants filled.
        state={kurzberichtSummary ? 'filled' : 'todo'}
      >
        {/* No dictation tip under the box. Every phone keyboard has had a
            microphone key for a decade; the people who use it already do, and
            the ones who do not are not reading a caption in the rain. */}
        <Textarea
          ref={kurzberichtRef}
          value={formData.kurzbericht}
          disabled={readOnly}
          rows={isKp ? 3 : 5}
          placeholder={t('kurzberichtPlaceholder')}
          onChange={e => update('kurzbericht', e.target.value)}
        />
        {showHandover && (
          <div className="space-y-1.5">
            <Label htmlFor="rapport-handover" className="text-xs text-muted-foreground">
              {t('handedOverTo')}
            </Label>
            <Input
              id="rapport-handover"
              value={formData.handed_over_to}
              disabled={readOnly}
              placeholder={t('handedOverToPlaceholder')}
              onChange={e => update('handed_over_to', e.target.value)}
            />
          </div>
        )}
      </RapportSection>

      {/* --------------------------------------- Mannschaft und Fahrzeuge */}
      {/* A plain confirmation of two facts, nothing else. The block used to be
          headed "Kostenpflicht" and asked for two numbers; the crew in the
          field does not decide who gets billed, and a vehicle COUNT tells
          whoever retypes it nothing that three names do not tell better. */}
      <RapportSection
        collapsible={foldLists}
        dense={isKp}
        title={t('sections.confirm')}
        summary={t('summary.confirm', { people: peopleCount, vehicles: vehicleCount })}
        // Prefilled from the board, so it is normally already right — the
        // summary is what lets a crew confirm that without opening it.
        state={peopleCount > 0 ? 'filled' : 'todo'}
      >
        <div className="space-y-1.5">
          <FeldPersonnelChecklist
            rows={formData.personnel}
            extra={formData.extra_personnel}
            disabled={readOnly}
            onChange={(rows: ApiRapportPersonnelRow[]) => update('personnel', rows)}
            onExtraChange={(entries: ApiRapportExtraPersonnel[]) => update('extra_personnel', entries)}
          />
          {/* The divergence is itself information: it says the board was
              behind reality, and the export prints it as such. Read off the
              list now rather than off a typed number — same rule, one source. */}
          {isCorrected(derivePersonnelCount(formData), boardPersonnel) && (
            <p className="text-xs text-muted-foreground">{t('fromBoard', { count: boardPersonnel })}</p>
          )}
        </div>

        <FeldVehicleChecklist
          rows={formData.vehicles}
          disabled={readOnly}
          onChange={(rows: ApiRapportVehicleRow[]) => update('vehicles', rows)}
        />
      </RapportSection>

      {/* ---------------------------------------------------- Material */}
      <RapportSection
        collapsible={foldLists}
        dense={isKp}
        title={t('material.title')}
        summary={materialCount > 0 ? t('summary.material', { count: materialCount }) : t('summary.materialEmpty')}
        // An empty material list is not a gap — the board simply never got the
        // material (see the checklist's own empty state), so it never nags.
        state={materialCount > 0 ? 'filled' : 'optional'}
      >
        <FeldMaterialChecklist
          rows={formData.materials}
          extraMaterials={formData.extra_materials}
          suggestions={rapport.prefill.material_name_suggestions ?? []}
          disabled={readOnly}
          // ALWAYS: the section around it carries the title in both shapes —
          // folded on /feld, as a plain heading in the KP mount — and the
          // checklist's own one made the modal read «Material / Material».
          hideHeading
          onChange={(rows: ApiRapportMaterialRow[]) => update('materials', rows)}
          onExtraMaterialsChange={entries => update('extra_materials', entries)}
        />
      </RapportSection>

      {/* ---------------------------------------------------------- Fotos */}
      {transport.photos && (
        <RapportSection
          collapsible={foldLists}
          dense={isKp}
          title={t('sections.photos')}
          summary={photos.length > 0 ? t('summary.photos', { count: photos.length }) : t('summary.photosEmpty')}
          state={photos.length > 0 ? 'filled' : 'optional'}
        >
          <PhotoUpload
            photos={photos}
            incidentId={incidentId}
            transport={transport.photos}
            disabled={readOnly}
            onPhotosChange={update => setPhotos(current => update(current))}
          />
        </RapportSection>
      )}

      {/* --------------------------------- Eigentümer-/Halterdaten */}
      {showOwnerBlock && (
      <RapportSection
        collapsible={foldLists}
        dense={isKp}
        title={t('sections.owner')}
        summary={ownerSummary || t('summary.ownerEmpty')}
        // Only some Schadenplätze have an owner to note at all.
        state={ownerSummary ? 'filled' : 'optional'}
      >
        {/* The first citizen PII in kp-rueck (§9): names, home addresses and
            plates of people who are not members. It lives with the incident and
            is deleted with the event; there is no second retention rule.
            That rule is unchanged and is written down where the person who has
            to answer for it reads it — `docs/DEPLOYMENT.md`, "Was die App über
            Dritte speichert" — rather than printed at a crew that cannot act on
            it. The line under the heading is gone, the retention is not. */}

        {rapport.prefill.melder_name && (
          <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={takeOverMelder}>
            <Copy className="size-3.5" />
            {t('takeOverMelder', { name: rapport.prefill.melder_name })}
          </Button>
        )}

        {/* Name + Telefon (§18.31). §18.10's one free-text box was right about
            Strasse, Ort, Kennzeichen and Typ — those really are prose, and they
            live in the Kurzbericht now — and wrong about the number: a phone
            written inside a paragraph cannot be dialled, which is the entire
            reason for writing down who owns the flooded cellar. Deliberately
            the same two shapes, the same input treatment and the same `tel:`
            affordance the incident already gives the Melder. */}
        <div className="space-y-1.5">
          <Label htmlFor="rapport-owner-name" className="text-xs text-muted-foreground">
            {t('ownerName')}
          </Label>
          <Input
            id="rapport-owner-name"
            value={formData.owner_name}
            disabled={readOnly}
            maxLength={200}
            placeholder={t('ownerNamePlaceholder')}
            onChange={e => update('owner_name', e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="rapport-owner-phone" className="text-xs text-muted-foreground">
              {t('ownerPhone')}
            </Label>
            {/* Somebody rings from the pavement when nobody answers the door —
                the same affordance the Melder gets on the board and on /feld. */}
            {telHref(formData.owner_phone) && (
              <a
                href={telHref(formData.owner_phone) ?? undefined}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Phone className="h-3 w-3" />
                {t('ownerCall')}
              </a>
            )}
          </div>
          <Input
            id="rapport-owner-phone"
            type="tel"
            inputMode="tel"
            value={formData.owner_phone}
            disabled={readOnly}
            maxLength={50}
            placeholder={t('ownerPhonePlaceholder')}
            onChange={e => update('owner_phone', sanitizePhoneInput(e.target.value))}
          />
        </div>
      </RapportSection>
      )}

      {/* ---------------------------------------------------- Abschluss */}
      <div className="space-y-2">
        {provenanceLines.map(line => (
          <p key={line} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserRound className="h-3 w-3 shrink-0" />
            {line}
          </p>
        ))}
        {lastSaved && (!submitted || isKp) && (
          <p className="text-xs text-muted-foreground">
            {t('lastSaved', { at: lastSaved.toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' }) })}
          </p>
        )}

        {/* The KP has no submit button (§18.17). It saves as it is typed, and a
            saved KP rapport is a filed one — so the only thing left to say is
            that nobody has to press anything. */}
        {isKp ? (
          <div className="flex flex-wrap items-center gap-3">
            {rapport.submitted_at && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                <Check className="h-3.5 w-3.5" />
                {t('submittedBadge', { at: formatDateTime(rapport.submitted_at) })}
              </span>
            )}
            {!readOnly && <p className="text-xs text-muted-foreground">{t('autosaveHint')}</p>}
          </div>
        ) : submitted ? (
          /* Filed — and still editable. The badge says what the KP has; the
             button appears only once the crew has actually changed something,
             so a correction is one tap and a filed rapport nobody touched shows
             no button to tap at all. */
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                <Check className="h-3.5 w-3.5" />
                {t('submittedBadge', { at: formatDateTime(rapport.submitted_at) })}
              </span>
              {dirty && !readOnly && (
                <span className="text-xs font-medium text-warning-foreground">{t('unsentChanges')}</span>
              )}
            </div>
            {dirty && !readOnly && (
              <Button type="button" className="w-full" disabled={isSubmitting} onClick={handleSubmit}>
                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {t('sendChanges')}
              </Button>
            )}
          </div>
        ) : (
          <Button
            type="button"
            className="w-full"
            disabled={readOnly || isSubmitting}
            // The question only guards the FIRST filing. «Änderungen senden»
            // above re-files a rapport somebody already confirmed once, and
            // asking again there would ask about gaps that were a decision.
            onClick={() => (emptySections.length > 0 ? setConfirmGaps(true) : void handleSubmit())}
          >
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t('submit')}
          </Button>
        )}
      </div>

      {/* Not a blocker: every way out of this dialog files or cancels, and the
          list is there so the crew can see WHAT is empty without closing it and
          scrolling. Escape and Abbrechen leave the form as it is. */}
      <ConfirmDialog
        open={confirmGaps}
        onOpenChange={setConfirmGaps}
        title={t('incompleteTitle')}
        description={t('incompleteBody', { count: emptySections.length })}
        confirmText={t('incompleteConfirm')}
        onConfirm={handleSubmit}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {emptySections.map(section => (
            <li key={section}>{section}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  )
}
