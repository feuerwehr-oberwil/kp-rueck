'use client'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface DeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => Promise<void> | void
  confirmText?: string
  cancelText?: string
}

/** Destructive confirmation — a thin alias for {@link ConfirmDialog}. */
export function DeleteConfirmDialog(props: DeleteConfirmDialogProps) {
  return <ConfirmDialog {...props} variant="destructive" />
}
