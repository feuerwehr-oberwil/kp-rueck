"use client"

import { useTranslations } from "next-intl"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { type Person, type Material } from "@/lib/contexts/operations-context"
import { usePersonNaming } from "@/components/person-name"
import type { OccupancyLabel } from "@/components/kanban/assignment-list-section"

/**
 * The plain «trotzdem zuweisen?» prompts of `ResourceAssignmentDialog`, for a tick the shared
 * Doppelbelegung dialog cannot take: a person with an Ereignis function, and a person or a
 * material flagged busy without a binding to move it off. The dialog holds the pending
 * resource of each (null = closed); confirming ticks it through `add…ToSelection`.
 */
export function AssignmentConfirmDialogs({
  confirmPerson,
  setConfirmPerson,
  specialFunctionLabels,
  confirmMaterial,
  setConfirmMaterial,
  materialElsewhereLabel,
  confirmOccupiedPerson,
  setConfirmOccupiedPerson,
  personElsewhereLabel,
  addPersonToSelection,
  addMaterialToSelection,
}: {
  confirmPerson: Person | null
  setConfirmPerson: (person: Person | null) => void
  specialFunctionLabels: (person: Person) => string[]
  confirmMaterial: Material | null
  setConfirmMaterial: (material: Material | null) => void
  materialElsewhereLabel: (material: Material) => OccupancyLabel | null
  confirmOccupiedPerson: Person | null
  setConfirmOccupiedPerson: (person: Person | null) => void
  personElsewhereLabel: (person: Person) => OccupancyLabel | null
  addPersonToSelection: (person: Person) => void
  addMaterialToSelection: (materialId: string) => void
}) {
  const t = useTranslations('kanban')
  const naming = usePersonNaming()

  return (
    <>
      {/* Double-booking guard: assigning a driver/reko/magazin to crew asks first. */}
      <ConfirmDialog
        open={!!confirmPerson}
        onOpenChange={(o) => !o && setConfirmPerson(null)}
        title={
          confirmPerson
            ? t('assignmentDialog.specialFnConfirmTitle', {
                name: naming.inline(confirmPerson),
                func: specialFunctionLabels(confirmPerson).join(' · '),
              })
            : ''
        }
        description={
          confirmPerson
            ? t('assignmentDialog.specialFnConfirmBody', {
                name: naming.inline(confirmPerson),
                // Every role, so the confirm names what is actually being taken.
                func: specialFunctionLabels(confirmPerson).join(' · '),
              })
            : ''
        }
        cancelText={t('common.cancel')}
        confirmText={t('assignmentDialog.specialFnConfirmAction')}
        // A double booking is chosen by hand, never by Enter (owner pick #3, 23.11.2026).
        initialFocus="cancel"
        onConfirm={() => {
          if (confirmPerson) addPersonToSelection(confirmPerson)
        }}
      />

      {/* Fallback only: the material is flagged as busy but the binding could not
          be resolved to a concrete incident/Auftrag, so there is nothing to move
          it off. Everything resolvable goes to the shared conflict dialog. */}
      <ConfirmDialog
        open={!!confirmMaterial}
        onOpenChange={(o) => !o && setConfirmMaterial(null)}
        title={confirmMaterial ? t('assignmentDialog.occupiedConfirmTitle', { name: confirmMaterial.name }) : ''}
        description={
          confirmMaterial
            ? t('assignmentDialog.occupiedConfirmBody', {
                name: confirmMaterial.name,
                label: materialElsewhereLabel(confirmMaterial)?.full ?? t('assignmentDialog.occupiedElsewhere'),
              })
            : ''
        }
        cancelText={t('common.cancel')}
        confirmText={t('assignmentDialog.occupiedConfirmAction')}
        initialFocus="cancel"
        onConfirm={() => {
          if (confirmMaterial) addMaterialToSelection(confirmMaterial.id)
        }}
      />

      {/* Fallback only — same reasoning as the material confirm above. */}
      <ConfirmDialog
        open={!!confirmOccupiedPerson}
        onOpenChange={(o) => !o && setConfirmOccupiedPerson(null)}
        title={confirmOccupiedPerson ? t('assignmentDialog.occupiedConfirmTitle', { name: naming.inline(confirmOccupiedPerson) }) : ''}
        description={
          confirmOccupiedPerson
            ? t('assignmentDialog.occupiedConfirmBody', {
                name: naming.inline(confirmOccupiedPerson),
                label: personElsewhereLabel(confirmOccupiedPerson)?.full ?? t('assignmentDialog.occupiedElsewhere'),
              })
            : ''
        }
        cancelText={t('common.cancel')}
        confirmText={t('assignmentDialog.occupiedConfirmAction')}
        initialFocus="cancel"
        onConfirm={() => {
          if (confirmOccupiedPerson) addPersonToSelection(confirmOccupiedPerson)
        }}
      />
    </>
  )
}
