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
 * The dense mount's control skin: no box until it has focus.
 *
 * The border is *transparent*, not absent, and the padding does not change on
 * focus. Both matter: a control that grows a border or a wider gutter when
 * clicked moves its own text out from under the cursor, and every row below it
 * with it. Only the colours change here — the box the text sits in is the same
 * box at rest, on hover and in focus.
 */
export const DENSE_CONTROL =
  "h-7 min-h-7 rounded-md border border-transparent bg-transparent px-2 shadow-none " +
  "hover:bg-input/50 focus-visible:bg-input dark:bg-transparent dark:hover:bg-input/50 dark:focus-visible:bg-input"

interface DetailFieldProps {
  label: string
  htmlFor?: string
  /** Hover/`title` hint — a row has no second line for a sentence. */
  description?: string
  /** Trailing element on the row: the «Anrufen» link, a count. */
  action?: ReactNode
  /** Textareas and anything else that must not be centred against its label. */
  alignStart?: boolean
  className?: string
  children: ReactNode
}

export function DetailField({
  label,
  htmlFor,
  description,
  action,
  alignStart = false,
  className,
  children,
}: DetailFieldProps) {
  return (
    <div
      className={cn(
        "flex gap-2 py-1",
        alignStart ? "items-start" : "items-center",
        className,
      )}
    >
      <Label
        htmlFor={htmlFor}
        title={description}
        className={cn(
          "w-[104px] shrink-0 text-xs font-normal text-muted-foreground",
          alignStart && "pt-1.5",
        )}
      >
        {label}
      </Label>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
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
  description: string
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
        {/* No fixed label column: a toggle row has no value beside it, so the
            label may run past where the fields line up rather than wrap
            «Telefonisch gemeldet» onto two lines. */}
        <span
          title={description}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
        >
          {icon}
          {label}
        </span>
        <div className="min-w-0 flex-1" />
        <div onClick={(event) => event.stopPropagation()}>
          <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onToggle} />
        </div>
      </div>
      {checked && note && <div ref={noteRef} className="mt-1 pl-[112px]">{note}</div>}
    </div>
  )
}
