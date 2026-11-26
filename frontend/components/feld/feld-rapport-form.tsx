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
 * On `/feld` that button stands in the page's fixed footer as the journey's
 * third step (`submitSlot`, owner pick, sign-off #387): one button, not a
 * «Rapport erfassen» in the footer that only scrolled to a second one here.
 * The KP has no submit button at all — the board autosaves everything else, and
 * a modal that makes an operator press Save is out of place on it. A KP save
 * therefore always writes `is_draft: false`: **a KP rapport is filed from its
 * first saved keystroke.** Two guards keep that honest — it saves only when the
 * form actually changed, and only once it has content — so opening a detail
 * never creates an empty rapport and never stamps a KP editor onto a crew's.
 * Because no KP save ever carries `is_draft: true`, no late KP autosave can
 * un-submit anything, which is the bug `isSubmittingRef` exists for.
 *
 * **The two mounts are shaped differently, too.** `/feld` is ONE open card
 * (owner pick 1B «Compact chips», 24.11.2026 – «make simpler, one page»):
 * Kurzbericht · Mannschaft · Fahrzeuge · Material · Fotos · Eigentümer /
 * Geschädigte · Übergeben an, split by thin rules, the three lists as chips.
 * The folds it had before cost a tap per block and hid what was filled. The
 * KP's incident detail keeps its Kurzbericht open and its other blocks folded
 * (`FeldSection dense`): there the form is one of four things in a ~500px tab
 * column. The chips are the same on both.
 */

import { formatDateTime, formatTime } from '@/lib/format-time'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEffectEvent } from '@/lib/hooks/use-effect-event'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, Copy, Phone, RefreshCw, Send, UserRound } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FeldMaterialChecklist, unitStillOnSite } from '@/components/feld/feld-material-checklist'
import { MaterialReleaseButton } from '@/components/kanban/material-release'
import type { MaterialRelease } from '@/lib/hooks/use-material-release'
import { FeldPersonnelChecklist } from '@/components/feld/feld-personnel-checklist'
import { FeldRapportGapsDialog, rapportGaps, type RapportGap } from '@/components/feld/feld-rapport-gaps'
import { FeldSection, type FeldSectionState } from '@/components/feld/feld-section'
import { FeldVehicleChecklist } from '@/components/feld/feld-vehicle-checklist'
import PhotoUpload, { type PhotoTransport } from '@/components/reko/photo-upload'
import { usePhotoViewer, useRegisterPhotos } from '@/lib/hooks/use-photo-viewer'
import { rekoPhotoUrl } from '@/lib/reko-photos'
import type {
  ApiRapportExtraPersonnel,
  ApiRapportMaterialRow,
  ApiRapportPersonnelRow,
  ApiRapportVehicleRow,
  ApiSchadenplatzRapport,
  ApiRapportUpdate,
} from '@/lib/api/types'
import { telHref } from '@/lib/phone'
import { isRecord, readJson } from '@/lib/utils/safe-storage'
import { cn, sanitizePhoneInput } from '@/lib/utils'
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
import { ShellLoader, LoadingStatus } from '@/components/ui/shell-loader'

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
  /** Where «Rapport abschliessen» goes instead of under the form: `/feld`'s fixed
   *  footer, on the journey's Rapport step. Null / absent = under the form. Only the
   *  first filing moves; «Änderungen senden» on a filed rapport stays here. */
  submitSlot?: HTMLElement | null
  /** KP only: the release set and its click (`useMaterialRelease`). The form offers the part
   *  its checklist also calls back, as «N Geräte freigeben» under «Zurück». Omitted on /feld
   *  and for a read-only mount. */
  materialRelease?: MaterialRelease
  /** KP only: the material assignments the board still has open here. A unit marked «vor
   *  Ort» whose assignment is closed was collected («Abgeholt») and reads as back. */
  activeAssignmentIds?: readonly string[]
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

/** A draft `saveToLocalStorage` wrote: `{ data, timestamp }`. */
function isStoredRapportDraft(value: unknown): value is { data: RapportFormData; timestamp?: unknown } {
  return isRecord(value) && isRecord(value.data)
}

