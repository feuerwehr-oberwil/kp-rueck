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
    <button
      type="button"
      onClick={() => toast.dismiss()}
      className="fixed bottom-1 right-4 z-[9999] inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground/80 transition-colors hover:text-foreground"
    >
      <X className="h-3 w-3" />
      Alle schliessen
    </button>
  )
}

export { Toaster, DismissAllToasts }
