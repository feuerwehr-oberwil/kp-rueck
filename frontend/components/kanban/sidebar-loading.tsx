"use client"

import { Skeleton } from "@/components/ui/skeleton"

export function PersonnelSidebarLoading() {
  return (
    <div className="space-y-4">
      {/* Show 3 role groups */}
      {[...Array(3)].map((_, groupIndex) => (
        <div key={groupIndex}>
          {/* Role header skeleton */}
          <Skeleton className="h-4 w-20 mb-2" />

          {/* Personnel items */}
          <div className="space-y-2">
            {[...Array(groupIndex === 0 ? 4 : groupIndex === 1 ? 3 : 2)].map((_, itemIndex) => (
              <div key={itemIndex} className="flex items-center gap-2 p-2 rounded border bg-card/50">
                <Skeleton className="h-2 w-2 rounded-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12 ml-auto rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function MaterialSidebarLoading() {
  return (
    <div className="space-y-4">
      {/* Show 2 category groups */}
      {[...Array(2)].map((_, groupIndex) => (
        <div key={groupIndex}>
          {/* Category header skeleton */}
          <Skeleton className="h-4 w-24 mb-2" />

          {/* Material items */}
          <div className="space-y-2">
            {[...Array(groupIndex === 0 ? 3 : 2)].map((_, itemIndex) => (
              <div key={itemIndex} className="flex items-center gap-2 p-2 rounded border bg-card/50">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}