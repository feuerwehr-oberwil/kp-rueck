'use client'

/**
 * «kommt um» / «geht um» – the one editor for a person's planned time (feedback 19.11.2026, #3),
 * used by the Appell row's clock button (`PlannedTimeClock`, pick 2C), the check-in link's chip
 * (`PlannedTimeChip`) and /feld.
 *
 * `PlannedTimePicker` wraps any trigger: a popover at the trigger on a desk, a bottom sheet on a
 * phone (FRONTEND.md phone forms: label above the field, footer on the keys, no keyboard until a
 * tap). Inside: the time field, «+1 h» / «+2 h» (KP Front's half-hour steps), «Zeit löschen»
 * and «Übernehmen». Enter saves, Esc closes. The typed «22:00» becomes an instant through
 * `lib/planned-times.ts` (`resolveClock` + `keepOrdered`), so the caller only ever gets ISO.
 */

import { cloneElement, forwardRef, useId, useState, type ComponentProps, type ReactElement } from 'react'
import { useTranslations } from 'next-intl'
import { Clock, LogOut, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FormMessage, fieldMessageProps, formMessageId } from '@/components/ui/form-message'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ShellLoader } from '@/components/ui/shell-loader'
import { useIsMobile } from '@/components/ui/use-mobile'
import { useMinuteTick } from '@/components/ui/incident-time'
import { useIntlLocale } from '@/lib/date-locale'
import { formatDuration } from '@/lib/duration'
import { formatTime } from '@/lib/format-time'
import { clockValue, inHours, keepOrdered, leavesSoon, minutesUntil, resolveClock } from '@/lib/planned-times'
import { cn } from '@/lib/utils'

export type PlanKind = 'from' | 'until'

type PickerProps = {
  kind: PlanKind
  /** The planned instant now (ISO), or null. */
  value: string | null | undefined
  /** The other end of the plan, so the result never runs backwards (`keepOrdered`). */
  other?: string | null
  /** Head of the popover/sheet: «Geht um · Baumann Michael», or «Ich bin da bis». */
  title: string
  /** One line under the head – what the plan does. */
  hint: string
  /** The field's own label above it. */
  fieldLabel: string
  /** Writes the plan; rejects on failure (the picker says so and stays open). */
  onSave: (iso: string | null) => Promise<void>
  /** The element that opens it (a chip, a button). Must be a focusable button. */
  trigger: ReactElement<ComponentProps<'button'>>
}

