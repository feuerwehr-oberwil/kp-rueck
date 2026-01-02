"use client"

import { Loader2 } from "lucide-react"

export function KanbanLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Einsätze werden geladen...</span>
      </div>
    </div>
  )
}