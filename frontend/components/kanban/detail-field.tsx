"use client"

/**
 * One field of the incident detail, in the two shapes the two mounts need.
 *
 * The modal has room for the classic form: label above, control below, generous
 * spacing. The side panel has 420 pixels and is *read* far more often than it is
 * typed into — there it renders `Label │ Wert` on one line, the control itself
 * drawn without a box so it reads as text until you put the cursor in it.
 *
 * Deliberately NOT click-to-edit. A row that turns into an input on click costs
 * a click on every correction and needs a mode to leave again; a borderless
 * control costs nothing, keeps the keyboard path (tab in, type), and stays the
 * same control in both mounts — so every field has exactly one implementation
 * and there is no second rendering to drift.
 *
 * One field per line, Einsatzart and Priorität included: two half-width controls
 * sharing a row is how «Mittel» gets read as the Einsatzart.
 */

import type { ReactNode } from "react"

import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/** The dense mount's control skin: no box until it has focus. */
export const DENSE_CONTROL =
  "h-7 min-h-7 rounded-md border-0 bg-transparent px-1 shadow-none hover:bg-input/50 " +
  "focus-visible:bg-input focus-visible:px-2 dark:bg-transparent dark:hover:bg-input/50 dark:focus-visible:bg-input"

interface DetailFieldProps {
  label: string
  /** Row layout (side panel) instead of the stacked form (modal). */
  dense: boolean
  htmlFor?: string
  /** Only in the stacked form — a row has no space for a second sentence, so
   *  the dense mount hands it to the label's `title` instead. */
  description?: string
  /** Trailing element on the label line: the «Anrufen» link, a count. */
  action?: ReactNode
  /** Textareas and anything else that must not be centred against its label. */
  alignStart?: boolean
  className?: string
  children: ReactNode
}

export function DetailField({
  label,
  dense,
  htmlFor,
  description,
  action,
  alignStart = false,
  className,
  children,
}: DetailFieldProps) {
  if (dense) {
    return (
      <div
        className={cn(
          "flex gap-2 border-b border-border/50 py-1",
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

  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor} className="text-sm font-semibold text-muted-foreground">
          {label}
        </Label>
        {action}
      </div>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      {children}
    </div>
  )
}

/**
 * A yes/no property of the incident (telefonisch gemeldet, Nachbarhilfe, Am
 * Warten) with the note that only exists while it is on.
 *
 * The stacked mount keeps the bordered card and its explanatory sentence — it is
 * a decision with a consequence and the modal has room to say so. The dense
 * mount is one line: label, switch, note underneath.
 */
export function DetailToggle({
  label,
  description,
  dense,
  icon,
  checked,
  onToggle,
  disabled,
  note,
}: {
  label: string
  description: string
  dense: boolean
  icon: ReactNode
  checked: boolean
  onToggle: (next: boolean) => void
  disabled?: boolean
  /** Rendered under the row while `checked` — the "warum" input. */
  note?: ReactNode
}) {
  const control = (
    <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onToggle} />
  )

  if (dense) {
    return (
      <div className="border-b border-border/50 py-1">
        <div
          className="flex cursor-pointer items-center gap-2 select-none"
          onClick={() => !disabled && onToggle(!checked)}
        >
          <span
            title={description}
            className="flex w-[104px] shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
          >
            {icon}
            {label}
          </span>
          <div className="min-w-0 flex-1" />
          <div onClick={(event) => event.stopPropagation()}>{control}</div>
        </div>
        {checked && note && <div className="mt-1 pl-[112px]">{note}</div>}
      </div>
    )
  }

  return (
    <div
      className="cursor-pointer space-y-3 rounded-lg border border-border p-4 select-none"
      onClick={() => !disabled && onToggle(!checked)}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <Label className="pointer-events-none text-sm font-semibold">{label}</Label>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div onClick={(event) => event.stopPropagation()}>{control}</div>
      </div>
      {checked && note}
    </div>
  )
}
