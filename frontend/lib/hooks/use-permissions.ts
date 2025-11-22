/**
 * Permission Hook
 * Centralized permissions management for role-based access control
 *
 * Usage:
 *   const { canEdit, canDelete, isReadOnly } = usePermissions()
 *
 *   <Button disabled={!canEdit}>Edit</Button>
 *   <Input readOnly={isReadOnly} />
 */

import { useAuth } from '@/lib/contexts/auth-context'

export function usePermissions() {
  const { user, isEditor } = useAuth()

  return {
    // Create permissions
    canCreate: isEditor,
    canCreateIncident: isEditor,
    canCreateEvent: isEditor,
    canCreateResource: isEditor,

    // Edit permissions
    canEdit: isEditor,
    canEditIncident: isEditor,
    canEditEvent: isEditor,
    canEditResource: isEditor,
    canEditSettings: isEditor,

    // Delete permissions
    canDelete: isEditor,
    canDeleteIncident: isEditor,
    canDeleteEvent: isEditor,
    canDeleteResource: isEditor,

    // Assignment permissions
    canAssign: isEditor,
    canAssignResources: isEditor,
    canChangeStatus: isEditor,
    canTransferIncident: isEditor,

    // Special function permissions
    canManageSpecialFunctions: isEditor,
    canAssignDrivers: isEditor,

    // Archive permissions
    canArchive: isEditor,
    canArchiveEvent: isEditor,

    // Drag and drop permissions
    canDrag: isEditor,
    canDrop: isEditor,

    // General flags
    isEditor,
    isViewer: !isEditor,
    isReadOnly: !isEditor,

    // User info
    user,
    role: user?.role || 'viewer',
  }
}
