import type { Subject } from '@/lib/incident-types'

export type { Subject }

/**
 * The «Einsatzzeile» under a window's title (owner pick #14, 23.11.2026): the number in muted
 * mono, a middle dot, the place in 14/500 – «14 · Hauptstrasse 4», as the prompts' cards name it.
 * `ConfirmDialog` and `PickerDialog` draw it for their `subject` prop, so every
 * question about one Einsatz names it the same way and in the same place.
 */
export function SubjectLine({ subject }: { subject: Subject }) {
  const full = subject.number != null ? `${subject.number} · ${subject.place}` : subject.place
  return (
    <p className="mt-0.5 line-clamp-2 break-words text-sm font-medium text-foreground" title={full} data-testid="dialog-subject">
      {subject.number != null && (
        <>
          <span className="font-mono text-xs font-medium text-muted-foreground">{subject.number}</span>
          <span className="text-muted-foreground"> · </span>
        </>
      )}
      {subject.place}
    </p>
  )
}
