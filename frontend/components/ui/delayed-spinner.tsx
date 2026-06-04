"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface DelayedSpinnerProps {
  /** Wait this long before showing anything, so fast loads never flash a spinner. */
  delay?: number
  /** Optional caption under the spinner. */
  label?: string
  /** Icon size in px. */
  size?: number
  /** Fill the parent's height and center (default). Set false for inline use. */
  fullHeight?: boolean
  className?: string
}

/**
 * A spinner that only appears once loading has taken longer than `delay`
 * (300ms by default). Sub-perceptual loads resolve before anything renders,
 * so the UI feels instant instead of flickering a spinner on every fetch.
 */
export function DelayedSpinner({
  delay = 300,
  label,
  size = 24,
  fullHeight = true,
  className,
}: DelayedSpinnerProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  if (!visible) return null

  return (
    <div
      className={cn(
        "flex items-center justify-center animate-in fade-in duration-200",
        fullHeight && "h-full",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="animate-spin" style={{ width: size, height: size }} />
        {label && <span className="text-sm">{label}</span>}
      </div>
    </div>
  )
}
