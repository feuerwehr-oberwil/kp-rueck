"use client"

import type { RadioSegment } from "@/lib/radio-announcement"

/**
 * The Funkdurchsage as it is shown to read aloud: one quoted sentence with the
 * variable parts (addresses, crew, vehicles) in bold, so the eye finds them at
 * 3am without re-reading the whole line.
 *
 * Shared by the Disponiert dialog and «Durchsage wiederholen» so the two never
 * render the same sentence differently.
 */
export function RadioQuote({ segments }: { segments: RadioSegment[] }) {
  return (
    <p className="text-sm text-muted-foreground italic leading-relaxed">
      &quot;
      {segments.map((segment, index) =>
        segment.bold ? (
          <span key={index} className="font-semibold text-foreground">{segment.text}</span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
      &quot;
    </p>
  )
}
