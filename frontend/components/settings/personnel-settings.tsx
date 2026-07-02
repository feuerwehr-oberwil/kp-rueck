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
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes-warning';
import {
  personnelFormDefaults,
  personnelFormSchema,
  type PersonnelFormValues,
} from '@/lib/schemas/personnel';
import { toast } from 'sonner';

export function PersonnelSettings({ demoMode = false }: { demoMode?: boolean }) {
  const [personnel, setPersonnel] = useState<ApiPersonnel[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<ApiPersonnel | null>(null);
  const [newTag, setNewTag] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [personnelToDelete, setPersonnelToDelete] = useState<ApiPersonnel | null>(null);
  const [sortColumn, setSortColumn] = useState<'name' | 'role' | 'availability'>('name');
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

  useEffect(() => {
    loadPersonnel();
  }, []);

  const loadPersonnel = async () => {
    try {
      const data = await apiClient.getAllPersonnel();
      if (!data) {
        // GET degraded to undefined after retries — keep previous state instead
        // of crashing the sort memos with a non-iterable value.
        if (personnel.length === 0) {
          toast.error('Personal konnte nicht geladen werden', {
            description: 'Bitte Seite neu laden.',
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
      toast.error('Fehler beim Speichern', {
        description: 'Überprüfen Sie die Eingabe und versuchen Sie es erneut.',
      });
    }
  });

  const handleEdit = (person: ApiPersonnel) => {
    setEditingPersonnel(person);
    setNewTag('');
    form.reset({
      name: person.name,
      role: person.role || '',
      availability:
        person.availability === 'available' || person.availability === 'unavailable'
          ? person.availability
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
      toast.error('Fehler beim Löschen', {
        description: 'Die Person konnte nicht gelöscht werden. Versuchen Sie es erneut.',
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
  const handleSort = (column: 'name' | 'role' | 'availability') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sort personnel based on current sort settings
  const sortedPersonnel = useMemo(() => {
    return [...personnel].sort((a, b) => {
      let aVal: string;
      let bVal: string;

      switch (sortColumn) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'role':
          aVal = (a.role || '').toLowerCase();
          bVal = (b.role || '').toLowerCase();
          break;
        case 'availability':
          aVal = a.availability;
          bVal = b.availability;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [personnel, sortColumn, sortDirection]);

  // Render sort indicator
  const SortIndicator = ({ column }: { column: 'name' | 'role' | 'availability' }) => {
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
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
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
      setSyncError(error instanceof Error ? error.message : 'Fehler beim Laden der Vorschau');
    } finally {
      setIsSyncLoading(false);
    }
  };

  const handleExecuteSync = async () => {
    setIsSyncExecuting(true);
    try {
      const result = await apiClient.executeDiveraSync({ remove_stale: removeStale });
      const parts = [];
      if (result.created > 0) parts.push(`${result.created} erstellt`);
      if (result.deleted > 0) parts.push(`${result.deleted} gelöscht`);
      if (result.unchanged > 0) parts.push(`${result.unchanged} unverändert`);
      toast.success(`Synchronisation abgeschlossen: ${parts.join(', ')}`);
      setIsSyncDialogOpen(false);
      await loadPersonnel();
    } catch (error) {
      console.error('Failed to execute sync:', error);
      toast.error('Fehler bei der Synchronisation', { description: 'Die Verbindung zu Divera konnte nicht hergestellt werden. Versuchen Sie es erneut.' });
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
          <TabsTrigger value="list">Personalliste</TabsTrigger>
          <TabsTrigger value="sort">Kategorien sortieren</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex justify-end gap-2">
            {!demoMode && (
              <Button variant="outline" onClick={handleOpenSyncDialog}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Von Divera synchronisieren
              </Button>
            )}
            <Button onClick={handleOpenCreate}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Personal hinzufügen
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('name')}
                >
                  Name<SortIndicator column="name" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('role')}
                >
                  Rolle<SortIndicator column="role" />
                </TableHead>
                <TableHead>Tags</TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('availability')}
                >
                  Verfügbarkeit<SortIndicator column="availability" />
                </TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPersonnel.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    Kein Personal vorhanden.
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
                        person.availability === 'available'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {person.availability === 'available' ? 'Verfügbar' : 'Nicht verfügbar'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(person)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteClick(person)}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="sort">
          <CategorySortOrder
            title="Rollen-Sortierung"
            description="Ziehen Sie die Rollen, um deren Reihenfolge in der Anzeige zu ändern. Personal wird nach dieser Sortierung gruppiert."
            categories={roleCategories}
            onSave={handleSaveRoleSortOrder}
          />
        </TabsContent>
      </Tabs>

      {/* Edit / Create Personnel Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={guard.handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingPersonnel ? 'Personal bearbeiten' : 'Neue Person hinzufügen'}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-3" noValidate>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Nachname Vorname"
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
                      <FormLabel htmlFor="role">Rolle / Grad</FormLabel>
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
                                <SelectValue placeholder="Rolle auswählen" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {existingRoles.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {role}
                                </SelectItem>
                              ))}
                              <SelectItem value="__custom__">Andere...</SelectItem>
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
                              placeholder="Neue Rolle eingeben"
                              className="mt-1.5"
                            />
                          )}
                        </>
                      ) : (
                        <FormControl>
                          <Input
                            {...field}
                            id="role"
                            placeholder="z.B. Offiziere, Wachtmeister"
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
                name="availability"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verfügbarkeit</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="available">Verfügbar</SelectItem>
                        <SelectItem value="unavailable">Nicht verfügbar</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-1.5">
                <Label>Tags</Label>
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
                    placeholder="Neuer Tag"
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
                    Hinzufügen
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
                  Abbrechen
                </Button>
                <Button type="submit" disabled={submitDisabled}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingPersonnel ? 'Speichern' : 'Erstellen'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Person löschen"
        description={`Sind Sie sicher, dass Sie "${personnelToDelete?.name}" löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`}
        onConfirm={handleDeleteConfirm}
      />

      <UnsavedChangesDialog {...guard.dialogProps} />

      {/* Divera Sync Dialog */}
      <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Divera Personal synchronisieren</DialogTitle>
          </DialogHeader>

          {isSyncLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">Lade Vorschau von Divera...</span>
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
                    title="Neu"
                    items={syncPreview.new}
                    badgeVariant="default"
                    defaultOpen={syncPreview.new.length > 0}
                  />
                  <SyncSection
                    title="Unverändert"
                    items={syncPreview.unchanged}
                    badgeVariant="outline"
                    defaultOpen={false}
                  />
                  <SyncSection
                    title="Nicht in Divera"
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
                      {syncPreview.not_in_divera.length} Person(en) entfernen, die nicht in Divera vorhanden sind
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsSyncDialogOpen(false)} disabled={isSyncExecuting}>
                    Abbrechen
                  </Button>
                  <Button
                    onClick={handleExecuteSync}
                    disabled={isSyncExecuting || (syncPreview.new.length === 0 && !removeStale)}
                  >
                    {isSyncExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Synchronisieren
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
