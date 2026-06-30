'use client'

import { useTheme } from 'next-themes'
import { X } from 'lucide-react'
import { Toaster as Sonner, ToasterProps, useSonner, toast } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      duration={5000}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

const DismissAllToasts = () => {
  const { toasts } = useSonner()

  if (toasts.length <= 1) return null

  return (
    // Lifted clear of the bottom footer/nav and styled as a solid pill so it
    // reads as a button instead of floating muted text over the footer.
    <button
      type="button"
      onClick={() => toast.dismiss()}
      className="fixed bottom-16 right-4 z-[9999] inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur-sm transition-colors hover:text-foreground hover:bg-card"
    >
      <X className="h-3.5 w-3.5" />
      Alle schliessen
    </button>
  )
}

export { Toaster, DismissAllToasts }