/** Class the jump puts on a block: the shared «this one» ring (globals.css). */
const JUMP_RING_CLASS = 'this-one-ring'
/** The ring's 1.9 s plus a beat; also how long the reduced-motion static ring stays. */
const JUMP_RING_MS = 2000

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * One block of the rapport: open with a heading, or – `fold`, the KP's lists –
 * a `FeldSection` that states what is in it.
 *
 * An open block is also where «take me there» lands (the Abschluss question's
 * rows): increment `jumpSignal` and the block
 * scrolls to just under the sticky bars (`scroll-mt-28`: the top bar plus the
 * Schadenplatz line), rings twice in ink and – with `jumpFocus` – puts the caret
 * at the end of its first text field. A checklist block leaves `jumpFocus` off:
 * its first control is a chip, not the answer.
 *
 * Module level on purpose: declared inside the form it would be a new component
 * type on every render, and React would remount the whole block — which on a
 * form means the input being typed into loses focus mid-word.
 */
function RapportSection({
  fold = false,
  defaultOpen,
  title,
  titleClassName,
  summary,
  state,
  jumpSignal,
  jumpFocus = false,
  className,
  children,
}: {
  fold?: boolean
  /** Only read with `fold`: see `FeldSection.defaultOpen`. */
  defaultOpen?: boolean
  /** Shown as the heading; a block with only a labelled field passes none. */
  title?: string
  /** Overrides the open block's heading style – the KP's Kurzbericht reads as a field label. */
  titleClassName?: string
  /** The folded block's one line — only read with `fold`. */
  summary?: string
  state?: FeldSectionState
  jumpSignal?: number
  jumpFocus?: boolean
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)

  // Reads the CURRENT `jumpFocus` without re-running the jump when it changes.
  const land = useEffectEvent((el: HTMLElement) => {
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    // Class, not state, so the same row tapped twice restarts the beats. The
    // section's className never changes between renders, so React leaves it be.
    el.classList.remove(JUMP_RING_CLASS)
    void el.offsetWidth
    el.classList.add(JUMP_RING_CLASS)
    const ringTimer = setTimeout(() => el.classList.remove(JUMP_RING_CLASS), JUMP_RING_MS)
    if (jumpFocus) {
      const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('textarea, input')
      field?.focus({ preventScroll: true })
      // …with the caret AFTER what is already written, not at offset 0.
      const end = field?.value.length ?? 0
      field?.setSelectionRange(end, end)
    }
    return () => {
      clearTimeout(ringTimer)
      el.classList.remove(JUMP_RING_CLASS)
    }
  })
  useEffect(() => {
    const el = ref.current
    if (!jumpSignal || !el) return
    return land(el)
  }, [jumpSignal])

  if (fold) {
    return (
      <FeldSection title={title ?? ''} summary={summary ?? ''} state={state ?? 'optional'} defaultOpen={defaultOpen} dense>
        {children}
      </FeldSection>
    )
  }
  return (
    <section ref={ref} className={cn('scroll-mt-28 space-y-2', className)}>
      {title && <h3 className={titleClassName ?? 'text-sm font-semibold'}>{title}</h3>}
      {children}
    </section>
  )
}

