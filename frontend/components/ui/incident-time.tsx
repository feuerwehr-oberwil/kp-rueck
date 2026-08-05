'use client'

/**
 * IncidentTime — the one chip that says how old an incident is.
 *
 * Every surface used to answer that question with its own number: the kanban
 * card counted from the last status change, the detail header and the map list
 * counted from the alarm, the wall display did a third thing — and all three
 * rendered as the same small mono chip with no label. `lib/incident-time.ts`
 * defines the three meanings; this renders whichever one is active, always with
 * that mode's icon and a `title` that names the semantic in words.
 *
 * The mode is board-wide, not per chip (`use-incident-time-mode`), so two cards
 * next to each other are always measuring the same thing. The dropdown sets it
 * for this device.
 *
 * `readOnly` renders the value and its tooltip without the menu — for places a
 * dropdown cannot or should not go: inside a Leaflet tooltip, on the wall
 * display nobody can click, and inside a drag source where a menu would fight
 * the drag.
 */

import { useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Clock } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIncidentTimeMode } from '@/lib/hooks/use-incident-time-mode'
import {
  INCIDENT_TIME_MODES,
  INCIDENT_TIME_MODE_ICON,
  formatClockTime,
  formatIncidentTime,
  incidentTimeReference,
  isDurationMode,
  type IncidentTimeMode,
  type IncidentTimeSource,
} from '@/lib/incident-time'
import { ageChipClass } from '@/lib/kanban-utils'
import { cn } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* One minute ticker for every chip on the page                               */
/* -------------------------------------------------------------------------- */
// A board can hold sixty cards; sixty setIntervals to redraw a number that
// changes once a minute is sixty too many. One module timer, one subscription.

