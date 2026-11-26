"use client"

import { useTranslations } from "next-intl"
import { X } from "lucide-react"
import { EmptyState, type EmptyStateAction } from "@/components/ui/empty-state"
import { getActiveLocale } from "@/lib/i18n-messages"
import type { AssignmentFilters, AssignmentResource } from "@/components/kanban/assignment-filters"

/**
 * Why the list of `ResourceAssignmentDialog` is empty, and the one way out — never a big icon.
 * Draws nothing while `filters.emptyReason` is null. `onClose` closes the dialog before
 * `onShowCheckIn` opens the check-in link (an empty crew pool only).
 */
export function AssignmentEmptyState({
  filters,
  resourceType,
  assignTarget,
  assignedVehicleIds,
  onClose,
  onShowCheckIn,
}: {
  filters: AssignmentFilters
  resourceType: AssignmentResource | null
  assignTarget: 'incident' | 'route'
  assignedVehicleIds: string[]
  onClose: () => void
  onShowCheckIn?: () => void
}) {
  const t = useTranslations('kanban')
  const tEmpty = useTranslations('common.emptyState')
  const { emptyReason, query, activeFilterLabels, showOnlyAssignedVehicles, clearSearch, resetFilters } = filters

  /** The empty list's title, line and one way out — per reason (see `emptyReason`). */
  const emptyContent = (() => {
    if (!emptyReason) return null
    if (emptyReason === 'none') {
      if (resourceType === 'crew') {
        return {
          title: t('assignmentDialog.noneCrewTitle'),
          description: t('assignmentDialog.noneCrewBody'),
          action: onShowCheckIn
            ? ({
                label: t('assignmentDialog.showCheckInLink'),
                // Closed the normal way first (the board's close handler resumes
                // any status gate), then the sheet with the link opens.
                onClick: () => {
                  onClose()
                  onShowCheckIn()
                },
              } satisfies EmptyStateAction)
            : undefined,
        }
      }
      return resourceType === 'vehicles'
        ? { title: t('assignmentDialog.noneVehiclesTitle'), description: t('assignmentDialog.noneVehiclesBody') }
        : { title: t('assignmentDialog.noneMaterialsTitle'), description: t('assignmentDialog.noneMaterialsBody') }
    }
    if (emptyReason === 'search') {
      return {
        title: tEmpty('noHitsFor', { query }),
        description:
          resourceType === 'crew' ? t('assignmentDialog.searchScopeCrew')
            : resourceType === 'vehicles' ? t('assignmentDialog.searchScopeVehicles')
              : t('assignmentDialog.searchScopeMaterials'),
        action: { label: tEmpty('clearSearch'), onClick: clearSearch, icon: X } satisfies EmptyStateAction,
      }
    }
    // A filter hides it all. Name the filter — «Keine Treffer» alone sends the
    // operator hunting for which of four chip rows did it.
    const filterList = new Intl.ListFormat(getActiveLocale(), { type: 'conjunction' }).format(
      activeFilterLabels.map((name) => tEmpty('quoted', { name })),
    )
    const noun =
      resourceType === 'crew' ? t('assignmentDialog.nounCrew')
        : resourceType === 'vehicles' ? t('assignmentDialog.nounVehicles')
          : t('assignmentDialog.nounMaterials')
    const onlyAssignedNothingYet =
      resourceType === 'vehicles' && showOnlyAssignedVehicles && activeFilterLabels.length === 1 && assignedVehicleIds.length === 0 && !query
    return {
      title: tEmpty('noHits'),
      description: onlyAssignedNothingYet
        ? t(assignTarget === 'route' ? 'assignmentDialog.onlyAssignedNoneRoute' : 'assignmentDialog.onlyAssignedNoneIncident')
        : query
          ? t('assignmentDialog.filterHidesSearch', { count: activeFilterLabels.length, filters: filterList, query })
          : t('assignmentDialog.filterHides', { count: activeFilterLabels.length, filters: filterList, noun }),
      action: { label: tEmpty('resetFilters'), onClick: resetFilters, icon: X } satisfies EmptyStateAction,
    }
  })()

  if (!emptyContent) return null
  return (
    <EmptyState
      title={emptyContent.title}
      description={emptyContent.description}
      action={emptyContent.action}
    />
  )
}