export function PlannedTimePicker({ kind, value, other, title, hint, fieldLabel, onSave, trigger }: PickerProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const form = (
    <PlannedTimeForm
      kind={kind}
      value={value}
      other={other}
      fieldLabel={fieldLabel}
      // A phone sheet raises no keyboard until a tap; on a desk the field takes the keys.
      autoFocus={!isMobile}
      inSheet={isMobile}
      onSave={onSave}
      onDone={() => setOpen(false)}
    />
  )

  if (isMobile) {
    return (
      <>
        {cloneElement(trigger, { onClick: () => setOpen(true), 'aria-haspopup': 'dialog' })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="mx-auto max-w-md gap-0 rounded-t-2xl p-0">
            <SheetHeader className="gap-1 px-4 pt-5 pb-3 pr-12">
              <SheetTitle className="text-lg leading-tight break-words">{title}</SheetTitle>
              <SheetDescription>{hint}</SheetDescription>
            </SheetHeader>
            {form}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80" aria-label={title}>
        <p className="text-sm font-semibold break-words">{title}</p>
        <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{hint}</p>
        {form}
      </PopoverContent>
    </Popover>
  )
}

/** The field, the quick steps and the two answers. In a sheet the answers are its footer. */
function PlannedTimeForm({
  kind,
  value,
  other,
  fieldLabel,
  autoFocus,
  inSheet,
  onSave,
  onDone,
}: {
  kind: PlanKind
  value: string | null | undefined
  other?: string | null
  fieldLabel: string
  autoFocus: boolean
  inSheet: boolean
  onSave: (iso: string | null) => Promise<void>
  onDone: () => void
}) {
  const t = useTranslations('common.attendancePlan')
  const id = useId()
  const [clock, setClock] = useState(() => clockValue(value))
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)

  const write = async (iso: string | null) => {
    setBusy(true)
    try {
      await onSave(iso)
      onDone()
    } catch (error) {
      console.error('Planned time not saved:', error)
      toast.error(t('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    const now = Date.now()
    const at = resolveClock(clock, now)
    if (!at) {
      setMissing(true)
      document.getElementById(id)?.focus()
      return
    }
    void write(keepOrdered(at, kind, other).toISOString())
  }

  const answers = (
    <div className={cn('flex items-center gap-2', inSheet ? 'w-full' : 'mt-3 justify-end')}>
      {value && (
        <Button type="button" variant="ghost" size={inSheet ? 'lg' : 'sm'} disabled={busy} onClick={() => void write(null)}>
          {t('clear')}
        </Button>
      )}
      <Button type="submit" size={inSheet ? 'lg' : 'sm'} disabled={busy} className={cn(inSheet && 'flex-1')}>
        {busy && <ShellLoader />}
        {t('save')}
      </Button>
    </div>
  )

  const fields = (
    <>
      <Label htmlFor={id} className="mb-1.5">{fieldLabel}</Label>
      <Input
        id={id}
        type="time"
        autoFocus={autoFocus}
        value={clock}
        onChange={(e) => {
          setClock(e.target.value)
          setMissing(false)
        }}
        className="font-mono text-base"
        {...fieldMessageProps(id, missing ? 'error' : null)}
      />
      <FormMessage id={formMessageId(id)} className="mt-1.5">{missing ? t('required') : null}</FormMessage>
      {/* Steps from now, onto the half hour – they fill the field, «Übernehmen» saves it. */}
      <div className="mt-2 flex gap-1.5">
        {[1, 2].map((hours) => (
          <Button
            key={hours}
            type="button"
            variant="outline"
            size="xs"
            onClick={() => {
              setClock(clockValue(inHours(Date.now(), hours).toISOString()))
              setMissing(false)
            }}
          >
            {t('plusHours', { hours })}
          </Button>
        ))}
      </div>
    </>
  )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className={cn(inSheet && 'flex min-h-0 flex-1 flex-col')}
    >
      {inSheet ? (
        <>
          <SheetBody className="px-4 pb-3">{fields}</SheetBody>
          <SheetFooter className="mt-0 border-t px-4 pt-3 pb-sheet-safe">{answers}</SheetFooter>
        </>
      ) : (
        <>
          {fields}
          {answers}
        </>
      )}
    </form>
  )
}

/** The plan button's name: «Geht um setzen» / «Geht um 22:00 – ändern» (and «Kommt um …»). */
function planButtonLabel(t: ReturnType<typeof useTranslations<'common.attendancePlan'>>, kind: PlanKind, time: string) {
  if (kind === 'until') return time ? t('ariaUntilSet', { time }) : t('ariaUntil')
  return time ? t('ariaFromSet', { time }) : t('ariaFrom')
}

/**
 * The plan as a chip – the check-in link's «geht um» and the person popover's two: «geht 22:00»
 * (or «kommt 17:30» for `kind="from"`), dashed «+ bis» / «+ ab» while nothing is planned; amber
 * with the time left («· in 29'») when the person leaves within the hour. A button (forwardRef)
 * so it can be a popover trigger and takes Tab + Enter. Spread props last: the popover trigger
 * hands its `onClick` / aria state through them.
 */
export const PlannedTimeChip = forwardRef<
  HTMLButtonElement,
  { at: string | null | undefined; kind?: PlanKind } & Omit<ComponentProps<'button'>, 'value'>
>(function PlannedTimeChip({ at, kind = 'until', className, ...props }, ref) {
  const t = useTranslations('common.attendancePlan')
  // «in 29'» counts down on the shared minute timer, like the crew's time on duty.
  useMinuteTick()
  const now = Date.now()
  const time = formatTime(at, useIntlLocale())
  const Icon = !time ? Plus : kind === 'until' ? LogOut : Clock
  const soon = kind === 'until' && !!time && leavesSoon(at, now)
  const left = minutesUntil(at, now) ?? 0
  const label = !time
    ? t(kind === 'until' ? 'addUntil' : 'addFrom')
    : kind === 'from'
      ? t('chipFrom', { time })
      : !soon
        ? t('chipUntil', { time })
        : left > 0
          ? t('chipUntilSoon', { time, duration: formatDuration(left * 60_000) })
          : t('chipUntilPast', { time })
  return (
    <button
      ref={ref}
      type="button"
      aria-label={planButtonLabel(t, kind, time)}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-xs transition-colors',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        // ≥44px on a phone or coarse pointer – the chip is its own target beside the row's.
        'max-md:h-11 pointer-coarse:h-11',
        !time && 'border-dashed text-muted-foreground',
        time && 'bg-background font-mono font-medium',
        soon && 'border-warning/60 bg-warning/15 text-warning-foreground hover:bg-warning/25',
        className,
      )}
      {...props}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  )
})

/**
 * The Appell row's plan button (owner pick 2C, 19.11.2026): a quiet square clock at the row's
 * end – pale while nothing is planned, ink once a time is set. The time itself is the row's
 * fact line; this only opens `PlannedTimePicker`. The row is the `group`: hovering it gives the
 * clock its edge, so row and clock light up as one. forwardRef + props spread last, as the chip.
 */
export const PlannedTimeClock = forwardRef<
  HTMLButtonElement,
  { kind: PlanKind; at: string | null | undefined } & Omit<ComponentProps<'button'>, 'value'>
>(function PlannedTimeClock({ kind, at, className, ...props }, ref) {
  const t = useTranslations('common.attendancePlan')
  const time = formatTime(at, useIntlLocale())
  const label = planButtonLabel(t, kind, time)
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-sm border border-transparent transition-colors',
        'group-hover:border-border group-hover:bg-background hover:text-foreground',
        // ≥44px on a phone or coarse pointer – its own target beside the row's.
        'max-md:size-11 pointer-coarse:size-11',
        time ? 'text-foreground' : 'text-muted-foreground/50',
        className,
      )}
      {...props}
    >
      <Clock className="size-3.5" aria-hidden />
    </button>
  )
})
