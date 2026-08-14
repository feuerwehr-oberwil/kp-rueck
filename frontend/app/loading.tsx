import { Loader2 } from 'lucide-react'

/**
 * What a cold navigation shows until the route's own content is ready.
 *
 * A spinner, deliberately, and not a skeleton. Route-level means this stands in
 * for the board, the map, settings and everything else — and most of those are
 * not lists of cards, so a placeholder in the shape of one page would be wrong
 * on the next. Keeping a skeleton honest would mean maintaining a second copy of
 * every layout; a spinner says «content is coming» and claims nothing about what
 * shape it will take.
 *
 * Wordless on purpose: nothing to translate, and nothing to read under pressure.
 */
export default function Loading() {
  return (
    <div
      className="flex h-full items-center justify-center p-6"
      role="status"
      aria-busy="true"
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}
