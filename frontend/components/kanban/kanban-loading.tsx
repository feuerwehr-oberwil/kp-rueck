"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"

/**
 * Kanban loading state with a 300ms delay to avoid flickering
 * on fast loads. Only shows spinner if loading takes a while.
 */
export function KanbanLoading() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="flex h-full items-center justify-center animate-in fade-in duration-200">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Einsätze werden geladen...</span>
      </div>
    </div>
  )
}
