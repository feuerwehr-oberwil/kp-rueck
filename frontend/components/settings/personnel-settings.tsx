'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, Edit, Trash2, Loader2, ArrowUp, ArrowDown, RefreshCw, ChevronDown, ChevronRight, X } from 'lucide-react';
import { apiClient, ApiPersonnel, ApiDiveraSyncPreview } from '@/lib/api-client';
import { CategorySortOrder } from './category-sort-order';
import { DemoLock } from './demo-lock';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes-warning';
import {
  personnelFormDefaults,
  personnelFormSchema,
  type PersonnelFormValues,
} from '@/lib/schemas/personnel';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { compareByName, compareByRankThenName } from '@/lib/roster-order';

export function PersonnelSettings({ demoMode = false }: { demoMode?: boolean }) {
  const t = useTranslations('settings');
  const [personnel, setPersonnel] = useState<ApiPersonnel[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<ApiPersonnel | null>(null);
  const [newTag, setNewTag] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [personnelToDelete, setPersonnelToDelete] = useState<ApiPersonnel | null>(null);
  const [sortColumn, setSortColumn] = useState<'name' | 'role' | 'status'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Divera sync state
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [syncPreview, setSyncPreview] = useState<ApiDiveraSyncPreview | null>(null);
  const [isSyncLoading, setIsSyncLoading] = useState(false);
  const [isSyncExecuting, setIsSyncExecuting] = useState(false);
  const [removeStale, setRemoveStale] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const form = useForm<PersonnelFormValues>({
    resolver: zodResolver(personnelFormSchema),
    defaultValues: personnelFormDefaults,
  });

  const tags = form.watch('tags');
  const roleValue = form.watch('role');

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingPersonnel(null);
    setNewTag('');
    form.reset(personnelFormDefaults);
  };

  const guard = useUnsavedChangesWarning({
    isDirty: form.formState.isDirty,
    isOpen: isDialogOpen,
    onClose: closeDialog,
  });

  // Load once on mount. `loadPersonnel` is a plain function re-created on every
  // render, so listing it as a dep would refetch on every render.
  useEffect(() => {
    loadPersonnel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPersonnel = async () => {
    try {
      const data = await apiClient.getAllPersonnel();
      if (!data) {
        // GET degraded to undefined after retries — keep previous state instead
        // of crashing the sort memos with a non-iterable value.
        if (personnel.length === 0) {
          toast.error(t('personnel.loadError'), {
            description: t('common.reloadPage'),
          });
        }
        return;
      }
      setPersonnel(data);
    } catch (error) {
      console.error('Failed to load personnel:', error);
    }
  };

  // Extract unique roles for the role selector
  const existingRoles = useMemo(() => {
    const roles = new Set<string>();
    personnel.forEach((p) => {
      if (p.role) roles.add(p.role);
    });
    return Array.from(roles).sort();
  }, [personnel]);

  // Extract unique tags across all personnel for quick-toggle
  const existingTags = useMemo(() => {
    const tagSet = new Set<string>();
    personnel.forEach((p) => {
      p.tags?.forEach((t) => tagSet.add(t));
    });
    return Array.from(tagSet).sort();
  }, [personnel]);

  const handleOpenCreate = () => {
    setEditingPersonnel(null);
    setNewTag('');
    form.reset(personnelFormDefaults);
    setIsDialogOpen(true);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (editingPersonnel) {
        const updated = await apiClient.updatePersonnel(editingPersonnel.id, values);
        setPersonnel((prev) =>
          prev.map((p) => (p.id === editingPersonnel.id ? updated : p))
        );
      } else {
        const created = await apiClient.createPersonnel(values);
        setPersonnel((prev) => [...prev, created]);
      }
      closeDialog();
    } catch (error) {
      console.error('Failed to save personnel:', error);
      toast.error(t('common.saveError'), {
        description: t('common.checkInputRetry'),
      });
    }
  });

  const handleEdit = (person: ApiPersonnel) => {
    setEditingPersonnel(person);
    setNewTag('');
    form.reset({
      name: person.name,
      role: person.role || '',
      status:
        person.status === 'available' || person.status === 'unavailable'
          ? person.status
          : 'available',
      tags: person.tags || [],
    });
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (person: ApiPersonnel) => {
    setPersonnelToDelete(person);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!personnelToDelete) return;
    try {
      await apiClient.deletePersonnel(personnelToDelete.id);
      setPersonnel((prev) => prev.filter((p) => p.id !== personnelToDelete.id));
    } catch (error) {
      console.error('Failed to delete personnel:', error);
      toast.error(t('personnel.deleteError'), {
        description: t('personnel.deleteErrorDescription'),
      });
    } finally {
      setPersonnelToDelete(null);
    }
  };

  const toggleTag = (tag: string) => {
    const current = form.getValues('tags');
    const next = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
    form.setValue('tags', next, { shouldDirty: true, shouldValidate: true });
  };

  const addCustomTag = () => {
    const trimmed = newTag.trim();
    const current = form.getValues('tags');
    if (trimmed && !current.includes(trimmed)) {
      form.setValue('tags', [...current, trimmed], {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    setNewTag('');
  };

  // Handle column header click for sorting
  const handleSort = (column: 'name' | 'role' | 'status') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  /**
   * The admin table's order.
   *
   * It used to lowercase both values and compare them with `<` / `>`, which is
   * UTF-16 code-unit order: «Öhler» sorted after «Zwahlen» and «äsch» after
   * every z-name. This is the one screen where the whole roster is maintained,
   * so it was also the screen where a name was hardest to find. Names go
   * through the app's canonical comparator now; the Grad column sorts by the
   * station's own `role_sort_order` first, which is what the rank editor below
   * this table actually sets.
   */
  const sortedPersonnel = useMemo(() => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...personnel].sort((a, b) => {
      switch (sortColumn) {
        case 'name':
          return direction * compareByName(a, b);
        case 'role':
          return direction * compareByRankThenName(
            { name: a.name, role: a.role, roleSortOrder: a.role_sort_order },
            { name: b.name, role: b.role, roleSortOrder: b.role_sort_order },
          );
        case 'status':
          return direction * (a.status.localeCompare(b.status, 'de-CH') || compareByName(a, b));
        default:
          return 0;
      }
    });
  }, [personnel, sortColumn, sortDirection]);

  // Render sort indicator
  const SortIndicator = ({ column }: { column: 'name' | 'role' | 'status' }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3 inline" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 inline" />
    );
  };

  // Extract unique roles with their sort orders and counts
  const roleCategories = useMemo(() => {
    const roleMap = new Map<string, { sort_order: number; count: number }>();

    personnel.forEach((person) => {
      const role = person.role || '';
      if (!roleMap.has(role)) {
        roleMap.set(role, {
          sort_order: person.role_sort_order,
          count: 0,
        });
      }
      const current = roleMap.get(role)!;
      current.count++;
    });

    return Array.from(roleMap.entries())
      .map(([name, data]) => ({
        name,
        sort_order: data.sort_order,
        count: data.count,
      }))
      // de-CH, not the UI locale: a rank label is roster data, and the editor
      // must not reorder itself when somebody switches the interface language.
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de-CH'));
  }, [personnel]);

  const handleSaveRoleSortOrder = async (categories: Array<{ name: string; sort_order: number }>) => {
    await apiClient.updatePersonnelCategorySortOrder({
      categories: categories.map((cat) => ({
        category: cat.name,
        sort_order: cat.sort_order,
      })),
    });
    await loadPersonnel();
  };

  // Divera sync handlers
  const handleOpenSyncDialog = async () => {
    setIsSyncDialogOpen(true);
    setIsSyncLoading(true);
    setSyncPreview(null);
    setSyncError(null);
    setRemoveStale(false);

    try {
      const preview = await apiClient.getDiveraSyncPreview();
      setSyncPreview(preview);
    } catch (error) {
      console.error('Failed to fetch sync preview:', error);
      setSyncError(error instanceof Error ? error.message : t('personnel.syncPreviewError'));
    } finally {
      setIsSyncLoading(false);
    }
  };

  const handleExecuteSync = async () => {
    setIsSyncExecuting(true);
    try {
      const result = await apiClient.executeDiveraSync({ remove_stale: removeStale });
      const parts = [];
      if (result.created > 0) parts.push(t('personnel.syncCreated', { count: result.created }));
      if (result.deleted > 0) parts.push(t('personnel.syncDeleted', { count: result.deleted }));
      if (result.unchanged > 0) parts.push(t('personnel.syncUnchanged', { count: result.unchanged }));
      toast.success(t('personnel.syncComplete', { parts: parts.join(', ') }));
      setIsSyncDialogOpen(false);
      await loadPersonnel();
    } catch (error) {
      console.error('Failed to execute sync:', error);
      toast.error(t('personnel.syncError'), { description: t('personnel.syncErrorDescription') });
    } finally {
      setIsSyncExecuting(false);
    }
  };

  const isSaving = form.formState.isSubmitting;
  const trimmedName = (form.watch('name') ?? '').trim();
  const trimmedRole = (roleValue ?? '').trim();
  const submitDisabled = isSaving || !trimmedName || !trimmedRole;

  return (
    <div className="space-y-4">
      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="list">{t('personnel.tabList')}</TabsTrigger>
          <TabsTrigger value="sort">{t('common.sortCategoriesTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <DemoLock active={demoMode} className="space-y-4">
          <div className="flex justify-end gap-2">
            {!demoMode && (
              <Button variant="outline" onClick={handleOpenSyncDialog}>
                <RefreshCw className="size-4" />
                {t('personnel.syncButton')}
              </Button>
            )}
            <Button onClick={handleOpenCreate}>
              <PlusCircle className="size-4" />
              {t('personnel.addButton')}
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('name')}
                >
                  {t('common.name')}<SortIndicator column="name" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('role')}
                >
                  {t('common.role')}<SortIndicator column="role" />
                </TableHead>
                <TableHead>{t('personnel.tags')}</TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('status')}
                >
                  {t('personnel.availability')}<SortIndicator column="status" />
                </TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPersonnel.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    {t('personnel.empty')}
                  </TableCell>
                </TableRow>
              )}
              {sortedPersonnel.map((person) => (
                <TableRow key={person.id}>
                  <TableCell className="font-medium">{person.name}</TableCell>
                  <TableCell>{person.role || '-'}</TableCell>
                  <TableCell>
                    {person.tags && person.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {person.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs font-normal px-1.5 py-0">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        person.status === 'available'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {person.status === 'available' ? t('common.available') : t('common.unavailable')}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(person)}
                    >
                      <Edit className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteClick(person)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </DemoLock>
        </TabsContent>

        <TabsContent value="sort">
          <CategorySortOrder
            title={t('personnel.sortTitle')}
            description={t('personnel.sortDescription')}
            categories={roleCategories}
            onSave={handleSaveRoleSortOrder}
            readOnly={demoMode}
          />
        </TabsContent>
      </Tabs>

      {/* Edit / Create Personnel Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={guard.handleOpenChange}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {editingPersonnel ? t('personnel.dialogEditTitle') : t('personnel.dialogCreateTitle')}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-3" noValidate>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold text-muted-foreground">
                      {t('common.name')} <span className="text-destructive" aria-hidden="true">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t('personnel.namePlaceholder')}
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="role"
                render={({ field }) => {
                  const showCustomInput =
                    existingRoles.length === 0 ||
                    !existingRoles.includes(field.value) ||
                    field.value === '';
                  return (
                    <FormItem>
                      <FormLabel htmlFor="role" className="text-sm font-semibold text-muted-foreground">
                        {t('personnel.roleLabel')} <span className="text-destructive" aria-hidden="true">*</span>
                      </FormLabel>
                      {existingRoles.length > 0 ? (
                        <>
                          <Select
                            value={
                              existingRoles.includes(field.value)
                                ? field.value
                                : '__custom__'
                            }
                            onValueChange={(value) => {
                              if (value === '__custom__') {
                                form.setValue('role', '', {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                });
                              } else {
                                form.setValue('role', value, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                });
                              }
                            }}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={t('personnel.rolePlaceholder')} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {existingRoles.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {role}
                                </SelectItem>
                              ))}
                              <SelectItem value="__custom__">{t('personnel.roleCustomOption')}</SelectItem>
                            </SelectContent>
                          </Select>
                          {showCustomInput && (
                            <Input
                              value={field.value}
                              onChange={(e) =>
                                form.setValue('role', e.target.value, {
                                  shouldDirty: true,
                                  shouldValidate: true,
                                })
                              }
                              onBlur={field.onBlur}
                              placeholder={t('personnel.roleCustomPlaceholder')}
                              className="mt-1.5"
                            />
                          )}
                        </>
                      ) : (
                        <FormControl>
                          <Input
                            {...field}
                            id="role"
                            placeholder={t('personnel.roleExamplePlaceholder')}
                          />
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold text-muted-foreground">{t('personnel.availability')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="available">{t('common.available')}</SelectItem>
                        <SelectItem value="unavailable">{t('common.unavailable')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-muted-foreground">{t('personnel.tags')}</Label>
                {/* Currently assigned tags */}
                {tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="default"
                        className="text-xs px-2 py-0.5 cursor-pointer gap-1"
                        onClick={() => toggleTag(tag)}
                      >
                        {tag}
                        <X className="h-3 w-3" />
                      </Badge>
                    ))}
                  </div>
                )}
                {/* Quick-toggle existing tags not yet assigned */}
                {existingTags.filter((t) => !tags.includes(t)).length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {existingTags
                      .filter((t) => !tags.includes(t))
                      .map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-xs px-2 py-0.5 cursor-pointer text-muted-foreground"
                          onClick={() => toggleTag(tag)}
                        >
                          + {tag}
                        </Badge>
                      ))}
                  </div>
                )}
                {/* Add custom tag */}
                <div className="flex gap-1.5">
                  <Input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomTag();
                      }
                    }}
                    placeholder={t('personnel.newTagPlaceholder')}
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCustomTag}
                    disabled={!newTag.trim()}
                    className="h-8 px-3"
                  >
                    {t('personnel.addTag')}
                  </Button>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={guard.requestClose}
                  disabled={isSaving}
                >
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={submitDisabled}>
                  {isSaving && <Loader2 className="size-4 animate-spin" />}
                  {editingPersonnel ? t('common.save') : t('common.create')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('personnel.deleteTitle')}
        description={t('personnel.deleteDescription', { name: personnelToDelete?.name ?? '' })}
        onConfirm={handleDeleteConfirm}
      />

      <UnsavedChangesDialog {...guard.dialogProps} />

      {/* Divera Sync Dialog */}
      <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
        <DialogContent className="max-w-2xl modal-h-tall flex flex-col overflow-hidden" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('personnel.syncDialogTitle')}</DialogTitle>
          </DialogHeader>

          {isSyncLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">{t('personnel.syncLoading')}</span>
            </div>
          )}

          {syncError && (
            <div className="rounded-md bg-destructive/10 p-4 text-destructive text-sm">
              {syncError}
            </div>
          )}

          {syncPreview && !isSyncLoading && (
            <div className="flex flex-col gap-3 min-h-0">
              <div className="overflow-y-auto min-h-0 flex-1 pr-2">
                <div className="space-y-2">
                  <SyncSection
                    title={t('personnel.syncSectionNew')}
                    items={syncPreview.new}
                    badgeVariant="default"
                    defaultOpen={syncPreview.new.length > 0}
                  />
                  <SyncSection
                    title={t('personnel.syncSectionUnchanged')}
                    items={syncPreview.unchanged}
                    badgeVariant="outline"
                    defaultOpen={false}
                  />
                  <SyncSection
                    title={t('personnel.syncSectionNotInDivera')}
                    items={syncPreview.not_in_divera}
                    badgeVariant="destructive"
                    defaultOpen={syncPreview.not_in_divera.length > 0}
                  />
                </div>
              </div>

              <div className="flex-shrink-0 space-y-3 border-t pt-3">
                {syncPreview.not_in_divera.length > 0 && (
                  <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Checkbox
                      id="remove-stale"
                      checked={removeStale}
                      onCheckedChange={(checked) => setRemoveStale(checked === true)}
                    />
                    <label htmlFor="remove-stale" className="text-sm cursor-pointer">
                      {t('personnel.removeStaleLabel', { count: syncPreview.not_in_divera.length })}
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsSyncDialogOpen(false)} disabled={isSyncExecuting}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    onClick={handleExecuteSync}
                    disabled={isSyncExecuting || (syncPreview.new.length === 0 && !removeStale)}
                  >
                    {isSyncExecuting && <Loader2 className="size-4 animate-spin" />}
                    {t('personnel.syncExecuteButton')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SyncSection({
  title,
  items,
  badgeVariant,
  defaultOpen,
}: {
  title: string;
  items: { member: { divera_id: number; name: string }; status: string; existing_id: string | null }[];
  badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (items.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-muted/50 text-sm font-medium">
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {title}
        <Badge variant={badgeVariant} className="ml-auto">{items.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-6 py-1 space-y-0.5">
          {items.map((item, idx) => (
            <div key={`${item.member.divera_id}-${idx}`} className="text-sm py-0.5">
              {item.member.name}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
