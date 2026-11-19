'use client'

/**
 * AttendanceModal — the Appell, the board's own roll-call.
 *
 * The check-in link is an *input channel*, not the home of attendance: when the phones
 * are gone (cellar, dead battery, gloves, or a crew that will not open an app at 02:00)
 * the KP is the only input device left, and until now it could watch the roll-call happen
 * and change nothing about it. This is the writer.
 *
 * Shape decisions worth not re-deriving:
 *
 * - **One target per row, three states.** `nicht anwesend → anwesend → gegangen → nicht
 *   anwesend`, cycled by clicking the row. "Gegangen" is a statement, not an absence —
 *   somebody who went home at 20:40 is not somebody who never came, and the Ereignis report
 *   reads the difference. The third click closes the loop by deleting the attendance row,
 *   which is the only way back out of one: check-out *creates* a row for somebody who never
 *   came, so without it a mis-tick was correctable to "gegangen" but never to "nie da".
 * - **Alphabetical and stable.** A roll-call is read off a list. Checked-in-first would
 *   reorder the list under the operator's finger as they tick, which is unusable at 03:00.
 * - **Assignment is a warning, not a wall.** A person still assigned to an incident gets a
 *   chip and a confirmation; the check-out then proceeds and leaves the assignment intact.
 *   The board is the one surface that *can* release it, so a hard block would force a
 *   surface change just to send somebody home. `/check-in` on the phone still blocks —
 *   it has no way to release anything.
 * - **Unavailable people are shown, disabled.** The backend refuses to check them in, so
 *   offering the action would be a lie; hiding the name would make the operator hunt for it.
 */

import { SearchEmptyState } from "@/components/ui/empty-state"
import { PersonName } from "@/components/person-name"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CheckCircle2, Circle, LogOut, Users } from 'lucide-react'
import { apiClient, type ApiPersonnelListItem } from '@/lib/api-client'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/components/ui/use-mobile'
import { LoadingStatus } from '@/components/ui/shell-loader'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { QuickAddPersonnel } from '@/components/quick-add-personnel'
import { DiveraIncomingBlock } from '@/components/kanban/divera-incoming-block'
import { wsClient } from '@/lib/websocket-client'
import { formatTime } from '@/lib/format-time'
import { sortByName } from '@/lib/roster-order'
import { cn } from '@/lib/utils'

/** What a row shows. Derived, never stored — the two timestamps already say it. */
export type AttendanceState = 'absent' | 'present' | 'left'

export function attendanceState(person: ApiPersonnelListItem): AttendanceState {
  if (person.checked_in) return 'present'
  // Only somebody who actually left has a departure stamp. No row at all, or a row
  // without one, is "never came" — which the Ereignis report must not confuse with
  // "went home".
  return person.checked_out_at ? 'left' : 'absent'
}

/**
 * The header's three numbers: `{present} anwesend · {left} gegangen · {total} Mannschaft`.
 * `total` is the whole roster the roll-call offers, unavailable people included — they are
 * still Mannschaft, they are just not available tonight.
 */
export function summarizeAttendance(people: ApiPersonnelListItem[]): {
  present: number
  left: number
  total: number
} {
  let present = 0
  let left = 0
  for (const person of people) {
    const state = attendanceState(person)
    if (state === 'present') present += 1
    else if (state === 'left') left += 1
  }
  return { present, left, total: people.length }
}

/**
 * Alphabetical by the name as written ("Nachname Vorname" here), stable across every
 * refresh and every tick. Sorting by state would be the natural instinct and is exactly
 * wrong: the list must not move while it is being read out.
 *
 * The comparator itself is shared with `/check-in` and the `/feld` picker
 * (`lib/roster-order.ts`) — the same people, the same order, whichever surface
 * somebody is looking for their name on.
 */
export function sortAttendance(people: ApiPersonnelListItem[]): ApiPersonnelListItem[] {
  return sortByName(people)
}

/** One fact a row states besides the name. Times are already «17:22» clock strings. */
export type AttendanceFact =
  | { kind: 'unavailable' }
  | { kind: 'since'; time: string }
  | { kind: 'span'; from: string | null; until: string }
  | { kind: 'assigned'; where: string }

