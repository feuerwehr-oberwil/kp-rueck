"use client"

/**
 * One field of the incident detail: `Label │ Wert` on a single line, the control
 * drawn without a box so it reads as text until you put the cursor in it.
 *
 * Both mounts use it. The panel needed it for its 420 pixels; the modal took it
 * because the tall stacked form was not buying anything with its height — a
 * label above every control and a sentence under every switch is a lot of page
 * spent on saying what «Priorität» means. The two mounts differ in their column
 * count now, and in nothing else.
 *
 * Deliberately NOT click-to-edit. A row that turns into an input on click costs
 * a click on every correction and needs a mode to leave again; a borderless
 * control costs nothing, keeps the keyboard path (tab in, type), and stays the
 * same control in both mounts — so every field has exactly one implementation
 * and there is no second rendering to drift.
 *
 * One field per line, Einsatzart and Priorität included: two half-width controls
 * sharing a row is how «Mittel» gets read as the Einsatzart.
 *
 * No hairline under the row — anywhere. Separation is whitespace, grouping is
 * the small grey headings the Übersicht puts over its runs of rows: the same
 * decision the settings made (see setting-row.tsx), where a line between rows
 * said nothing the row break did not already say.
 */

import { useEffect, useRef, type ReactNode } from "react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/**
 * The dense mount's control skin: a quiet box at rest, a solid one in focus.
 *
 * The resting border used to be *transparent* — the row read as text until you
 * put the cursor in it. That went too far: on a panel of fifteen rows nothing
 * said which values could be typed into and which were just printed, so the
 * border is back at half strength and firms up on hover and focus.
 *
 * The padding still does not change, and the border is a colour change rather
 * than an appearing box: a control that grows a border or a wider gutter when
 * clicked moves its own text out from under the cursor, and every row below it
 * with it. The box the text sits in is the same box at rest, on hover and in
 * focus — only its colour moves.
 */
export const DENSE_CONTROL =
  "h-7 min-h-7 rounded-md border border-border/50 bg-transparent px-2 shadow-none transition-colors " +
  "hover:border-border hover:bg-input/50 focus-visible:border-border focus-visible:bg-input " +
  "dark:bg-transparent dark:hover:bg-input/50 dark:focus-visible:bg-input"

