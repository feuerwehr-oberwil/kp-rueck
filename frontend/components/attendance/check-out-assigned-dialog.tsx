'use client'

import { useTranslations } from 'next-intl'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/**
 * «{name} ist noch zugewiesen – trotzdem auschecken?»: the one question before a person who is
 * still bound goes home. Asked by the Appell (`attendance-modal.tsx`) and the person popover
 * (`components/board/person-popover.tsx`). It warns and proceeds; the assignment stays.
 */
export function CheckOutAssignedDialog({
  open,
  onOpenChange,
  name,
  where,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  /** What the person is still on, as the surface names it («14 · Talstrasse 25»). Empty when
   *  the surface does not know yet (a refused check-out it had not caught up with): the
   *  question then says only that they are still bound. */
  where: string
  onConfirm: () => Promise<void> | void
}) {
  const t = useTranslations('kanban.attendance')
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={open ? t('assignedTitle', { name }) : ''}
      description={open ? (where ? t('assignedDescription', { name, where }) : t('assignedDescriptionUnknown', { name })) : ''}
      confirmText={t('checkOutAnyway')}
      onConfirm={onConfirm}
    />
  )
}
