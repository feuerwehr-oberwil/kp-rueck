'use client'

import { useTheme } from 'next-themes'
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
      className="fixed bottom-2 right-4 z-[9999] rounded-md border border-border bg-popover px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
    >
      Alle schliessen
    </button>
  )
}

export { Toaster, DismissAllToasts }