interface DetailFieldProps {
  label: string
  htmlFor?: string
  /** Hover/`title` hint — a row has no second line for a sentence. */
  description?: string
  /** Trailing element on the row: the «Anrufen» link, a count. */
  action?: ReactNode
  /** Textareas and anything else that must not be centred against its label. */
  alignStart?: boolean
  /**
   * Marks the field with an asterisk. Only meaningful in the creation dialogs — an
   * existing incident's Übersicht has nothing to require, it already exists.
   */
  required?: boolean
  /** Why the value was refused. Sits under the row, lined up with the control. */
  error?: ReactNode
  /** Anything else under the row at the same indent — a list of hints, a counter. */
  footer?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * Left padding that lines a second line up with the control instead of the label:
 * the 120px label plus the row's 8px gap.
 *
 * Exported because things that lay out their own row rather than being wrapped in one
 * (LocationInput) still need their error to land in the same column.
 */
export const DETAIL_CONTROL_INDENT = "pl-[128px]"

export function DetailField({
  label,
  htmlFor,
  description,
  action,
  alignStart = false,
  required = false,
  error,
  footer,
  className,
  children,
}: DetailFieldProps) {
  return (
    <div className={cn("py-1", className)}>
      <div className={cn("flex gap-2", alignStart ? "items-start" : "items-center")}>
        <Label
          htmlFor={htmlFor}
          title={description}
          className={cn(
            "w-[120px] shrink-0 text-xs font-normal text-muted-foreground",
            alignStart && "pt-1.5",
          )}
        >
          {label}
          {required && (
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </Label>
        <div className="min-w-0 flex-1">{children}</div>
        {action}
      </div>
      {/* `role="alert"` because the row cannot reach the control to set
          `aria-describedby` on it — the shadcn `FormControl` this replaced did
          that from context. Without either, a screen reader announced «ungültig»
          and never the reason. An alert is announced when it appears, which is
          the moment it matters. */}
      {error && (
        <p role="alert" className={cn("mt-1 text-xs text-destructive", DETAIL_CONTROL_INDENT)}>
          {error}
        </p>
      )}
      {footer && <div className={cn("mt-1", DETAIL_CONTROL_INDENT)}>{footer}</div>}
    </div>
  )
}

/**
 * A yes/no property of the incident (telefonisch gemeldet, Nachbarhilfe, Am
 * Warten) with the note that only exists while it is on.
 *
 * One line, both mounts: label, switch, note underneath. The bordered card with
 * its explanatory sentence is gone — three of them in a column said more about
 * the form than about the incident, and the sentence lives on as the label's
 * `title`. Like `DetailField`, the row draws no hairline: whitespace separates,
 * headings group.
 */
export function DetailToggle({
  label,
  description,
  icon,
  checked,
  onToggle,
  disabled,
  note,
  className,
}: {
  label: string
  /** The sentence the bordered card used to spell out, kept as the label's `title`. */
  description?: string
  icon: ReactNode
  checked: boolean
  onToggle: (next: boolean) => void
  disabled?: boolean
  /** Rendered under the row while `checked` — the "warum" input. */
  note?: ReactNode
  className?: string
}) {
  // Switching one of these ON asks a question — «für welche Gemeinde?», «worauf
  // wartet er?» — and the field that answers it appears in the same instant.
  // Focusing it is what turns two actions into one: the operator has already
  // decided, and the next thing they do is type. Only on the transition, never
  // on a re-render, or the detail would steal the cursor while somebody types
  // somewhere else.
  const noteRef = useRef<HTMLDivElement>(null)
  const wasChecked = useRef(checked)
  useEffect(() => {
    if (checked && !wasChecked.current) {
      noteRef.current?.querySelector("input")?.focus()
    }
    wasChecked.current = checked
  }, [checked])

  return (
    <div className={cn("py-1", className)}>
      <div
        className="flex cursor-pointer items-center gap-2 select-none"
        onClick={() => !disabled && onToggle(!checked)}
      >
        {/* The SAME gutter as `DetailField`, so a switch starts exactly where
            the inputs above it start. It was 180px so «Telefonisch gemeldet»
            could not wrap — but that bought one unbroken label at the price of
            the toggles standing in a column of their own, right of every field
            they belong with. The labels lost their “gemeldet” instead: the full
            sentence was always in the `title`, and «Telefonisch» / «Vom Feld»
            answer the question the column asks. */}
        <span
          title={description}
          className="flex w-[120px] shrink-0 items-center gap-1.5 text-xs leading-tight text-muted-foreground"
        >
          {icon}
          {label}
        </span>
        <div onClick={(event) => event.stopPropagation()}>
          <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onToggle} />
        </div>
        {/* The «warum» input stands RIGHT of the switch, not under the row —
            the row stays one line and the question sits next to its answer. */}
        {checked && note ? (
          <div
            ref={noteRef}
            className="min-w-0 flex-1"
            onClick={(event) => event.stopPropagation()}
          >
            {note}
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
      </div>
    </div>
  )
}

/**
 * The small grey heading over a run of detail rows — «Lage», «Meldung»,
 * «Kräfte», «Reko-Auftrag», «Meldungen vom Feld». Since the rows lost their
 * hairlines (the «Nur Abstand» pick), whitespace separates and these headings
 * group; the same decision the settings made, and the same idiom as their
 * `SettingGroup` heading.
 *
 * Shared rather than local to the detail, because the three big blocks the Reko
 * and Feld tabs mount — the Reko report, the field message thread, the
 * Schadenplatz rapport — each used to bring a `text-sm font-medium` heading with
 * a full-size icon. That put two heading weights on every one of those tabs and
 * made two tabs answering the same question look like two different products.
 *
 * `icon` is rendered at the heading's own scale (3.5), never at a control's.
 */
export function DetailGroupHeading({
  icon,
  action,
  children,
}: {
  icon?: ReactNode
  /** The one control that belongs to the heading — «Abbrechen», a state word. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        {icon}
        {children}
      </h3>
      {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
