"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"

function DelayedSpinner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="flex items-center justify-center py-8 animate-in fade-in duration-200">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  )
}

export function PersonnelSidebarLoading() {
  return <DelayedSpinner />
}

export function MaterialSidebarLoading() {
  return <DelayedSpinner />
}
