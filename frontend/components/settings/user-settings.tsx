'use client';

/**
 * User Management Settings Component (Admin only)
 * CRUD interface for managing user accounts
 *
 * The three dialogs are built from `<DetailField>` rows — `Beschriftung │ Wert` on one
 * line — like the new-Einsatz modal, and for the same reason: a label stacked above every
 * control spent a dialog's height saying what «Rolle» means. Controls stay BOXED here,
 * not in the panel's borderless skin: every field of a creation dialog is empty at open,
 * and a borderless empty input has no affordance.
 */

import { useState, useEffect } from 'react';
import { useEffectEvent } from '@/lib/hooks/use-effect-event';
import { apiClient, type ApiUser, type ApiUserCreate, type ApiUserUpdate } from '@/lib/api-client';
import { SettingCard } from '@/components/settings/setting-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DetailField } from '@/components/kanban/detail-field';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Plus, Pencil, Key, UserX, UserCheck, Shield, User, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/contexts/auth-context';
import { useTranslations } from 'next-intl';
import { useIntlLocale } from '@/lib/date-locale';
import { LoadingStatus, ShellLoader } from '@/components/ui/shell-loader';
import { fieldMessageProps, focusFirstBlockingField, useRequiredField } from '@/components/ui/form-message';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes-warning';

/** The three roles in the order the select offers them, with the label key each uses. */
const ROLE_HINTS = [
  { role: 'editor', nameKey: 'users.roles.editor' },
  { role: 'viewer', nameKey: 'users.roles.viewer' },
  { role: 'admin', nameKey: 'users.roleAdmin' },
] as const;

/**
 * One plain sentence per role, right under the role select – no disclosure, no manual.
 *
 * The sentence about «Betrachter» names the consequence that surprises people today:
 * `ProtectedRoute` redirects a viewer to `/display/board` on login and the board itself
 * is not reachable from there (see components/protected-route.tsx). Better an
 * uncomfortable truth in the dialog than a surprise during an incident.
 */
function RoleHints() {
  const t = useTranslations('settings');
  return (
    <ul>
      {ROLE_HINTS.map(({ role, nameKey }) => (
        <li key={role} className="flex gap-2 py-1 text-xs text-muted-foreground">
          <span className="w-24 flex-shrink-0 font-semibold text-foreground">{t(nameKey)}</span>
          <span>{t(`users.roleHints.${role}`)}</span>
        </li>
      ))}
    </ul>
  );
}

