import { telHref } from '@/lib/phone'
import { cn } from '@/lib/utils'

/**
 * The Melder as somebody on a phone rings them: ONE `tel:` link, the name on one
 * line and the number whole on the next (nowrap, tabular figures, 4px gap). Run
 * together, «061 111 11 11» broke after «111» and left «11 11» alone on a line.
 * At least 44px tall, so a number on its own is still a phone-sized target.
 *
 * Used by /feld's briefing and the phone Einsatz sheet. Pass only `phone` when the
 * name is drawn (and tapped to edit) by the caller. A number with nothing to dial
 * (a note, «–») renders as plain text instead of a dead link (`telHref`).
 */
export function MelderLink({ contact, phone, className }: { contact?: string | null; phone: string; className?: string }) {
  const href = telHref(phone)
  const lines = (
    <>
      {contact && <span className={cn('break-words', href && 'underline underline-offset-2')}>{contact}</span>}
      <span className={cn('whitespace-nowrap tabular-nums', href && 'underline underline-offset-2')}>{phone}</span>
    </>
  )
  const frame = cn('inline-flex min-h-11 max-w-full flex-col justify-center gap-1 text-foreground', className)
  if (!href) return <span className={frame}>{lines}</span>
  return (
    // The «·» keeps the accessible name one phrase, as it was before the split.
    <a href={href} aria-label={contact ? `${contact} · ${phone}` : undefined} className={frame}>
      {lines}
    </a>
  )
}
