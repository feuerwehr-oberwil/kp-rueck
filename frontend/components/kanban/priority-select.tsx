"use client"

/**
 * The Priorität picker of «Neuer Einsatz» and of the detail's Übersicht – one
 * component, because the two forms share one field order (and so one field).
 *
 * The word comes with the board's priority shape before it (hill climb r16):
 * chevron up / dash / chevron down, drawn by the Lagekarte's
 * `priorityGlyphPath` – the mark the board card, the map and both walls draw –
 * so the picker reads like every other place a priority shows. The mark wears
 * the MARK colour (`PRIORITY_TEXT_CLASSES`: Hoch red, Mittel amber, Niedrig the
 * light slate grey); the trigger's chrome stays neutral, because red means
 * priority and danger, never the control. The glyph sits inside the item text,
 * so the closed trigger (Radix copies the chosen item's text into `SelectValue`)
 * and the open list draw the same thing.
 *
 * Usage: `<PrioritySelect value={p} onValueChange={setP} id="priority" className="w-full" />`
 */

import type { ComponentProps } from "react"
import { useTranslations } from "next-intl"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { priorityGlyphPath } from "@/lib/map-priority"
import { PRIORITY_TEXT_CLASSES, type Priority } from "@/lib/priority"
import { cn } from "@/lib/utils"

/** Picker order: from the default up. */
const PRIORITIES = ["low", "medium", "high"] as const satisfies readonly Priority[]

const PRIORITY_LABEL_KEYS = {
  low: "common.priorityLow",
  medium: "common.priorityMedium",
  high: "common.priorityHigh",
} as const satisfies Record<Priority, string>

/** The 14px mark: a 10×5 shape at a 1.75px round stroke (viewBox = px). Decorative – the word beside it names the priority. */
function PriorityGlyph({ priority }: { priority: Priority }) {
  return (
    <svg
      viewBox="0 0 14 14"
      data-slot="priority-glyph"
      aria-hidden="true"
      className={cn("size-3.5", PRIORITY_TEXT_CLASSES[priority])}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={priorityGlyphPath(priority, 7, 7, 1.25)} />
    </svg>
  )
}

export function PrioritySelect({
  value,
  onValueChange,
  disabled,
  ...triggerProps
}: {
  value: Priority
  onValueChange: (priority: Priority) => void
  disabled?: boolean
} & Pick<ComponentProps<typeof SelectTrigger>, "id" | "className" | "tabIndex">) {
  const t = useTranslations("kanban")
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onValueChange(PRIORITIES.find((p) => p === next) ?? value)}
    >
      <SelectTrigger {...triggerProps}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((priority) => (
          <SelectItem key={priority} value={priority}>
            {/* Own row for the 6px gap: the item's and the trigger's rows space by 8px. */}
            <span className="flex items-center gap-1.5">
              <PriorityGlyph priority={priority} />
              {t(PRIORITY_LABEL_KEYS[priority])}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