/**
 * What a row says about a person, in reading order – the phone's second line
 * («seit 17:22 · zugewiesen: 14 · Talstrasse 25») and the desktop row's chip + time.
 * Empty for somebody who never came: the open circle already says it. `assignedAt`
 * counts only while the person is in – somebody who went home is not «zugewiesen» here.
 */
export function attendanceFacts(person: ApiPersonnelListItem, assignedAt: string | null): AttendanceFact[] {
  if (person.status === 'unavailable') return [{ kind: 'unavailable' }]
  const since = formatTime(person.checked_in_at) || null
  const state = attendanceState(person)
  if (state === 'present') {
    const facts: AttendanceFact[] = since ? [{ kind: 'since', time: since }] : []
    if (assignedAt) facts.push({ kind: 'assigned', where: assignedAt })
    return facts
  }
  const until = formatTime(person.checked_out_at) || null
  if (state === 'left' && until) return [{ kind: 'span', from: since, until }]
  return []
}


interface AttendanceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string
  eventName: string
  /** Where this person is still assigned, for the check-out warning. Injected rather than
   *  read from the operations context so the modal stays a pure view of attendance. */
  assignmentLabelFor?: (person: ApiPersonnelListItem) => string | null
  /** Fired after every successful attendance write. The board's roster is
   *  "everybody checked in", so ticking somebody here adds them to the sidebar —
   *  and waiting for the socket round-trip to say so made the Appell look like
   *  it had not worked. The modal keeps its own optimistic state either way. */
  onAttendanceChange?: () => void
  /** Editors: offer the one-click check-in on the Divera «Anrückend» rows. */
  canCheckIn?: boolean
}

