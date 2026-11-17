import { toast } from 'sonner'
import { apiClient, ApiError } from '@/lib/api-client'
import { translateOutsideReact } from '@/lib/i18n-messages'

/** Both the delete toast and the event journal recover the same soft-deleted card. */
export async function restoreDeletedIncident(id: string, refresh: () => Promise<void>): Promise<boolean> {
  let alreadyRestored = false
  try {
    if (!await apiClient.restoreIncident(id)) throw new Error('No restore response')
  } catch (error) {
    alreadyRestored = ApiError.isConflictError(error) && error.code === 'incident_already_restored'
    if (!alreadyRestored) {
      toast.error(translateOutsideReact('notifications.operations.restoreFailedTitle'), {
        description: error instanceof ApiError ? error.message : translateOutsideReact('notifications.operations.restoreFailedDescription'),
        action: { label: translateOutsideReact('journal.retry'), onClick: () => void restoreDeletedIncident(id, refresh) },
      })
      return false
    }
  }
  await refresh()
  if (!alreadyRestored) toast.success(translateOutsideReact('notifications.operations.restoredTitle'))
  return true
}
