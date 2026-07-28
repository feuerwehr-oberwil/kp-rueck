'use client';

/**
 * User Management Settings Component (Admin only)
 * CRUD interface for managing user accounts
 */

import { useState, useEffect } from 'react';
import { apiClient, type ApiUser, type ApiUserCreate, type ApiUserUpdate } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Plus, Pencil, Key, UserX, UserCheck, Shield, User, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/contexts/auth-context';
import { useTranslations } from 'next-intl';

export function UserSettings() {
  const t = useTranslations('settings');
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

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreate = async () => {
    const errors: { username?: string; password?: string } = {};
    if (!formData.username) errors.username = t('users.errors.usernameRequired');
    if (!formData.password) errors.password = t('users.errors.passwordRequired');
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
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
    if (!selectedUser || !newPassword) return;
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
    return new Date(lastLogin).toLocaleString('de-CH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="text-destructive">{error}</p>
        <Button onClick={fetchUsers} className="mt-4">{t('common.retry')}</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Create Button */}
      <div className="flex justify-end">
        <Button onClick={openCreateDialog}>
          <Plus className="size-4" />
          {t('users.newUser')}
        </Button>
      </div>

      {/* User List */}
      <div className="space-y-3">
        {users.map((user) => (
          <Card key={user.id} className={`p-4 ${!user.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  user.role === 'admin' ? 'bg-warning/10 text-warning-foreground' : 'bg-info/10 text-info'
                }`}>
                  {user.role === 'admin' ? (
                    <Shield className="h-5 w-5" />
                  ) : (
                    <User className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{user.display_name || user.username}</span>
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                      {roleLabel(user.role)}
                    </Badge>
                    {!user.is_active && (
                      <Badge variant="outline" className="text-muted-foreground">
                        {t('users.deactivated')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">@{user.username}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {/* Last-login column: aligned across rows so stale accounts
                    stand out at a glance (was buried in the subtitle). */}
                <div className="hidden sm:block text-right shrink-0">
                  <p className="text-xs text-muted-foreground">{t('users.lastLogin')}</p>
                  <p className="text-sm tabular-nums">{formatLastLogin(user.last_login)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(user)}
                    title={t('users.editTooltip')}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openPasswordDialog(user)}
                    title={t('users.resetPasswordTitle')}
                  >
                    <Key className="size-4" />
                  </Button>
                  {user.id !== currentUser?.id && user.is_active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openDeleteDialog(user)}
                      title={t('users.deactivateAction')}
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
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.newUser')}</DialogTitle>
            <DialogDescription>
              {t('users.createDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-semibold text-muted-foreground">
                {t('users.usernameLabel')} <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => {
                  setFormData({ ...formData, username: e.target.value });
                  if (formErrors.username) setFormErrors({ ...formErrors, username: undefined });
                }}
                placeholder={t('users.usernamePlaceholder')}
                aria-invalid={!!formErrors.username}
                className={cn(formErrors.username && 'border-destructive')}
              />
              {formErrors.username && (
                <p className="text-xs text-destructive">{formErrors.username}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="display_name" className="text-sm font-semibold text-muted-foreground">
                {t('users.displayNameLabel')}
              </Label>
              <Input
                id="display_name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                placeholder={t('users.displayNamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-semibold text-muted-foreground">
                {t('users.passwordLabel')} <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => {
                  setFormData({ ...formData, password: e.target.value });
                  if (formErrors.password) setFormErrors({ ...formErrors, password: undefined });
                }}
                aria-invalid={!!formErrors.password}
                className={cn(formErrors.password && 'border-destructive')}
              />
              {formErrors.password && (
                <p className="text-xs text-destructive">{formErrors.password}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="role" className="text-sm font-semibold text-muted-foreground">
                {t('users.roleLabel')}
              </Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value as 'admin' | 'editor' | 'viewer' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">{t('users.roles.editor')}</SelectItem>
                  <SelectItem value="viewer">{t('users.roles.viewer')}</SelectItem>
                  <SelectItem value="admin">{t('users.roleAdmin')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('users.adminsHint')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.editDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('users.editDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit_username" className="text-sm font-semibold text-muted-foreground">
                {t('users.usernameLabel')}
              </Label>
              <Input
                id="edit_username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_display_name" className="text-sm font-semibold text-muted-foreground">
                {t('users.displayNameLabel')}
              </Label>
              <Input
                id="edit_display_name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_role" className="text-sm font-semibold text-muted-foreground">
                {t('users.roleLabel')}
              </Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value as 'admin' | 'editor' | 'viewer' })}
                disabled={selectedUser?.id === currentUser?.id}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">{t('users.roles.editor')}</SelectItem>
                  <SelectItem value="viewer">{t('users.roles.viewer')}</SelectItem>
                  <SelectItem value="admin">{t('users.roleAdmin')}</SelectItem>
                </SelectContent>
              </Select>
              {selectedUser?.id === currentUser?.id && (
                <p className="text-xs text-muted-foreground">
                  {t('users.ownRoleHint')}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.resetPasswordTitle')}</DialogTitle>
            <DialogDescription>
              {t('users.resetPasswordDescription', { name: selectedUser?.display_name || selectedUser?.username || '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new_password" className="text-sm font-semibold text-muted-foreground">
                {t('users.newPasswordLabel')}
              </Label>
              <Input
                id="new_password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('users.newPasswordPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleResetPassword} disabled={submitting || !newPassword}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t('users.setPassword')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete (deactivate) Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        variant="destructive"
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
