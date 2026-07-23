'use client'

import { type ReactNode, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  onConfirm: () => Promise<void> | void
  confirmText?: string
  cancelText?: string
  /** `destructive` tints the confirm button red (delete/deactivate). */
  variant?: 'default' | 'destructive'
  /** Optional content between the description and the footer (e.g. a list of
   *  affected items). Keep it short — this is a confirmation, not a form. */
  children?: ReactNode
}

/**
 * The single confirmation modal for the app. Encapsulates the AlertDialog
 * footer order (Cancel then Action), the spinner-plus-disabled loading state,
 * and destructive tinting — the pattern that was re-hand-rolled in ~half a
 * dozen inline AlertDialogs (driver conflicts, special-function assign, user
 * deactivate/delete, settings import). `DeleteConfirmDialog` is this with
 * `variant="destructive"`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmText,
  cancelText,
  variant = 'default',
  children,
}: ConfirmDialogProps) {
  const t = useTranslations('common.deleteConfirmDialog')
  const [isConfirming, setIsConfirming] = useState(false)

  const handleConfirm = async () => {
    setIsConfirming(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setIsConfirming(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isConfirming}>{cancelText ?? t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleConfirm()
            }}
            disabled={isConfirming}
            className={cn(buttonVariants({ variant }))}
          >
            {isConfirming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmText ?? t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
