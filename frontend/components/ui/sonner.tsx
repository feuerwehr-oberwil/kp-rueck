'use client'

import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
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
  const t = useTranslations('common')

  if (toasts.length <= 1) return null

  return (
    // Anchored to the toast stack so its right edge lines up with the toast
    // column: sonner now insets toasts by 16px on the right on all viewports,
    // so match with right-4. bottom-16 tucks the pill just below the stack,
    // clear of the footer/nav.
    <button
      type="button"
      onClick={() => toast.dismiss()}
      className="fixed bottom-12 right-4 z-[9999] inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur-sm transition-colors hover:text-foreground hover:bg-card"
    >
      <X className="h-3.5 w-3.5" />
      {t('dismissAllToasts')}
    </button>
  )
}

export { Toaster, DismissAllToasts }