export function FeldRapportForm({ incidentId, transport, mount = 'feld', disabled, onSaved, autoFocusKurzbericht, submitSlot, materialRelease, activeAssignmentIds }: FeldRapportFormProps) {
  const t = useTranslations('feld.rapport')
  const tLoading = useTranslations('common')
  const isKp = mount === 'kp'

  const [rapport, setRapport] = useState<ApiSchadenplatzRapport | null>(null)
  const [formData, setFormData] = useState<RapportFormData>(EMPTY_RAPPORT_FORM)
  // Deliberately its own state, seeded once from the load and never re-seeded
  // from a save response: a photo is stored the moment it is taken, so the
  // upload's own answer is the newer truth and an autosave that started before
  // it must not roll the list back.
  const [photos, setPhotos] = useState<string[]>([])
  // The incident's viewer: the board's (these photos join the Reko ones there), or the one
  // /feld mounts around this form.
  const openPhoto = usePhotoViewer()
  const photoUrl = transport.photos?.url
  useRegisterPhotos('rapport', photos.map(filename => ({
    group: 'rapport' as const,
    filename,
    src: photoUrl ? photoUrl(filename) : rekoPhotoUrl(incidentId, filename),
    by: rapport?.created_by_name ?? null,
    at: rapport?.submitted_at ?? rapport?.updated_at ?? null,
  })))
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
    // Crash-safe: a corrupt or foreign value is dropped, never thrown (lib/utils/safe-storage.ts).
    const stored = readJson(key, isStoredRapportDraft, null)
    return stored && { data: stored.data, timestamp: typeof stored.timestamp === 'string' ? stored.timestamp : null }
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
  const load = async () => {
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
  }

  // The transport identity changes on every render of the parent; the
  // incident is what actually decides which rapport this is.
  const loadForIncident = useEffectEvent(() => void load())
  useEffect(() => {
    cancelledRef.current = false
    loadForIncident()
    return () => {
      cancelledRef.current = true
    }
  }, [incidentId])

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

  /** Is the «Kurzbericht fehlt noch» question on screen? */
  const [confirmGaps, setConfirmGaps] = useState(false)
  /** One counter per section the question can send the crew to; bumping it
   *  is the section's `jumpSignal`. */
  const [jumps, setJumps] = useState<Partial<Record<RapportGap, number>>>({})
  const jumpTo = (gap: RapportGap) => setJumps(prev => ({ ...prev, [gap]: (prev[gap] ?? 0) + 1 }))

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
        <LoadingStatus className="text-sm">{tLoading('loading')}</LoadingStatus>
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
          <RefreshCw className="size-3.5" />
          {t('loadRetry')}
        </Button>
      </div>
    )
  }

  const submitted = !rapport.is_draft
  const readOnly = Boolean(disabled)

  // The KP mount folds its LISTS. Inside the incident detail this form is one
  // of four things in a tab, in a column of ~500px, and «kein Rapport» still
  // produced a Materialliste, a Mannschaftsliste, a Fahrzeugliste, a photo
  // block and an Eigentümer block to scroll past. Folded, each states what is
  // in it, which answers «habe ich das schon ausgefüllt?» without opening
  // anything. Kurzbericht stays open: it is what somebody dictating over the
  // radio types into first.
  //
  // `/feld` folds nothing any more (owner pick 1B, 24.11.2026): the chips made
  // the lists short enough that the whole rapport is one card, and a fold there
  // was one more tap with a wet thumb.
  const foldLists = isKp
  // On /feld the blocks sit in one card, split by thin rules.
  const blockClass = isKp ? undefined : 'rounded-xl px-3 py-3'

  // What each closed KP block says about itself — and what the Abschluss
  // question counts.
  const materialCount =
    formData.materials.filter(row => row.used || row.left_on_site).length + formData.extra_materials.length
  // Plain values, no memo: this runs after the load's early return, where a hook may not.
  const activeAssignments = activeAssignmentIds ? new Set(activeAssignmentIds) : undefined
  const materialOnSite =
    formData.materials.filter(row => unitStillOnSite(row, activeAssignments)).length +
    formData.extra_materials.filter(entry => entry.left_on_site).length
  // «Geräte freigeben» frees only what BOTH call back: the release set from the last filed
  // save and the checklist on screen (not «vor Ort», assignment still open). An unsaved tick
  // here, or a filing from /feld the set has already seen, keeps a unit out – so the button
  // never contradicts the block it sits in. A filing the set has NOT seen yet is not caught
  // here; that needs a check at release time on the server (Sol review rounds 1–5, 24.11.2026).
  // The caption reads «nicht gebraucht» off the visible row, not off the older set.
  const visiblyBack = new Map(
    formData.materials
      .filter(row => !row.left_on_site && (!activeAssignments || activeAssignments.has(row.assignment_id)))
      .map(row => [row.assignment_id, row] as const),
  )
  const releasable = (materialRelease?.units ?? []).flatMap(unit => {
    const row = visiblyBack.get(unit.assignment_id)
    return row ? [{ ...unit, used: row.used }] : []
  })
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
   * What is still empty when «Rapport abschliessen» is tapped, in two tiers
   * (see `feld-rapport-gaps.tsx`).
   *
   * Not a gate — decision 10 stands, and a blocking form during a storm is a
   * form people defeat with empty boxes. This is the one question in between,
   * and it comes only for a section that can be MISSING (Kurzbericht,
   * Mannschaft): the tap is irreversible in the crew's eyes (the board goes
   * green, the Restliste stops asking), and a rapport without them is almost
   * always a fat finger. Empty optional sections ride along as quiet rows but
   * never ask on their own.
   */
  const gaps = rapportGaps({
    kurzbericht: kurzberichtSummary,
    peopleCount,
    materialCount,
    ownerSummary,
    ownerShown: showOwnerBlock,
  })

  // The first filing's «Rapport abschliessen» – the SAME button under the form or in
  // `/feld`'s footer (`submitSlot`): the slot is only a place, the checks are these.
  const submitButton = (
    <Button
      type="button"
      size={submitSlot ? 'lg' : 'default'}
      className={submitSlot ? 'h-12 w-full' : 'w-full'}
      disabled={readOnly || isSubmitting}
      // The question only guards the FIRST filing. «Änderungen senden»
      // re-files a rapport somebody already confirmed once, and asking
      // again there would ask about gaps that were a decision.
      onClick={() => (gaps.missing.length > 0 ? setConfirmGaps(true) : void handleSubmit())}
    >
      {isSubmitting ? <ShellLoader className="size-4" /> : <Send className="size-4" />}
      {t('submit')}
    </Button>
  )

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

      <div className={isKp ? 'space-y-3' : 'divide-y divide-border/60 rounded-xl border border-border bg-card/50'}>
      {/* ------------------------------------------------- Kurzbericht */}
      <RapportSection
        title={t('sections.kurzbericht')}
        // In the KP the rapport's one heading is the section's «Schadenplatz-Rapport»; a second
        // bold heading right under it read as a section of its own (owner, 24.11.2026).
        titleClassName={isKp ? 'text-xs font-medium text-muted-foreground' : undefined}
        jumpSignal={jumps.kurzbericht}
        jumpFocus
        className={blockClass}
      >
        {/* No dictation tip under the box. Every phone keyboard has had a
            microphone key for a decade; the people who use it already do, and
            the ones who do not are not reading a caption in the rain. */}
        <Textarea
          ref={kurzberichtRef}
          value={formData.kurzbericht}
          disabled={readOnly}
          rows={3}
          placeholder={t('kurzberichtPlaceholder')}
          onChange={e => update('kurzbericht', e.target.value)}
        />
      </RapportSection>

      {/* ---------------------------------------------------- Personal */}
      {/* Its own section since the three lists became one grammar: Mensch und
          Fahrzeug are not one list, and each section carries its own count. */}
      <RapportSection
        fold={foldLists}
        title={t('sections.personnel')}
        summary={peopleCount > 0 ? t('summary.personnel', { count: peopleCount }) : t('summary.personnelEmpty')}
        // Prefilled from the board, so it is normally already right — the
        // summary is what lets the KP confirm that without opening it.
        state={peopleCount > 0 ? 'filled' : 'todo'}
        jumpSignal={jumps.personnel}
        className={blockClass}
      >
        <FeldPersonnelChecklist
          rows={formData.personnel}
          extra={formData.extra_personnel}
          candidates={rapport.prefill.personnel_candidates ?? []}
          leaderId={rapport.prefill.leader_personnel_id}
          disabled={readOnly}
          onChange={(rows: ApiRapportPersonnelRow[]) => update('personnel', rows)}
          onExtraChange={(entries: ApiRapportExtraPersonnel[]) => update('extra_personnel', entries)}
        />
        {/* The divergence is itself information: it says the board was behind
            reality, and the export prints it as such. It matters more now that
            the list is only the aufgebotenen — this rapport feeds paid hours,
            and the one failure mode of a shorter list is a name nobody
            remembered to add back. Read off the list, never off a typed
            number. */}
        {isCorrected(peopleCount, boardPersonnel) && (
          <p className="text-xs text-muted-foreground">{t('fromBoard', { count: boardPersonnel })}</p>
        )}
      </RapportSection>

      {/* --------------------------------------------------- Fahrzeuge */}
      <RapportSection
        fold={foldLists}
        title={t('sections.vehicles')}
        summary={vehicleCount > 0 ? t('summary.vehicles', { count: vehicleCount }) : t('summary.vehiclesEmpty')}
        // «Kein Fahrzeug» is a normal, often correct answer for a Schadenplatz —
        // zu Fuss or privat angefahren — so this never nags.
        state={vehicleCount > 0 ? 'filled' : 'optional'}
        className={blockClass}
      >
        <FeldVehicleChecklist
          rows={formData.vehicles}
          candidates={rapport.prefill.vehicle_candidates ?? []}
          drivers={rapport.prefill.vehicle_drivers}
          disabled={readOnly}
          onChange={(rows: ApiRapportVehicleRow[]) => update('vehicles', rows)}
        />
      </RapportSection>

      {/* ---------------------------------------------------- Material */}
      <RapportSection
        fold={foldLists}
        title={t('material.title')}
        summary={[
          materialCount > 0 ? t('summary.material', { count: materialCount }) : t('summary.materialEmpty'),
          materialOnSite > 0 && t('summary.onSite', { count: materialOnSite }),
          // An unused unit still assigned is in the release set but not in the count.
          releasable.length > 0 && t('summary.toRelease', { count: releasable.length }),
        ]
          .filter(Boolean)
          .join(' · ')}
        // What is still out there is the block's news – open it (Feld-tab pick 1A, 24.11.2026).
        defaultOpen={materialOnSite > 0}
        // An empty material list is not a gap — the board simply never got the
        // material (see the checklist's own empty state), so it never nags.
        state={materialCount > 0 ? 'filled' : 'optional'}
        jumpSignal={jumps.material}
        className={blockClass}
      >
        <FeldMaterialChecklist
          rows={formData.materials}
          extraMaterials={formData.extra_materials}
          suggestions={rapport.prefill.material_name_suggestions ?? []}
          disabled={readOnly}
          onChange={(rows: ApiRapportMaterialRow[]) => update('materials', rows)}
          onExtraMaterialsChange={entries => update('extra_materials', entries)}
          // The KP reads the list by state: what is still on site, what came back.
          grouped={isKp}
          activeAssignmentIds={activeAssignments}
          releaseSlot={
            materialRelease && (
              <MaterialReleaseButton
                units={releasable}
                releasing={materialRelease.releasing}
                onRelease={() => void materialRelease.release(releasable.map(unit => unit.assignment_id))}
              />
            )
          }
        />
      </RapportSection>

      {/* ---------------------------------------------------------- Fotos */}
      {transport.photos && (
        <RapportSection
          fold={foldLists}
          title={t('sections.photos')}
          summary={photos.length > 0 ? t('summary.photos', { count: photos.length }) : t('summary.photosEmpty')}
          state={photos.length > 0 ? 'filled' : 'optional'}
          className={blockClass}
        >
          <PhotoUpload
            photos={photos}
            incidentId={incidentId}
            transport={transport.photos}
            disabled={readOnly}
            onOpenPhoto={openPhoto ? filename => openPhoto('rapport', filename) : undefined}
            onPhotosChange={update => setPhotos(current => update(current))}
          />
        </RapportSection>
      )}

      {/* --------------------------------- Eigentümer / Geschädigte */}
      {showOwnerBlock && (
      <RapportSection
        fold={foldLists}
        title={t('sections.owner')}
        summary={ownerSummary || t('summary.ownerEmpty')}
        // Only some Schadenplätze have an owner to note at all.
        state={ownerSummary ? 'filled' : 'optional'}
        jumpSignal={jumps.owner}
        jumpFocus
        className={blockClass}
      >
        {/* The first citizen PII in kp-rueck (§9): names, home addresses and
            plates of people who are not members. It lives with the incident and
            is deleted with the event; there is no second retention rule.
            That rule is unchanged and is written down where the person who has
            to answer for it reads it — `docs/DEPLOYMENT.md`, "Was die App über
            Dritte speichert" — rather than printed at a crew that cannot act on
            it. The line under the heading is gone, the retention is not. */}

        {/* Name + Telefon (§18.31), side by side under the block's heading,
            each with its small label above (phone forms: labels above the field). §18.10's one
            free-text box was right about Strasse, Ort, Kennzeichen and Typ —
            those really are prose, and they live in the Kurzbericht now — and
            wrong about the number: a phone written inside a paragraph cannot be
            dialled, which is the entire reason for writing down who owns the
            flooded cellar. */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="rapport-owner-name" className="mb-1 block text-xs text-muted-foreground">
              {t('ownerName')}
            </Label>
            <Input
              id="rapport-owner-name"
              value={formData.owner_name}
              disabled={readOnly}
              maxLength={200}
              autoComplete="off"
              placeholder={t('ownerNamePlaceholder')}
              onChange={e => update('owner_name', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="rapport-owner-phone" className="mb-1 block text-xs text-muted-foreground">
              {t('ownerPhone')}
            </Label>
            <Input
              id="rapport-owner-phone"
              type="tel"
              inputMode="tel"
              value={formData.owner_phone}
              disabled={readOnly}
              maxLength={50}
              autoComplete="off"
              placeholder={t('ownerPhonePlaceholder')}
              onChange={e => update('owner_phone', sanitizePhoneInput(e.target.value))}
            />
          </div>
        </div>

        {(rapport.prefill.melder_name || telHref(formData.owner_phone)) && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {/* One tap that PREFILLS, never equates — see `takeOverMelder`. */}
            {rapport.prefill.melder_name && (
              <button
                type="button"
                disabled={readOnly}
                onClick={takeOverMelder}
                className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-sm font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 break-words">{t('takeOverMelder', { name: rapport.prefill.melder_name })}</span>
              </button>
            )}
            {/* Somebody rings from the pavement when nobody answers the door —
                the same affordance the Melder gets on the board and on /feld. */}
            {telHref(formData.owner_phone) && (
              <a
                href={telHref(formData.owner_phone) ?? undefined}
                className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-foreground underline underline-offset-2 hover:decoration-2"
              >
                <Phone className="size-3.5" aria-hidden="true" />
                {t('ownerCall')}
              </a>
            )}
          </div>
        )}
      </RapportSection>
      )}

      {/* ------------------------------------------------ Übergeben an */}
      {showHandover && (
        <RapportSection className={blockClass}>
          <Label htmlFor="rapport-handover" className="text-xs text-muted-foreground">
            {t('handedOverTo')}
          </Label>
          <Input
            id="rapport-handover"
            value={formData.handed_over_to}
            disabled={readOnly}
            autoComplete="off"
            placeholder={t('handedOverToPlaceholder')}
            onChange={e => update('handed_over_to', e.target.value)}
          />
        </RapportSection>
      )}
      </div>

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
            {t('lastSaved', { at: formatTime(lastSaved) })}
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
                {isSubmitting ? <ShellLoader className="size-4" /> : <Send className="size-4" />}
                {t('sendChanges')}
              </Button>
            )}
          </div>
        ) : submitSlot ? (
          createPortal(submitButton, submitSlot)
        ) : (
          submitButton
        )}
      </div>

      {/* Not a blocker: every way out of this question files, goes back, or
          goes TO the gap. Escape and «Zurück zum Rapport» leave the form as it
          is; a row lands on its section. */}
      <FeldRapportGapsDialog
        open={confirmGaps}
        onOpenChange={setConfirmGaps}
        gaps={gaps}
        onJump={jumpTo}
        onConfirm={() => void handleSubmit()}
      />
    </div>
  )
}
