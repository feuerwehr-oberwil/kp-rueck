import { Skeleton } from '@/components/ui/skeleton'

/**
 * What a cold navigation shows until the route's own content is ready.
 *
 * Route-level and therefore shape-agnostic: it stands in for the board, the map,
 * settings and everything else, so it says "content is coming" and nothing more
 * specific — a placeholder in the shape of one page would be a lie on the next.
 * A heading strip and a few ragged rows, no spinner and no wording: it is
 * wordless on purpose (nothing to translate, nothing to read under pressure),
 * and `animate-pulse` on `bg-muted` is the same quiet placeholder the sidebars
 * and settings already use.
 */
export default function Loading() {
  return (
    <div className="h-full p-4 sm:p-6" role="status" aria-busy="true">
      <Skeleton className="mb-6 h-6 w-48 rounded" />
      <div className="space-y-3">
        {/* Uneven widths on purpose: an evenly striped block reads as a pattern,
            a ragged one reads as content that has not arrived. */}
        {[86, 64, 92, 71, 48].map((width, row) => (
          <Skeleton key={row} className="h-11 rounded-lg" style={{ width: `${width}%` }} />
        ))}
      </div>
    </div>
  )
}