let tick = 0
let timer: ReturnType<typeof setInterval> | null = null
const tickListeners = new Set<() => void>()

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener)
  if (!timer) {
    timer = setInterval(() => {
      tick += 1
      for (const l of tickListeners) l()
    }, 60_000)
  }
  return () => {
    tickListeners.delete(listener)
    if (tickListeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

const getTick = () => tick

function useMinuteTick(): number {
  return useSyncExternalStore(subscribeTick, getTick, getTick)
}

/* -------------------------------------------------------------------------- */

/**
 * Whether an `<IncidentTime suppressDurations>` would render anything.
 *
 * For callers that wrap the chip in decoration of their own — a «·» separator,
 * a surrounding row — which has to disappear with it rather than leave an
 * orphan dot behind on a closed incident.
 */
export function useIncidentTimeVisible(suppressDurations: boolean): boolean {
  const { mode } = useIncidentTimeMode()
  return !(suppressDurations && isDurationMode(mode))
}

export interface IncidentTimeProps {
  /** Anything carrying a dispatch time and (optionally) a last-status-change time. */
  operation: IncidentTimeSource
  /** Value + tooltip, no dropdown. */
  readOnly?: boolean
  /**
   * Colour the chip amber/red once the incident has been sitting in its current
   * status too long. Always measured from the status change regardless of the
   * displayed mode — the colour is a separate signal from the number.
   */
  colorByAge?: boolean
  /**
   * Render nothing while a duration mode is active. For closed incidents: a
   * running clock on a finished Einsatz reads «19h 40'» the next morning and
   * answers nothing, while its start time stays meaningful forever.
   */
  suppressDurations?: boolean
  /** Drop the leading mode icon (tight wall-display rows that never had one). */
  showIcon?: boolean
  /** `lg` for the detail header, where this is the primary read. */
  size?: 'default' | 'lg'
  className?: string
  iconClassName?: string
}

export function IncidentTime({
  operation,
  readOnly = false,
  colorByAge = false,
  suppressDurations = false,
  showIcon = true,
  size = 'default',
  className,
  iconClassName,
}: IncidentTimeProps) {
  const t = useTranslations('kanban.incidentTime')
  const { mode, setMode } = useIncidentTimeMode()
  useMinuteTick()

  if (suppressDurations && isDurationMode(mode)) return null

  const Icon = INCIDENT_TIME_MODE_ICON[mode]
  const value = formatIncidentTime(operation, mode)
  const ageReference = incidentTimeReference(operation, 'column')

  const tooltip = t(`tooltips.${mode}`, {
    since: incidentTimeReference(operation, mode).toLocaleString('de-CH'),
  })

  // `lg` is for the detail header, where the chip is the primary read and the
  // card-sized version was too quiet to notice. The board keeps the dense one.
  const big = size === 'lg'
  const iconClasses = cn(big ? 'h-4 w-4' : 'h-3.5 w-3.5', 'flex-shrink-0 opacity-70', iconClassName)
  const valueClasses = cn(
    'font-mono tabular-nums',
    big && 'text-base font-semibold',
    colorByAge ? ageChipClass(ageReference) : 'text-muted-foreground',
    className
  )

  if (readOnly) {
    return (
      <span className="inline-flex items-center gap-1" title={tooltip}>
        {showIcon && <Icon className={iconClasses} aria-hidden />}
        <span className={valueClasses}>{value}</span>
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // The kanban card is itself a drag source: without this, grabbing the
          // chip starts a card drag instead of opening the menu. The click must
          // not reach the card either, or the detail panel opens behind it.
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          // Deliberately identical geometry to the readOnly branch above: same
          // gap, no padding, no chevron. The indicator has to read the same on
          // the operator board as it does on the wall boards, where it is a
          // static label — a chevron and a padded pill made the same number
          // look like a different thing depending on which screen you were at.
          //
          // That the chip is clickable is therefore unadvertised, and that is
          // the intent: switching what the board measures is a deliberate,
          // rare, board-wide act, not something to invite mid-incident. The
          // tooltip names the current mode for anyone who hovers.
          // Padding with matching negative margins: the hover highlight gets
          // room to sit around the value instead of clamping onto the glyphs,
          // while the element still OCCUPIES the same box as the static chip on
          // the wall boards — the padding is paid back by the margin, so
          // nothing beside it moves.
          className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 -mx-1.5 -my-1 transition-colors hover:bg-muted/60"
          title={tooltip}
          aria-label={`${t(`modes.${mode}`)}: ${value}`}
        >
          {showIcon && <Icon className={iconClasses} aria-hidden />}
          <span className={valueClasses}>{value}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" onClick={(e) => e.stopPropagation()}>
        {INCIDENT_TIME_MODES.map((m) => {
          const ModeIcon = INCIDENT_TIME_MODE_ICON[m]
          return (
            <DropdownMenuItem key={m} onSelect={() => setMode(m)} className="cursor-pointer gap-2">
              <ModeIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className="flex-1">{t(`modes.${m}`)}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatIncidentTime(operation, m)}
              </span>
              {mode === m && <Check className="h-3.5 w-3.5" aria-hidden />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface IncidentTimeRowProps extends Omit<IncidentTimeProps, 'className'> {
  className?: string
  /** Classes for the always-present start time on the left. */
  startClassName?: string
  /** Classes for the mode chip on the right. */
  chipClassName?: string
  /** Classes for the leading clock icon of the start time. */
  startIconClassName?: string
}

/**
 * The «HH:MM … 12'» pair the card-shaped surfaces all render: when the incident
 * came in on the left, the active mode's chip on the right.
 *
 * In `start` mode the two would be the same number twice, so the pair collapses
 * into the single chip — which then carries the dropdown (or, `readOnly`, just
 * the tooltip) and stays where the start time always was.
 */
export function IncidentTimeRow({
  operation,
  className,
  startClassName,
  chipClassName,
  startIconClassName,
  ...chipProps
}: IncidentTimeRowProps) {
  const { mode } = useIncidentTimeMode()
  useMinuteTick()

  const collapsed = mode === 'start'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {collapsed ? (
        <IncidentTime operation={operation} {...chipProps} className={cn('text-sm', startClassName)} />
      ) : (
        <>
          <span className="flex items-center gap-2">
            <Clock className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground', startIconClassName)} aria-hidden />
            <span className={cn('font-mono text-sm text-muted-foreground', startClassName)}>
              {formatClockTime(operation.dispatchTime)}
            </span>
          </span>
          <IncidentTime operation={operation} {...chipProps} className={cn('text-xs', chipClassName)} />
        </>
      )}
    </div>
  )
}

export type { IncidentTimeMode }
