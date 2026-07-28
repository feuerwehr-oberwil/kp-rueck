"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { MoreVertical, MoveRight, Eye, Edit, Trash2 } from "lucide-react"
import { type Operation } from "@/lib/contexts/operations-context"

interface MobileOperationActionsProps {
  operation: Operation
  onStatusChange: (newStatus: string) => void
  onView: () => void
  onEdit?: () => void
  onDelete?: () => void
  availableStatuses: Array<{ value: string; label: string }>
}

export function MobileOperationActions({
  operation,
  onStatusChange,
  onView,
  onEdit,
  onDelete,
  availableStatuses,
}: MobileOperationActionsProps) {
  const t = useTranslations('kanban')
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="min-w-[44px] min-h-[44px] md:min-w-[36px] md:min-h-[36px]"
          aria-label={t('mobileActions.openAria')}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{t('mobileActions.title')}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* View Details */}
        <DropdownMenuItem onClick={onView}>
          <Eye className="mr-2 h-4 w-4" />
          {t('mobileActions.viewDetails')}
        </DropdownMenuItem>

        {/* Status Change Options */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">{t('mobileActions.changeStatusTo')}</DropdownMenuLabel>
        {availableStatuses
          .filter(status => status.value !== operation.status)
          .map(status => (
            <DropdownMenuItem
              key={status.value}
              onClick={() => {
                onStatusChange(status.value)
                setOpen(false)
              }}
            >
              <MoveRight className="mr-2 h-4 w-4" />
              {status.label}
            </DropdownMenuItem>
          ))}

        {/* Edit and Delete (if provided) */}
        {(onEdit || onDelete) && <DropdownMenuSeparator />}

        {onEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <Edit className="mr-2 h-4 w-4" />
            {t('common.edit')}
          </DropdownMenuItem>
        )}

        {onDelete && (
          <DropdownMenuItem
            variant="destructive"
            onClick={onDelete}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('common.delete')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
