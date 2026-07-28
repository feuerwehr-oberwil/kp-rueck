"use client"

import { useTranslations } from "next-intl"
import type { RadioSegment } from "@/lib/radio-announcement"
import { STOP_STATUS_LABEL_KEY, stopStatusTextClass } from "@/lib/kanban-utils"
import { cn } from "@/lib/utils"

/**
 * The Funkdurchsage as it is shown to read aloud: the variable parts
 * (addresses, crew, vehicles) in bold, so the eye finds them at 3am without
 * re-reading the whole line.
 *
 * The numbered stops are a real list, one per line. Run together with commas
 * they read as one address — «Bahnhofstrasse 31, 3. Lettenweg» — which is the
 * one thing a route may not be ambiguous about. Each open stop also carries
 * where it stands, in the same colours as the stop-list pill.
 *
 * There are no quotation marks. A straight " around a block that is now several
 * lines long put a stray mark in the middle of the list; the left rule and the
 * italic say «read this verbatim» without any character having to.
 *
 * The status sits outside that rule, deliberately: it is not part of the
 * sentence, it is not copied, and nobody reads a status code over the radio.
 *
 * Shared by the Disponiert dialog and «Durchsage wiederholen» so the two never
 * render the same sentence differently.
 */
export function RadioQuote({ segments }: { segments: RadioSegment[] }) {
  const t = useTranslations("kanban.stopStatus")

  // Split into lines: a segment marked `newline` opens one, the rest flow on.
  const lines: RadioSegment[][] = []
  for (const segment of segments) {
    if (segment.newline || lines.length === 0) lines.push([segment])
    else lines[lines.length - 1].push(segment)
  }

  return (
    <div className="border-l-2 border-border/70 pl-3 text-sm text-muted-foreground italic leading-relaxed">
      {lines.map((line, lineIndex) => {
        const status = line.find((segment) => segment.status)?.status
        // Stop lines are the bold ones and get the hanging indent; the trailing
        // «Besonderes: …» line is a sentence again and stays flush.
        const isStopLine = Boolean(line[0]?.bold)
        return (
          <p
            key={lineIndex}
            className={cn("flex items-baseline gap-2", lineIndex > 0 && isStopLine && "pl-3")}
          >
            <span className="min-w-0">
              {line.map((segment, index) =>
                segment.bold ? (
                  <span key={index} className="font-semibold text-foreground">{segment.text}</span>
                ) : (
                  <span key={index}>{segment.text}</span>
                ),
              )}
            </span>
            {status && (
              <span className={cn("shrink-0 text-xs font-medium not-italic", stopStatusTextClass(status))}>
                {t(STOP_STATUS_LABEL_KEY[status])}
              </span>
            )}
          </p>
        )
      })}
    </div>
  )
}
