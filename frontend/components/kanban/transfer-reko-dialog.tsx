"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowLeft, ArrowRightLeft, Binoculars } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { type Person } from "@/lib/contexts/personnel-context"
import { apiClient } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { MarkExistingRekoPersonnel } from "@/components/incidents/assign-reko-dialog"
import { toast } from "sonner"

interface TransferRekoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fromPerson: Person | null
  rekoPersonnel: Person[]
  onTransferred: () => void
}

export function TransferRekoDialog({
  open,
  onOpenChange,
  fromPerson,
  rekoPersonnel,
  onTransferred,
}: TransferRekoDialogProps) {
  const t = useTranslations('kanban')
  const tAssign = useTranslations('incidents.assignReko')
  const { selectedEvent } = useEvent()
  const { personnel, refreshOperations } = useOperations()
  const [isTransferring, setIsTransferring] = useState(false)
  const [markMode, setMarkMode] = useState(false)
  const [uncertainPersonnelIds, setUncertainPersonnelIds] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (open) setMarkMode(false)
  }, [open])

  if (!fromPerson) return null

  // Filter out the source person from target list
  const targetOptions = rekoPersonnel.filter(p => p.id !== fromPerson.id)

  const handleTransfer = async (toPerson: Person) => {
    if (!selectedEvent) return
    setIsTransferring(true)
    try {
      await apiClient.transferRekoAssignments(
        fromPerson.id,
        toPerson.id,
        selectedEvent.id,
      )
      onTransferred()
      onOpenChange(false)
    } catch {
      toast.error(t('transferReko.failed'))
    } finally {
      setIsTransferring(false)
    }
  }

  const handleMarkAndTransfer = async (toPerson: Person) => {
    if (!selectedEvent) return
    let roleAssigned = false
    try {
      await apiClient.assignSpecialFunction(selectedEvent.id, {
        personnel_id: toPerson.id,
        function_type: 'reko',
        vehicle_id: null,
      })
      roleAssigned = true
      await apiClient.transferRekoAssignments(fromPerson.id, toPerson.id, selectedEvent.id)
      onTransferred()
      onOpenChange(false)
    } catch {
      if (roleAssigned) {
        try {
          await apiClient.unassignSpecialFunction(selectedEvent.id, {
            personnel_id: toPerson.id,
            function_type: 'reko',
            vehicle_id: null,
          })
        } catch (rollbackError) {
          console.error('Failed to roll back Reko role assignment:', rollbackError)
          setUncertainPersonnelIds((current) => new Set(current).add(toPerson.id))
          try {
            await refreshOperations()
          } catch (refreshError) {
            console.error('Failed to refresh Reko assignments:', refreshError)
          }
        }
      }
      toast.error(t('transferReko.markAndTransferFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('transferReko.title')}</DialogTitle>
          <DialogDescription>
            {t('transferReko.description', { name: fromPerson.name })}
          </DialogDescription>
        </DialogHeader>

        {markMode ? (
          <div className="space-y-4">
            <MarkExistingRekoPersonnel
              personnel={personnel}
              onSelect={handleMarkAndTransfer}
              excludedPersonnelIds={uncertainPersonnelIds}
            />
            <Button variant="ghost" onClick={() => setMarkMode(false)}>
              <ArrowLeft className="h-4 w-4" />
              {tAssign('back')}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {targetOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('transferReko.noOthers')}
              </p>
            ) : (
              targetOptions.map((person) => (
                <Button
                  key={person.id}
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => handleTransfer(person)}
                  disabled={isTransferring}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  {person.name}
                </Button>
              ))
            )}
            <Button className="w-full gap-2" onClick={() => setMarkMode(true)}>
              <Binoculars className="h-4 w-4" />
              {tAssign('markExisting')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
