"use client"

import { Skeleton } from "@/components/ui/skeleton"

export function KanbanLoading() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {/* Create 6 columns for the 6 statuses */}
      {[...Array(6)].map((_, columnIndex) => (
        <div key={columnIndex} className="space-y-3">
          {/* Column header skeleton */}
          <div className="flex items-center justify-between px-3 py-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>

          {/* Operation cards skeleton - show 2-3 cards per column */}
          {[...Array(columnIndex === 0 ? 3 : columnIndex === 1 ? 2 : 1)].map((_, cardIndex) => (
            <div key={cardIndex} className="p-4 rounded-lg border bg-card/50">
              <div className="space-y-3">
                {/* Header with priority and location */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1">
                    <Skeleton className="h-2.5 w-2.5 rounded-full mt-1" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded-md" />
                </div>

                {/* Incident type */}
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-28" />
                </div>

                {/* Time info */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-3 w-16" />
                </div>

                {/* Optional crew/vehicle badges */}
                {cardIndex === 0 && (
                  <div className="flex items-start gap-2">
                    <Skeleton className="h-4 w-4 mt-0.5" />
                    <div className="flex flex-wrap gap-1.5">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}