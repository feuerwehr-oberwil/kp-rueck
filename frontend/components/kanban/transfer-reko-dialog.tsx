"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowLeft } from "lucide-react"
import { PickerDialog } from "@/components/ui/picker-dialog"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { FormMessage } from "@/components/ui/form-message"
import { ShellLoader } from "@/components/ui/shell-loader"
import { PersonPickTile } from "@/components/kanban/assignment-list-section"
import { einsatzWhere, usePersonTileFacts } from "@/components/kanban/person-tile-facts"
import { type Person } from "@/lib/contexts/personnel-context"
import { apiClient } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations } from "@/lib/contexts/operations-context"
import { MarkRekoRow, REKO_PICK_MESSAGE_ID, useRekoCandidatePicker } from "@/components/incidents/assign-reko-dialog"
import { toast } from "sonner"

interface TransferRekoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fromPerson: Person | null
  rekoPersonnel: Person[]
  onTransferred: () => void
}

/**
 * «Rekos übertragen»: hand all open Reko-Aufträge of `fromPerson` to another person – the
 * other Reko people as person tiles (ENT-10 A) with their «where · roles» line, one to
 * choose (radio dot), «Übernehmen» transfers.
 * «Person als Reko markieren» lists the checked-in people who are not Reko yet; the ticked
 * one is marked first, then gets the Rekos. A bottom sheet on the phone (`PickerDialog`).
 */
export function TransferRekoDialog({
  open,
  onOpenChange,
  fromPerson,
  rekoPersonnel,
  onTransferred,
}: TransferRekoDialogProps) {
  const t = useTranslations('kanban')
  const tAssign = useTranslations('incidents.assignReko')
  const tPick = useTranslations('common.personPick')
  const { selectedEvent } = useEvent()
  const { personnel, operations, refreshOperations } = useOperations()
  const factsOf = usePersonTileFacts()
  const [isTransferring, setIsTransferring] = useState(false)
  const [markMode, setMarkMode] = useState(false)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [pickMessage, setPickMessage] = useState<string | null>(null)
  const [uncertainPersonnelIds, setUncertainPersonnelIds] = useState<ReadonlySet<string>>(new Set())
  const mark = useRekoCandidatePicker({ personnel, operations, excludedPersonnelIds: uncertainPersonnelIds, disabled: isTransferring })
  const resetMark = mark.reset

  useEffect(() => {
    if (!open) return
    setMarkMode(false)
    setChosenId(null)
    setPickMessage(null)
    resetMark()
  }, [open, resetMark])

  if (!fromPerson) return null

  // Filter out the source person from target list
  const targetOptions = rekoPersonnel.filter(p => p.id !== fromPerson.id)

  const handleTransfer = async (toPerson: Person) => {
    if (!selectedEvent) return
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

  /** «Übernehmen»: transfer to the ticked person (marking them Reko first in the mark
   *  list). Nothing ticked is said above the list, never a greyed-out button. */
  const applyChoice = async () => {
    const target = markMode ? mark.chosen : targetOptions.find((person) => person.id === chosenId) ?? null
    if (!target) {
      setPickMessage(tPick('noneChosen'))
      return
    }
    setIsTransferring(true)
    try {
      await (markMode ? handleMarkAndTransfer(target) : handleTransfer(target))
    } finally {
      setIsTransferring(false)
    }
  }

  const switchMode = (next: boolean) => {
    setMarkMode(next)
    setPickMessage(null)
  }

  return (
    <PickerDialog
      open={open}
      onOpenChange={onOpenChange}
      title={markMode ? tAssign('markExisting') : t('transferReko.title')}
      description={t('transferReko.description', { name: fromPerson.name })}
      radioGroupLabel={markMode ? tAssign('markExisting') : t('transferReko.title')}
      toolbar={
        <>
          {markMode ? (
            <>
              <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => switchMode(false)}>
                <ArrowLeft className="size-3.5" />
                {tAssign('back')}
              </Button>
              {mark.searchField}
            </>
          ) : (
            <MarkRekoRow onClick={() => switchMode(true)} />
          )}
          <FormMessage id={REKO_PICK_MESSAGE_ID}>{pickMessage}</FormMessage>
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isTransferring}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void applyChoice()} disabled={isTransferring}>
            {isTransferring && <ShellLoader className="size-4" />}
            {tPick('apply')}
          </Button>
        </>
      }
    >
      {markMode ? (
        mark.list
      ) : targetOptions.length === 0 ? (
        <EmptyState compact title={t('transferReko.noOthers')} />
      ) : (
        targetOptions.map((person) => {
          // Every target is Reko – «Reko» on each tile would say nothing.
          const { where, roles, plan } = factsOf(person, { elsewhere: einsatzWhere(person.id, operations), omitReko: true })
          return (
            <PersonPickTile
              key={person.id}
              name={person.name}
              personnelId={person.id}
              kennung={person.kennung ?? null}
              rank={person.role}
              where={where}
              roles={roles}
              plan={plan}
              single
              checked={chosenId === person.id}
              disabled={isTransferring}
              onClick={() => {
                setChosenId((current) => (current === person.id ? null : person.id))
                setPickMessage(null)
              }}
            />
          )
        })
      )}
    </PickerDialog>
  )
}
