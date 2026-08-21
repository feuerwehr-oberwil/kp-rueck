'use client'

import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Toaster as Sonner, ToasterProps, useSonner, toast } from 'sonner'

import { TOAST_LAYER_ATTR } from '@/lib/toast-layer'

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
    // Anchored to the toast stack: 16px from the right, matching the inset the
    // Toaster gives the toasts themselves, and 16px from the bottom so the whole
    // group sits in the corner instead of floating above a band of empty screen.
    // On mobile it clears the fixed tab bar (min 60px + safe area) instead.
    <button
      type="button"
      // Part of the toast layer, but no sonner node – tag it so an open dialog
      // or slide-up does not read this click as "outside" and close itself.
      {...{ [TOAST_LAYER_ATTR]: '' }}
      onClick={() => toast.dismiss()}
      className="fixed bottom-20 right-4 z-[9999] md:bottom-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur-sm transition-colors hover:text-foreground hover:bg-card"
    >
      <X className="h-3.5 w-3.5" />
      {t('dismissAllToasts')}
    </button>
  )
}

export { Toaster, DismissAllToasts }