export function AttendanceModal({
  open,
  onOpenChange,
  eventId,
  eventName,
  assignmentLabelFor,
  onAttendanceChange,
  canCheckIn = false,
}: AttendanceModalProps) {
  const t = useTranslations('kanban.attendance')
  const tCommon = useTranslations('kanban.common')
  const isMobile = useIsMobile()
  const [people, setPeople] = useState<ApiPersonnelListItem[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [confirmOut, setConfirmOut] = useState<{ person: ApiPersonnelListItem; where: string } | null>(null)
  const [confirmOutAll, setConfirmOutAll] = useState(false)
  // Per-person in-flight guard, same reasoning as the phone's: a fast double-click must
  // not check somebody in and straight back out.
  const busyRef = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const data = await apiClient.getEventCheckInList(eventId)
      setPeople(data.personnel)
    } catch (error) {
      console.error('Failed to load attendance:', error)
    } finally {
      setIsLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    if (!open) return
    setIsLoading(true)
    load()
    // Live: the same `personnel_update` events the check-in link already emits, so a
    // tablet in the corridor and the board never disagree about who is here.
    const unsubscribe = wsClient.on('personnel_update', () => load())
    return unsubscribe
  }, [open, load])

  const sorted = useMemo(() => sortAttendance(people), [people])
  // Anybody with an attendance record — in now, or in and out again — is not «anrückend».
  const attendedIds = useMemo(
    () => new Set(people.filter((p) => attendanceState(p) !== 'absent' || p.checked_in_at).map((p) => p.id)),
    [people]
  )
  const stats = useMemo(() => summarizeAttendance(people), [people])
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return sorted
    return sorted.filter(
      (person) =>
        person.name.toLowerCase().includes(needle) || (person.role ?? '').toLowerCase().includes(needle)
    )
  }, [sorted, search])

  const applyLocally = (personId: string, patch: Partial<ApiPersonnelListItem>) => {
    setPeople((previous) => previous.map((p) => (p.id === personId ? { ...p, ...patch } : p)))
  }

  const checkIn = async (person: ApiPersonnelListItem) => {
    try {
      await apiClient.checkInPersonnelForEvent(person.id, eventId)
      applyLocally(person.id, { checked_in: true, checked_in_at: new Date().toISOString(), checked_out_at: null })
      onAttendanceChange?.()
    } catch (error) {
      console.error('Check-in failed:', error)
      toast.error(t('writeFailed'))
      load()
    }
  }

  const checkOut = async (person: ApiPersonnelListItem) => {
    try {
      await apiClient.checkOutPersonnelForEvent(person.id, eventId)
      applyLocally(person.id, { checked_in: false, checked_out_at: new Date().toISOString() })
      onAttendanceChange?.()
    } catch (error) {
      console.error('Check-out failed:', error)
      toast.error(t('writeFailed'))
      load()
    }
  }

  const clearAttendance = async (person: ApiPersonnelListItem) => {
    try {
      await apiClient.clearPersonnelAttendance(person.id, eventId)
      applyLocally(person.id, { checked_in: false, checked_in_at: null, checked_out_at: null })
      onAttendanceChange?.()
    } catch (error) {
      console.error('Clearing attendance failed:', error)
      toast.error(t('writeFailed'))
      load()
    }
  }

  /**
   * The row cycles `nicht anwesend → anwesend → gegangen → nicht anwesend`.
   *
   * The third step used to wrap straight back to *anwesend*, which meant a
   * mis-tick could be corrected to "went home" but never to "was never here" —
   * and the Ereignis report reads those as different facts. Check-out even
   * writes a row for somebody who never came, so the cycle had no way back out
   * of one it had just created.
   */
  const cycle = async (person: ApiPersonnelListItem) => {
    if (person.status === 'unavailable') return
    if (busyRef.current.has(person.id)) return
    busyRef.current.add(person.id)
    try {
      const state = attendanceState(person)
      if (state === 'present') {
        const where = assignmentLabelFor?.(person)
        if (where) {
          // Warn, then proceed — and never release the assignment behind their back.
          setConfirmOut({ person, where })
          return
        }
        await checkOut(person)
      } else if (state === 'left') {
        await clearAttendance(person)
      } else {
        await checkIn(person)
      }
    } finally {
      setTimeout(() => busyRef.current.delete(person.id), 300)
    }
  }

  const checkOutAll = async () => {
    try {
      await apiClient.checkOutAllPersonnel(eventId)
      await load()
      onAttendanceChange?.()
    } catch (error) {
      console.error('Check-out-all failed:', error)
      toast.error(t('writeFailed'))
    }
  }

  /** «Anrückend» → present: the roll-call's own check-in, so the row below ticks too. */
  const checkInFromDivera = async (personnelId: string) => {
    const person = people.find((p) => p.id === personnelId)
    if (person) {
      if (busyRef.current.has(person.id)) return
      busyRef.current.add(person.id)
      try {
        await checkIn(person)
      } finally {
        setTimeout(() => busyRef.current.delete(person.id), 300)
      }
      return
    }
    await apiClient.checkInPersonnelForEvent(personnelId, eventId)
    await load()
    onAttendanceChange?.()
  }

  const isNameTaken = (name: string) =>
    people.some((person) => person.name.trim().toLowerCase() === name.trim().toLowerCase())

  const title = t('title', { event: eventName })
  const summary = t('summary', { present: stats.present, left: stats.left, total: stats.total })

  const searchField = (
    <SearchInput
      value={search}
      onValueChange={setSearch}
      placeholder={tCommon('search')}
      containerClassName="min-w-0 flex-1"
    />
  )

  const list = (
    <>
      {/* Who Divera says is coming, above the roll-call. Out of the way while a search
          narrows the list: that is a different question, and the name is below anyway. */}
      {!isLoading && !search.trim() && (
        <DiveraIncomingBlock
          eventId={eventId}
          enabled={open}
          attendedIds={attendedIds}
          canCheckIn={canCheckIn}
          onCheckIn={checkInFromDivera}
          className="mb-3"
        />
      )}
      {isLoading ? (
        <div className="flex justify-center py-6">
          <LoadingStatus className="text-sm">{t('loading')}</LoadingStatus>
        </div>
      ) : visible.length === 0 && search.trim() ? (
        <SearchEmptyState query={search} onClear={() => setSearch('')} />
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('noneFound')}</p>
      ) : (
        // ONE column, on every width. Two columns meant the roll-call ran
        // down the left half and back up the right, so the name after
        // «Aebi» was «Ammann» two rows down and «Aebischer» sat on the
        // other side — read aloud from top to bottom, that is how somebody
        // gets skipped. A roll-call is a single list.
        <div className="grid grid-cols-1 gap-1.5">
          {visible.map((person) => (
            <AttendanceRow
              key={person.id}
              person={person}
              assignedAt={person.checked_in ? (assignmentLabelFor?.(person) ?? null) : null}
              twoLines={isMobile}
              onClick={() => cycle(person)}
            />
          ))}
        </div>
      )}
    </>
  )

  const quickAdd = (
    <>
      <QuickAddPersonnel
        onPersonAdded={async () => {
          await load()
        }}
        checkInEventId={eventId}
        isNameTaken={isNameTaken}
        // The sheet footer is already the frame on the phone; the desktop dialog keeps
        // today's boxed form.
        framed={!isMobile}
      />
      <p className="mt-1 text-center text-xs text-muted-foreground">{t('quickAddHint')}</p>
    </>
  )

  return (
    <>
      {isMobile ? (
        // The phone: a bottom sheet by the phone-form rules (CLAUDE.md «Phone geometry») –
        // search on top, the list scrolls in SheetBody, «Neue Person hinzufügen» stays in the
        // footer above the keys. It opens without focusing the search (no keyboard until a
        // tap) and swipes down to close. The centred dialog it replaces cut every name that
        // had a «zugewiesen» chip and a time beside it («Birrer Abd…»), so a row here is two
        // lines: the full name, then the facts. «Alle auschecken» is desktop-only: a list
        // screen on the phone has one action, and sending everybody home is the end of the
        // Ereignis, done at the board.
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            className="h-[88dvh] modal-h-tall gap-0 rounded-t-2xl [&>[data-slot=sheet-close]]:top-[29px] [&>[data-slot=sheet-close]]:-translate-y-1/2"
          >
            {/* Same frame as «Neuer Einsatz»: title 18/600, the ✕ centred on its line. The
                height is fixed (88dvh, the tall clamp) so the sheet – and the search field under
                the thumb – does not jump while a search narrows the list; with the keyboard up,
                globals.css sizes it to the visible band instead. */}
            <SheetHeader className="gap-1 px-4 pt-5 pb-3 pr-12">
              <SheetTitle className="text-lg leading-tight break-words">{title}</SheetTitle>
              <SheetDescription>{summary}</SheetDescription>
            </SheetHeader>
            <div className="flex px-4 pb-2">{searchField}</div>
            <SheetBody className="px-4 pb-3">{list}</SheetBody>
            <SheetFooter className="mt-0 gap-0 border-t px-4 pt-3 pb-sheet-safe">{quickAdd}</SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          {/* On the modal height scale like every other dialog, instead of the
              hand-rolled `max-h-[62vh]` the list used to carry. That clamped only
              the list, so header + search + quick-add stacked on top of it and the
              dialog came out ~95vh tall — 757px in an 800px window, 21px of air
              top and bottom, and `vh` rather than `dvh` (see modal-h-* in
              globals.css: with `vh` a mobile address bar pushes the quick-add row
              out of reach). The list scrolls inside the clamp now.

              `sm:max-w-3xl` needs its prefix: DialogContent's own `sm:max-w-lg`
              is variant-scoped, so the bare `max-w-3xl` this used to carry never
              won at desktop widths and the roll-call ran in a 512px column. */}
          <DialogContent className="flex modal-h-tall sm:max-w-3xl flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="size-4" />
                {title}
              </DialogTitle>
              <DialogDescription>{summary}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-row items-center gap-2">
              {searchField}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmOutAll(true)}
                disabled={stats.present === 0}
              >
                <LogOut className="size-3.5" />
                {t('checkOutAll')}
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">{list}</div>

            <div className="border-t pt-3">{quickAdd}</div>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={!!confirmOut}
        onOpenChange={(next) => !next && setConfirmOut(null)}
        title={t('assignedTitle')}
        description={
          confirmOut ? t('assignedDescription', { name: confirmOut.person.name, where: confirmOut.where }) : ''
        }
        confirmText={t('checkOutAnyway')}
        onConfirm={async () => {
          if (confirmOut) await checkOut(confirmOut.person)
          setConfirmOut(null)
        }}
      />

      <ConfirmDialog
        open={confirmOutAll}
        onOpenChange={setConfirmOutAll}
        title={t('checkOutAllTitle')}
        description={t('checkOutAllDescription', { count: stats.present })}
        confirmText={t('checkOutAll')}
        // One Enter would check out the whole crew.
        initialFocus="cancel"
        onConfirm={checkOutAll}
      />
    </>
  )
}