export function UserSettings() {
  const t = useTranslations('settings');
  const tLoading = useTranslations('common.loadingWhat');
  const intlLocale = useIntlLocale();
  const { user: currentUser } = useAuth();
  const roleLabel = (role: string) =>
    role === 'admin' || role === 'editor' || role === 'viewer'
      ? t(`users.roles.${role}`)
      : role;
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [permanentDeleteDialogOpen, setPermanentDeleteDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ApiUser | null>(null);

  // Form states
  const [formData, setFormData] = useState<ApiUserCreate>({
    username: '',
    password: '',
    role: 'editor',
    display_name: '',
  });
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{ username?: string; password?: string }>({});
  const newPasswordField = useRequiredField('new_password', newPassword, t('users.errors.passwordRequired'));

  // Typed input survives Esc, a click beside the dialog and «Abbrechen»: closing
  // a dirty create/edit form asks first.
  const createDirty =
    createDialogOpen &&
    (formData.username !== '' || formData.password !== '' || formData.display_name !== '' || formData.role !== 'editor');
  const editDirty =
    editDialogOpen &&
    !!selectedUser &&
    (formData.username !== selectedUser.username ||
      formData.display_name !== selectedUser.display_name ||
      formData.role !== selectedUser.role);
  const createGuard = useUnsavedChangesWarning({
    isDirty: createDirty,
    isOpen: createDialogOpen,
    onClose: () => setCreateDialogOpen(false),
  });
  const editGuard = useUnsavedChangesWarning({
    isDirty: editDirty,
    isOpen: editDialogOpen,
    onClose: () => setEditDialogOpen(false),
  });

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError(err instanceof Error ? err.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  // Load once on mount. `fetchUsers` is a plain function re-created on every
  // render, so the mount effect calls it through an effect event.
  const loadOnMount = useEffectEvent(() => void fetchUsers());
  useEffect(() => {
    loadOnMount();
  }, []);

  const handleCreate = async () => {
    const errors: { username?: string; password?: string } = {};
    if (!formData.username) errors.username = t('users.errors.usernameRequired');
    if (!formData.password) errors.password = t('users.errors.passwordRequired');
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      focusFirstBlockingField([errors.username && 'username', errors.password && 'password']);
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.createUser({
        ...formData,
        display_name: formData.display_name || formData.username,
      });
      setCreateDialogOpen(false);
      setFormData({ username: '', password: '', role: 'editor', display_name: '' });
      fetchUsers();
    } catch (err) {
      console.error('Failed to create user:', err);
      toast.error(err instanceof Error ? err.message : t('users.toasts.createError'), { description: t('common.checkInputRetry') });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedUser) return;
    setSubmitting(true);
    try {
      const updateData: ApiUserUpdate = {
        username: formData.username || undefined,
        display_name: formData.display_name || undefined,
        role: formData.role as 'admin' | 'editor' | 'viewer',
      };
      await apiClient.updateUser(selectedUser.id, updateData);
      setEditDialogOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err) {
      console.error('Failed to update user:', err);
      toast.error(err instanceof Error ? err.message : t('users.toasts.updateError'), { description: t('common.checkInputRetry') });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser || !newPasswordField.check()) return;
    setSubmitting(true);
    try {
      await apiClient.resetUserPassword(selectedUser.id, newPassword);
      setPasswordDialogOpen(false);
      setSelectedUser(null);
      setNewPassword('');
    } catch (err) {
      console.error('Failed to reset password:', err);
      toast.error(err instanceof Error ? err.message : t('users.toasts.resetError'), { description: t('users.toasts.resetErrorDescription') });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    setSubmitting(true);
    try {
      await apiClient.deleteUser(selectedUser.id);
      setDeleteDialogOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err) {
      console.error('Failed to delete user:', err);
      toast.error(err instanceof Error ? err.message : t('users.toasts.deactivateError'), { description: t('users.toasts.deactivateErrorDescription') });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReactivate = async (user: ApiUser) => {
    setSubmitting(true);
    try {
      await apiClient.updateUser(user.id, { is_active: true });
      fetchUsers();
    } catch (err) {
      console.error('Failed to reactivate user:', err);
      toast.error(err instanceof Error ? err.message : t('users.toasts.reactivateError'), { description: t('users.toasts.reactivateErrorDescription') });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePermanentDelete = async () => {
    if (!selectedUser) return;
    setSubmitting(true);
    try {
      await apiClient.deleteUser(selectedUser.id, true);
      setPermanentDeleteDialogOpen(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err) {
      console.error('Failed to permanently delete user:', err);
      toast.error(err instanceof Error ? err.message : t('users.toasts.deleteError'), { description: t('users.toasts.deleteErrorDescription') });
    } finally {
      setSubmitting(false);
    }
  };

  const openCreateDialog = () => {
    setFormData({ username: '', password: '', role: 'editor', display_name: '' });
    setFormErrors({});
    setCreateDialogOpen(true);
  };

  const openEditDialog = (user: ApiUser) => {
    setSelectedUser(user);
    setFormData({
      username: user.username,
      password: '',
      role: user.role,
      display_name: user.display_name,
    });
    setEditDialogOpen(true);
  };

  const openPasswordDialog = (user: ApiUser) => {
    setSelectedUser(user);
    setNewPassword('');
    newPasswordField.reset();
    setPasswordDialogOpen(true);
  };

  const openDeleteDialog = (user: ApiUser) => {
    setSelectedUser(user);
    setDeleteDialogOpen(true);
  };

  const openPermanentDeleteDialog = (user: ApiUser) => {
    setSelectedUser(user);
    setPermanentDeleteDialogOpen(true);
  };

  const formatLastLogin = (lastLogin: string | null) => {
    if (!lastLogin) return t('users.never');
    return new Date(lastLogin).toLocaleString(intlLocale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <SettingCard>
        <LoadingStatus size="surface" className="flex w-full py-8 text-sm">{tLoading('users')}</LoadingStatus>
      </SettingCard>
    );
  }

  if (error) {
    return (
      <SettingCard>
        <p className="text-destructive">{error}</p>
        <Button onClick={fetchUsers} className="mt-4">{t('common.retry')}</Button>
      </SettingCard>
    );
  }

  return (
    /* Auf einer Karte wie jeder andere Abschnitt, mit «Neuer Benutzer» im Kartenkopf —
       demselben Platz, an dem die anderen Karten ihre eine Aktion tragen. */
    <div className="space-y-6">
      <SettingCard
        action={
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            {t('users.newUser')}
          </Button>
        }
      >
      {/* One row per account, like Mannschaft/Fahrzeuge/Material — the accounts were the
          last resource list still drawn as a stack of cards, which cost a card frame and
          a 40px avatar per user and still left the last-login stamps unaligned. The
          deactivated row greys out the way an archived vehicle does. */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('common.name')}</TableHead>
            <TableHead>{t('users.usernameLabel')}</TableHead>
            <TableHead>{t('common.role')}</TableHead>
            <TableHead>{t('users.lastLogin')}</TableHead>
            <TableHead className="text-right">{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow
              key={user.id}
              className={!user.is_active ? 'bg-muted/40 text-muted-foreground' : undefined}
            >
              <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                  {user.role === 'admin' ? (
                    <Shield className="size-4 shrink-0 text-warning-foreground" aria-hidden />
                  ) : (
                    <User className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  {user.display_name || user.username}
                  {!user.is_active && (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t('users.deactivated')}
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">@{user.username}</TableCell>
              <TableCell>
                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                  {roleLabel(user.role)}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">{formatLastLogin(user.last_login)}</TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(user)}
                    title={t('users.editTooltip')}
                    aria-label={t('users.editAria', { name: user.display_name || user.username })}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openPasswordDialog(user)}
                    title={t('users.resetPasswordTitle')}
                    aria-label={t('users.resetPasswordAria', { name: user.display_name || user.username })}
                  >
                    <Key className="size-4" />
                  </Button>
                  {user.id !== currentUser?.id && user.is_active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openDeleteDialog(user)}
                      title={t('users.deactivateAction')}
                      aria-label={t('users.deactivateAria', { name: user.display_name || user.username })}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <UserX className="size-4" />
                    </Button>
                  )}
                  {!user.is_active && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleReactivate(user)}
                        title={t('users.reactivateTooltip')}
                        aria-label={t('users.reactivateAria', { name: user.display_name || user.username })}
                        className="text-success hover:text-success"
                        disabled={submitting}
                      >
                        <UserCheck className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openPermanentDeleteDialog(user)}
                        title={t('users.permanentDeleteAction')}
                        aria-label={t('users.permanentDeleteAria', { name: user.display_name || user.username })}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </SettingCard>

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={createGuard.handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.newUser')}</DialogTitle>
            <DialogDescription>
              {t('users.createDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          {/* A <form>, so Enter in any field creates. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <div className="space-y-1 py-2">
              <DetailField
                label={t('users.usernameLabel')}
                htmlFor="username"
                required
                error={formErrors.username}
              >
                {/* An admin creating an account for somebody else — never the
                    browser's own saved KP login. Without the pair of hints the
                    password manager fills this form with the admin's credentials. */}
                <Input
                  id="username"
                  autoComplete="off"
                  value={formData.username}
                  onChange={(e) => {
                    setFormData({ ...formData, username: e.target.value });
                    if (formErrors.username) setFormErrors({ ...formErrors, username: undefined });
                  }}
                  placeholder={t('users.usernamePlaceholder')}
                  {...fieldMessageProps('username', formErrors.username ? 'error' : null)}
                />
              </DetailField>
              <DetailField label={t('users.displayNameLabel')} htmlFor="display_name">
                <Input
                  id="display_name"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  placeholder={t('users.displayNamePlaceholder')}
                />
              </DetailField>
              <DetailField
                label={t('users.passwordLabel')}
                htmlFor="password"
                required
                error={formErrors.password}
              >
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={formData.password}
                  onChange={(e) => {
                    setFormData({ ...formData, password: e.target.value });
                    if (formErrors.password) setFormErrors({ ...formErrors, password: undefined });
                  }}
                  {...fieldMessageProps('password', formErrors.password ? 'error' : null)}
                />
              </DetailField>
              {/* The role sentences hang off the row rather than sitting beside it: three
                  lines do not fit a row, and they belong to the select above them. */}
              <DetailField label={t('users.roleLabel')} htmlFor="role" footer={<RoleHints />}>
                <Select
                  value={formData.role}
                  onValueChange={(value) => setFormData({ ...formData, role: value as 'admin' | 'editor' | 'viewer' })}
                >
                  <SelectTrigger id="role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">{t('users.roles.editor')}</SelectItem>
                    <SelectItem value="viewer">{t('users.roles.viewer')}</SelectItem>
                    <SelectItem value="admin">{t('users.roleAdmin')}</SelectItem>
                  </SelectContent>
                </Select>
              </DetailField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={createGuard.requestClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <ShellLoader className="size-4" />}
                {t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog {...createGuard.dialogProps} />

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={editGuard.handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.editDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('users.editDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleUpdate();
            }}
          >
            <div className="space-y-1 py-2">
              <DetailField label={t('users.usernameLabel')} htmlFor="edit_username">
                <Input
                  id="edit_username"
                  autoComplete="off"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
              </DetailField>
              <DetailField label={t('users.displayNameLabel')} htmlFor="edit_display_name">
                <Input
                  id="edit_display_name"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                />
              </DetailField>
              <DetailField
                label={t('users.roleLabel')}
                htmlFor="edit_role"
                footer={
                  selectedUser?.id === currentUser?.id ? (
                    <p className="text-xs text-muted-foreground">{t('users.ownRoleHint')}</p>
                  ) : (
                    <RoleHints />
                  )
                }
              >
                <Select
                  value={formData.role}
                  onValueChange={(value) => setFormData({ ...formData, role: value as 'admin' | 'editor' | 'viewer' })}
                  disabled={selectedUser?.id === currentUser?.id}
                >
                  <SelectTrigger id="edit_role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">{t('users.roles.editor')}</SelectItem>
                    <SelectItem value="viewer">{t('users.roles.viewer')}</SelectItem>
                    <SelectItem value="admin">{t('users.roleAdmin')}</SelectItem>
                  </SelectContent>
                </Select>
              </DetailField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={editGuard.requestClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <ShellLoader className="size-4" />}
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog {...editGuard.dialogProps} />

      {/* Reset Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.resetPasswordTitle')}</DialogTitle>
            <DialogDescription>
              {t('users.resetPasswordDescription', { name: selectedUser?.display_name || selectedUser?.username || '' })}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleResetPassword();
            }}
          >
            <div className="space-y-1 py-2">
              <DetailField
                label={t('users.newPasswordLabel')}
                htmlFor="new_password"
                required
                error={newPasswordField.error}
              >
                <Input
                  {...newPasswordField.controlProps}
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('users.newPasswordPlaceholder')}
                />
              </DetailField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <ShellLoader className="size-4" />}
                {t('users.setPassword')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete (deactivate) Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('users.deactivateTitle')}
        description={t('users.deactivateDescription', { name: selectedUser?.display_name || selectedUser?.username || '' })}
        cancelText={t('common.cancel')}
        confirmText={t('users.deactivateAction')}
        onConfirm={handleDelete}
      />

      {/* Permanent Delete Confirmation Dialog */}
      <ConfirmDialog
        open={permanentDeleteDialogOpen}
        onOpenChange={setPermanentDeleteDialogOpen}
        variant="destructive"
        title={t('users.permanentDeleteTitle')}
        description={t('users.permanentDeleteDescription', { name: selectedUser?.display_name || selectedUser?.username || '' })}
        cancelText={t('common.cancel')}
        confirmText={t('users.permanentDeleteAction')}
        onConfirm={handlePermanentDelete}
      />
    </div>
  );
}
