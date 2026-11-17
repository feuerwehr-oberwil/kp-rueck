import type { ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The pages a phone opens from «Links & QR» — /feld, /check-in, /reko, /alarm — share one frame
 * so they feel like one app, installed or not (owner, 03.10.):
 *
 * - `LinkPageHeader`: ONE header — sticky, opaque (no frosted bar under the status bar), 56px,
 *   the column width of the page, a 44px leading control (back) and a title + context line.
 *   `FeldIdentityBar` is the same bar with the person in it.
 */

/** The height and padding every link-page header shares — `FeldIdentityBar` included. */
export const LINK_PAGE_HEADER_CLASS = 'sticky top-0 z-sticky border-b border-border bg-background'
export const LINK_PAGE_HEADER_ROW_CLASS = 'mx-auto flex min-h-14 max-w-md items-center gap-2 px-3 py-2'

export function LinkPageHeader({
  title,
  subtitle,
  leading,
  trailing,
  className,
}: {
  title: ReactNode
  /** The context line: the Ereignis, «Übung», who is filing. */
  subtitle?: ReactNode
  /** A back button — give it `min-h-11`. */
  leading?: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <header data-slot="link-page-header" className={cn(LINK_PAGE_HEADER_CLASS, className)}>
      <div className={LINK_PAGE_HEADER_ROW_CLASS}>
        {leading}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {trailing}
      </div>
    </header>
  )
}

/**
 * «Link ungültig oder abgelaufen» — the one card a dead link gets on a link page (/alarm, /reko):
 * one message in the reader's words, no toast beside it, and no «Zurück» into a login screen.
 */
export function LinkInvalidCard({ title, description }: { title: ReactNode; description: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
      <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" aria-hidden />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