/**
 * One person, one target: a click cycles the state (see `cycle`). The glyph on the left
 * says the state. `twoLines` is the phone: line 1 the full name (wraps, never truncates),
 * line 2 the facts in mono. The desktop row keeps everything on one line – it has the
 * width – with «zugewiesen» as a chip and the time on the right.
 */
function AttendanceRow({
  person,
  assignedAt,
  twoLines,
  onClick,
}: {
  person: ApiPersonnelListItem
  assignedAt: string | null
  twoLines: boolean
  onClick: () => void
}) {
  const t = useTranslations('kanban.attendance')
  const tCommon = useTranslations('kanban.common')
  const state = attendanceState(person)
  const unavailable = person.status === 'unavailable'
  const facts = attendanceFacts(person, assignedAt)
  const name = person.name.trim() || tCommon('unknownResource')

  const factText = (fact: AttendanceFact): string => {
    switch (fact.kind) {
      case 'unavailable':
        return t('unavailable')
      case 'since':
        return t('since', { time: fact.time })
      case 'span':
        return `${fact.from ?? '–'} – ${fact.until}`
      case 'assigned':
        return twoLines ? t('assignedTo', { where: fact.where }) : t('assignedChip')
    }
  }

  const glyph =
    state === 'present' ? (
      <CheckCircle2 className="size-4 shrink-0 text-success" />
    ) : state === 'left' ? (
      <LogOut className="size-4 shrink-0" />
    ) : (
      <Circle className="size-4 shrink-0 text-muted-foreground" />
    )

  const assigned = facts.find((fact) => fact.kind === 'assigned')
  const time = facts.find((fact) => fact.kind !== 'assigned')

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={unavailable}
      aria-pressed={state === 'present'}
      className={cn(
        'flex w-full gap-2.5 rounded-md border px-3 text-left text-sm transition-colors',
        twoLines ? 'min-h-11 items-start py-2' : 'items-center py-2',
        // ring-inset: the focus ring must not grow the row's footprint — an outset ring made
        // the focused row sit 2px proud of its neighbours (field test 08.09.)
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        state === 'present' && 'border-success/40 bg-success/5',
        state === 'left' && 'border-dashed text-muted-foreground',
        state === 'absent' && 'border-border',
        unavailable && 'cursor-not-allowed opacity-50 hover:bg-transparent'
      )}
    >
      {twoLines ? (
        <>
          {/* 2px down: the glyph sits on the name's line, not between the two lines. */}
          <span className="mt-0.5 flex shrink-0">{glyph}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-base break-words">
              <PersonName name={person.name} personnelId={person.id} kennung={person.kennung} display={name} />
            </span>
            {facts.length > 0 && (
              // Each fact an inline-block: a wrap falls between «seit 17:22» and
              // «zugewiesen: 14 · Talstrasse 25», not inside the Einsatz, unless one alone
              // is wider than the row.
              <span className="mt-0.5 block font-mono text-xs break-words text-muted-foreground">
                {facts.map((fact, i) => (
                  <Fragment key={fact.kind}>
                    {i > 0 && ' '}
                    <span className="inline-block max-w-full">
                      {factText(fact)}
                      {i < facts.length - 1 && '\u00a0·'}
                    </span>
                  </Fragment>
                ))}
              </span>
            )}
          </span>
        </>
      ) : (
        <>
          {glyph}
          <span className="min-w-0 flex-1 truncate" title={name}>
            <PersonName name={person.name} personnelId={person.id} kennung={person.kennung} display={name} />
          </span>
          {assigned && (
            <span className="shrink-0 rounded-sm bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning-foreground">
              {factText(assigned)}
            </span>
          )}
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{time ? factText(time) : ''}</span>
        </>
      )}
    </button>
  )
}
