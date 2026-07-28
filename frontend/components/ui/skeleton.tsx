import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      // `bg-accent` is the blue accent in this theme — a loading placeholder
      // that flashes blue reads as something happening, not as "wait".
      // Neutral, matching the hand-rolled skeletons this primitive replaced.
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }
