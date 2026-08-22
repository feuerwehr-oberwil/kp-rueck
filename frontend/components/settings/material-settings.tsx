'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Form, FormField } from '@/components/ui/form';
import { SettingCard } from '@/components/settings/setting-row';
import { DetailField, DetailToggle } from '@/components/kanban/detail-field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlusCircle, Edit, Archive, ArchiveRestore, Trash2, Loader2, ArrowUp, ArrowDown, ArrowRight, Infinity as InfinityIcon, Ban, Check, CircleSlash, PackageMinus } from 'lucide-react';
import Link from 'next/link';
import { apiClient, ApiError, ApiMaterialResource, ApiMaterialGroup } from '@/lib/api-client';
import { Checkbox } from '@/components/ui/checkbox';
import { CategorySortOrder } from './category-sort-order';
import { DemoLock } from './demo-lock';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes-warning';
import {
  materialFormDefaults,
  materialFormSchema,
  type MaterialFormValues,
} from '@/lib/schemas/material';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

/** "19.08." — the short stamp the archive line and «seit …» both use. */
function shortDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`;
}

/** The three lifecycle/readiness states a settings row can be in. Deployment is
 *  per-Ereignis and deliberately absent here — the Materialverwaltung is not the
 *  board, and claiming «Im Einsatz» from a station-wide list would be a guess. */
type RowState = 'archived' | 'outOfService' | 'available';

function rowState(material: ApiMaterialResource): RowState {
  if (material.archived_at) return 'archived';
  if (material.out_of_service) return 'outOfService';
  return 'available';
}

type SortColumn = 'name' | 'type' | 'location' | 'status';

export function MaterialSettings({ demoMode = false }: { demoMode?: boolean }) {
  const t = useTranslations('settings');
  const [materials, setMaterials] = useState<ApiMaterialResource[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<ApiMaterialResource | null>(null);
  const [materialGroups, setMaterialGroups] = useState<ApiMaterialGroup[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<ApiMaterialResource | null>(null);
  // The archive is a second, quieter list behind a toggle — not a filter over
  // the same rows. Off, the endpoint does not even return them.
  const [showArchived, setShowArchived] = useState(false);
  const [materialToPurge, setMaterialToPurge] = useState<ApiMaterialResource | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const form = useForm<MaterialFormValues>({
    resolver: zodResolver(materialFormSchema),
    defaultValues: materialFormDefaults,
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingMaterial(null);
    form.reset(materialFormDefaults);
  };

  const guard = useUnsavedChangesWarning({
    isDirty: form.formState.isDirty,
    isOpen: isDialogOpen,
    onClose: closeDialog,
  });

  // Load once on mount. The loaders are plain functions re-created on every
  // render, so listing them as deps would refetch on every render.
  useEffect(() => {
    loadMaterials();
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadGroups = async () => {
    try {
      const data = await apiClient.getMaterialGroups();
      // Same degrade-to-undefined guard as loadMaterials — keep previous state.
      if (!data) return;
      setMaterialGroups(data);
    } catch (error) {
      console.error('Failed to load material groups:', error);
    }
  };

  const loadMaterials = async (includeArchived = showArchived) => {
    try {
      const data = await apiClient.getAllMaterials({ includeArchived });
      if (!data) {
        // GET degraded to undefined after retries — keep previous state instead
        // of crashing the sort memos with a non-iterable value.
        if (materials.length === 0) {
          toast.error(t('materials.loadError'), {
            description: t('common.reloadPage'),
          });
        }
        return;
      }
      setMaterials(data);
    } catch (error) {
      console.error('Failed to load materials:', error);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (editingMaterial) {
        await apiClient.updateMaterialResource(editingMaterial.id, values);
      } else {
        await apiClient.createMaterialResource(values);
      }
      await loadMaterials();
      closeDialog();
    } catch (error) {
      console.error('Failed to save material:', error);
      toast.error(t('materials.saveError'), {
        description: t('common.checkInputRetry'),
      });
    }
  });

  const handleEdit = (material: ApiMaterialResource) => {
    setEditingMaterial(material);
    form.reset({
      name: material.name,
      type: material.type || '',
      status:
        material.status === 'available' || material.status === 'unavailable'
          ? material.status
          : 'available',
      location: material.location || '',
      consumable: material.consumable ?? false,
    });
    setIsDialogOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingMaterial(null);
    form.reset(materialFormDefaults);
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (material: ApiMaterialResource) => {
    setMaterialToDelete(material);
    setDeleteDialogOpen(true);
  };

  /** The normal way to retire a device: reversible, and it really does leave the
   *  board. The dialog that leads here names both of those facts. Like the purge
   *  below, the API refuses with 409 while the device stands on an open Einsatz
   *  — that answer gets its own sentence instead of the generic failure. */
  const handleArchiveConfirm = async () => {
    if (!materialToDelete) return;
    try {
      await apiClient.archiveMaterialResource(materialToDelete.id);
      await loadMaterials();
    } catch (error) {
      console.error('Failed to archive material:', error);
      toast.error(t('lifecycle.archiveError'), {
        description: ApiError.isConflictError(error)
          ? t('lifecycle.archiveInUseDescription')
          : t('materials.deleteErrorDescription'),
      });
    } finally {
      setMaterialToDelete(null);
    }
  };

  const handleRestore = async (material: ApiMaterialResource) => {
    try {
      await apiClient.restoreMaterialResource(material.id);
      await loadMaterials();
    } catch (error) {
      console.error('Failed to restore material:', error);
      toast.error(t('lifecycle.restoreError'));
    }
  };

  /** The rare way. The API refuses with 409 and a German sentence when the device
   *  stood on a live Einsatz — surface that sentence rather than inventing one. */
  const handlePurgeConfirm = async () => {
    if (!materialToPurge) return;
    try {
      await apiClient.deleteMaterialResource(materialToPurge.id, { permanent: true });
      await loadMaterials();
    } catch (error) {
      console.error('Failed to delete material permanently:', error);
      toast.error(t('lifecycle.purgeError'), {
        description: error instanceof ApiError ? error.message : t('materials.deleteErrorDescription'),
      });
    } finally {
      setMaterialToPurge(null);
    }
  };

  /** «Nicht einsatzbereit» — the same single field the board's right-click menu
   *  writes, sent as the same `{ out_of_service }` PUT. */
  const handleToggleOutOfService = async (material: ApiMaterialResource, outOfService: boolean) => {
    try {
      const updated = await apiClient.updateMaterialResource(material.id, { out_of_service: outOfService });
      setMaterials((list) => list.map((m) => (m.id === material.id ? updated : m)));
    } catch (error) {
      console.error('Failed to change material readiness:', error);
      toast.error(t('lifecycle.notReadyError'));
    }
  };

  const toggleShowArchived = async () => {
    const next = !showArchived;
    setShowArchived(next);
    await loadMaterials(next);
  };

  // Derive unique types and locations from existing materials for dynamic selects
  const existingTypes = useMemo(() => {
    const types = new Set(materials.map((m) => m.type).filter(Boolean));
    return Array.from(types).sort();
  }, [materials]);

  const existingLocations = useMemo(() => {
    const locs = new Set(materials.map((m) => m.location || '').filter(Boolean));
    return Array.from(locs).sort();
  }, [materials]);

  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sort materials based on current sort settings. Archived rows always sink to
  // the bottom whatever the column: they are a second list, not a peer of the
  // inventory above them.
  const sortedMaterials = useMemo(() => {
    const stateRank: Record<RowState, number> = { available: 0, outOfService: 1, archived: 2 };
    return [...materials].sort((a, b) => {
      if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;

      let aVal: string | number;
      let bVal: string | number;

      switch (sortColumn) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'type':
          aVal = (a.type || '').toLowerCase();
          bVal = (b.type || '').toLowerCase();
          break;
        case 'location':
          aVal = (a.location || '').toLowerCase();
          bVal = (b.location || '').toLowerCase();
          break;
        case 'status':
          aVal = stateRank[rowState(a)];
          bVal = stateRank[rowState(b)];
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [materials, sortColumn, sortDirection]);

  const archivedCount = useMemo(() => materials.filter((m) => m.archived_at).length, [materials]);

  /** groupId → module name, for the «Modul» column. */
  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of materialGroups) map.set(group.id, group.name);
    return map;
  }, [materialGroups]);

  // Render sort indicator
  const SortIndicator = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3 inline" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 inline" />
    );
  };

  // Extract unique locations with their sort orders and counts
  const locationCategories = useMemo(() => {
    const locationMap = new Map<string, { sort_order: number; count: number }>();

    materials.forEach((material) => {
      // An archived device lies in no depot any more — counting it would inflate
      // the location it used to sit in.
      if (material.archived_at) return;
      const location = material.location || '';
      if (!locationMap.has(location)) {
        locationMap.set(location, {
          sort_order: material.location_sort_order,
          count: 0,
        });
      }
      const current = locationMap.get(location)!;
      current.count++;
    });

    return Array.from(locationMap.entries())
      .map(([name, data]) => ({
        name,
        sort_order: data.sort_order,
        count: data.count,
      }))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [materials]);

  const handleSaveLocationSortOrder = async (categories: Array<{ name: string; sort_order: number }>) => {
    await apiClient.updateMaterialCategorySortOrder({
      categories: categories.map((cat) => ({
        category: cat.name,
        sort_order: cat.sort_order,
      })),
    });
    await loadMaterials();
  };

  const isSaving = form.formState.isSubmitting;
  const typeValue = form.watch('type');
  const locationValue = form.watch('location');

  return (
    <div className="space-y-6">
      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="list">{t('materials.tabList')}</TabsTrigger>
          <TabsTrigger value="groups">{t('materials.tabModules')}</TabsTrigger>
          <TabsTrigger value="sort">{t('common.sortLocationsTab')}</TabsTrigger>
        </TabsList>

        {/* Alle drei Reiter tragen eine Karte: Module und Sortierung brachten ihre
            schon mit, die Liste stand als einzige direkt auf dem Seitenhintergrund.
            «Neues Material» zieht in den Kartenkopf, der Schwellenwert-Link bleibt
            als Untertitel darunter — er verweist weg, ist also kein Bedienelement. */}
        <TabsContent value="list" className="mt-4">
          <SettingCard
            subtitle={
              <Link
                href="/settings?section=notifications"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {t('materials.thresholdsLink')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            }
            action={
              <DemoLock active={demoMode}>
                <Button onClick={handleOpenCreate}>
                  <PlusCircle className="size-4" />
                  {t('materials.addButton')}
                </Button>
              </DemoLock>
            }
          >
          <DemoLock active={demoMode} className="space-y-4">
            <Dialog open={isDialogOpen} onOpenChange={guard.handleOpenChange}>
              <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>
                    {editingMaterial ? t('materials.dialogEditTitle') : t('materials.dialogCreateTitle')}
                  </DialogTitle>
                </DialogHeader>
                {/* `DetailField` rows, boxed controls — the grammar of the new-Einsatz modal.
                    `fieldState` off the Controller render props carries the validation
                    message, so the row needs neither FormItem nor FormMessage. */}
                <Form {...form}>
                  <form onSubmit={onSubmit} className="space-y-1 py-2" noValidate>
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field, fieldState }) => (
                        <DetailField
                          label={t('common.name')}
                          htmlFor="material-name"
                          required
                          error={fieldState.error?.message}
                        >
                          <Input
                            {...field}
                            id="material-name"
                            aria-invalid={!!fieldState.error}
                            placeholder={t('materials.namePlaceholder')}
                            autoFocus
                          />
                        </DetailField>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field, fieldState }) => (
                        <DetailField
                          label={t('common.type')}
                          htmlFor="material-type"
                          error={fieldState.error?.message}
                        >
                          <div className="flex gap-2">
                            <Input
                              {...field}
                              id="material-type"
                              aria-invalid={!!fieldState.error}
                              placeholder={t('materials.typePlaceholder')}
                              className="flex-1"
                            />
                            {existingTypes.filter((t) => t !== typeValue).length > 0 && (
                              <Select
                                value=""
                                onValueChange={(value) =>
                                  form.setValue('type', value, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  })
                                }
                              >
                                <SelectTrigger className="w-9 px-0 justify-center flex-shrink-0 [&>svg:first-child]:hidden">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {existingTypes
                                    .filter((t) => t !== typeValue)
                                    .map((t) => (
                                      <SelectItem key={t} value={t}>
                                        {t}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </DetailField>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="location"
                      render={({ field, fieldState }) => (
                        <DetailField
                          label={t('common.location')}
                          htmlFor="material-location"
                          error={fieldState.error?.message}
                        >
                          <div className="flex gap-2">
                            <Input
                              {...field}
                              id="material-location"
                              aria-invalid={!!fieldState.error}
                              placeholder={t('materials.locationPlaceholder')}
                              className="flex-1"
                            />
                            {existingLocations.filter((l) => l !== locationValue).length > 0 && (
                              <Select
                                value=""
                                onValueChange={(value) =>
                                  form.setValue('location', value, {
                                    shouldDirty: true,
                                    shouldValidate: true,
                                  })
                                }
                              >
                                <SelectTrigger className="w-9 px-0 justify-center flex-shrink-0 [&>svg:first-child]:hidden">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {existingLocations
                                    .filter((l) => l !== locationValue)
                                    .map((l) => (
                                      <SelectItem key={l} value={l}>
                                        {l}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </DetailField>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field, fieldState }) => (
                        <DetailField
                          label={t('common.status')}
                          htmlFor="material-status"
                          error={fieldState.error?.message}
                        >
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="material-status" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="available">{t('common.available')}</SelectItem>
                              <SelectItem value="unavailable">{t('common.unavailable')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </DetailField>
                      )}
                    />
                    {/* The bordered card with its sentence underneath is gone the same way
                        the Einsatz form's three toggles lost theirs: one line, and the
                        sentence lives on as the label's `title`. */}
                    <FormField
                      control={form.control}
                      name="consumable"
                      render={({ field }) => (
                        <DetailToggle
                          label={t('materials.consumableLabel')}
                          description={t('materials.consumableHint')}
                          icon={<PackageMinus className="h-3.5 w-3.5" />}
                          checked={field.value}
                          onToggle={field.onChange}
                        />
                      )}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={guard.requestClose}
                        disabled={isSaving}
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button type="submit" disabled={isSaving}>
                        {isSaving && <Loader2 className="size-4 animate-spin" />}
                        {editingMaterial ? t('common.update') : t('common.create')}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>

          {/* The archive is opened, not filtered: off, the endpoint returns no
              archived rows at all. The count on the right is the only hint that
              anything is behind the toggle. */}
          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={showArchived} onCheckedChange={() => { void toggleShowArchived(); }} />
              {t('lifecycle.showArchived')}
            </label>
            {showArchived && (
              <span className="text-xs text-muted-foreground">
                {t('lifecycle.archivedCount', { count: archivedCount })}
              </span>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('name')}
                >
                  {t('materials.deviceHead')}<SortIndicator column="name" />
                </TableHead>
                {/* One word per axis: Typ = what it is, Standort = where it
                    lies, Modul = what it belongs with. The «Kategorie» head that
                    used to sit here showed the location and the form called the
                    same field «Standort». */}
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('type')}
                >
                  {t('common.type')}<SortIndicator column="type" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('location')}
                >
                  {t('common.location')}<SortIndicator column="location" />
                </TableHead>
                <TableHead>{t('materials.moduleHead')}</TableHead>
                <TableHead>{t('lifecycle.notReady')}</TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 select-none"
                  onClick={() => handleSort('status')}
                >
                  {t('common.status')}<SortIndicator column="status" />
                </TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMaterials.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {t('materials.empty')}
                  </TableCell>
                </TableRow>
              )}
              {sortedMaterials.map((material) => {
                const state = rowState(material);
                const isArchived = state === 'archived';
                return (
                <TableRow key={material.id} className={isArchived ? 'bg-muted/40 text-muted-foreground' : undefined}>
                  <TableCell className="font-medium">
                    <span className={isArchived ? 'line-through' : undefined}>{material.name}</span>
                    {material.consumable && <InfinityIcon className="inline ml-1.5 h-3.5 w-3.5 text-muted-foreground" />}
                  </TableCell>
                  <TableCell>
                    <span className="px-2 py-1 rounded text-xs bg-muted text-muted-foreground">
                      {material.type || '–'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded text-xs ${isArchived ? 'bg-muted text-muted-foreground' : 'bg-accent text-accent-foreground'}`}>
                      {material.location || 'General'}
                    </span>
                  </TableCell>
                  <TableCell>
                    {material.group_id && groupNameById.has(material.group_id) ? (
                      <span className="px-2 py-1 rounded text-xs bg-muted text-muted-foreground">
                        {groupNameById.get(material.group_id)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isArchived ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Checkbox
                          checked={material.out_of_service}
                          onCheckedChange={(checked) => { void handleToggleOutOfService(material, checked === true); }}
                          aria-label={t('lifecycle.notReadyAria', { name: material.name })}
                        />
                        {material.out_of_service && material.out_of_service_since && (
                          <span className="text-xs text-muted-foreground">
                            {t('lifecycle.notReadySince', { date: shortDate(material.out_of_service_since) })}
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Word + glyph, never colour on its own — three states that
                        have to stay apart on a projector and in greyscale. */}
                    {isArchived ? (
                      <span className="space-y-0.5">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <Archive className="size-3.5" />
                          {t('lifecycle.archivedOn', { date: shortDate(material.archived_at) })}
                        </span>
                        <span className="block text-2xs text-muted-foreground">
                          {material.assignment_count
                            ? t('lifecycle.stoodOnIncidents', { count: material.assignment_count })
                            : t('lifecycle.neverOnIncident')}
                        </span>
                      </span>
                    ) : state === 'outOfService' ? (
                      <span className="inline-flex items-center gap-1.5 rounded border border-dashed border-muted-foreground/60 px-2 py-1 text-xs font-medium text-muted-foreground">
                        <Ban className="size-3.5" />
                        {t('lifecycle.notReady')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium bg-success/10 text-success">
                        <Check className="size-3.5" />
                        {t('common.available')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isArchived ? (
                      <span className="inline-flex gap-1">
                        <Button variant="outline" size="sm" onClick={() => { void handleRestore(material); }}>
                          <ArchiveRestore className="size-3.5" />
                          {t('lifecycle.restore')}
                        </Button>
                        {/* Greyed on the API's own answer (`can_delete`), with the
                            reason in the title — the button and the 409 rule can
                            never drift apart because they read the same field. */}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={material.can_delete === false}
                          title={
                            material.can_delete === false
                              ? t('lifecycle.stoodOnIncidents', { count: material.assignment_count ?? 0 })
                              : undefined
                          }
                          onClick={() => setMaterialToPurge(material)}
                          className={material.can_delete === false ? undefined : 'text-destructive hover:bg-destructive/10 hover:text-destructive'}
                        >
                          <Trash2 className="size-3.5" />
                          {t('lifecycle.deletePermanently')}
                        </Button>
                      </span>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(material)}
                        >
                          <Edit className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(material)}
                          title={t('lifecycle.archive')}
                          aria-label={t('lifecycle.archive')}
                        >
                          <Archive className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </DemoLock>
          </SettingCard>
        </TabsContent>

        <TabsContent value="groups" className="mt-4">
          <DemoLock active={demoMode}>
            <MaterialGroupSettings
              groups={materialGroups}
              materials={materials}
              onRefresh={() => { loadGroups(); loadMaterials(); }}
            />
          </DemoLock>
        </TabsContent>

        <TabsContent value="sort" className="mt-4">
          <CategorySortOrder
            title={t('materials.sortTitle')}
            description={t('materials.sortDescription')}
            categories={locationCategories}
            onSave={handleSaveLocationSortOrder}
            readOnly={demoMode}
          />
        </TabsContent>
      </Tabs>

      {/* Archiving is the normal way out, and the dialog says what it actually
          does. The old one promised «kann nicht rückgängig gemacht werden» and
          then only set a status, leaving the row on the board. */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('materials.archiveTitle', { name: materialToDelete?.name ?? '' })}
        description={t('materials.archiveDescription')}
        confirmText={t('lifecycle.archive')}
        onConfirm={handleArchiveConfirm}
      >
        <div className="rounded-lg border p-3 text-sm">
          <p className="flex items-start gap-2">
            <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('lifecycle.archiveConsequenceDrop')}
          </p>
          <p className="mt-2 flex items-start gap-2">
            <ArchiveRestore className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('lifecycle.archiveConsequenceRestore')}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">{t('materials.archiveHint')}</p>
        </div>
      </ConfirmDialog>

      {/* The rare way: typos and test entries. Only reachable from the archive,
          and only for devices the API says may go — see `can_delete`. */}
      <ConfirmDialog
        open={!!materialToPurge}
        onOpenChange={(open) => { if (!open) setMaterialToPurge(null); }}
        variant="destructive"
        title={t('materials.purgeTitle', { name: materialToPurge?.name ?? '' })}
        description={t('materials.purgeDescription')}
        confirmText={t('lifecycle.deletePermanently')}
        onConfirm={handlePurgeConfirm}
      >
        <div className="rounded-lg border p-3 text-sm">
          <p className="flex items-start gap-2">
            <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('lifecycle.purgeConsequenceLists')}
          </p>
          <p className="mt-2 flex items-start gap-2">
            <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('lifecycle.purgeConsequenceNoReturn')}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">{t('materials.purgeHint')}</p>
        </div>
      </ConfirmDialog>

      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}

// ─── Material Group Settings ──────────────────────────────────
function MaterialGroupSettings({
  groups,
  materials,
  onRefresh,
}: {
  groups: ApiMaterialGroup[]
  materials: ApiMaterialResource[]
  onRefresh: () => void
}) {
  const t = useTranslations('settings')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ApiMaterialGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupLocation, setGroupLocation] = useState('')
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [groupToDelete, setGroupToDelete] = useState<ApiMaterialGroup | null>(null)

  const existingLocations = useMemo(() => {
    const locs = new Set(materials.map(m => m.location || '').filter(Boolean))
    return Array.from(locs).sort()
  }, [materials])

  const handleOpenCreate = () => {
    setEditingGroup(null)
    setGroupName('')
    setGroupLocation('')
    setSelectedMaterialIds(new Set())
    setIsDialogOpen(true)
  }

  const handleOpenEdit = (group: ApiMaterialGroup) => {
    setEditingGroup(group)
    setGroupName(group.name)
    setGroupLocation(group.location)
    setSelectedMaterialIds(new Set(group.materials.map(m => m.id)))
    setIsDialogOpen(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const data = {
        name: groupName,
        location: groupLocation,
        material_ids: Array.from(selectedMaterialIds),
      }
      if (editingGroup) {
        await apiClient.updateMaterialGroup(editingGroup.id, data)
      } else {
        await apiClient.createMaterialGroup(data)
      }
      setIsDialogOpen(false)
      onRefresh()
    } catch (error) {
      console.error('Failed to save group:', error)
      toast.error(t('materials.groups.saveError'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!groupToDelete) return
    try {
      await apiClient.deleteMaterialGroup(groupToDelete.id)
      onRefresh()
    } catch (error) {
      console.error('Failed to delete group:', error)
      toast.error(t('materials.groups.deleteError'))
    } finally {
      setGroupToDelete(null)
    }
  }

  const toggleMaterial = (id: string) => {
    setSelectedMaterialIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Available materials = ungrouped + materials already in this group. Archived
  // devices are out of the inventory and cannot join a module.
  const availableMaterials = materials.filter(
    m => !m.consumable && !m.archived_at && (!m.group_id || (editingGroup && editingGroup.materials.some(gm => gm.id === m.id)))
  )

  return (
    /* Der Einleitungssatz ist der Untertitel der Karte und der Knopf ihre Aktion –
       dieselbe Kopfzeile wie bei jeder anderen Karte der Seite. */
    <div className="space-y-6">
      <SettingCard
        subtitle={t('materials.groups.intro')}
        action={
          <Button onClick={handleOpenCreate} size="sm">
            <PlusCircle className="size-3.5" />
            {t('materials.groups.createButton')}
          </Button>
        }
      >
      {groups.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 text-sm">
          {t('materials.groups.empty')}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common.name')}</TableHead>
              <TableHead>{t('common.location')}</TableHead>
              <TableHead>{t('materials.groups.materialsHead')}</TableHead>
              <TableHead className="text-right">{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={group.id}>
                <TableCell className="font-medium">{group.name}</TableCell>
                <TableCell>
                  <span className="px-2 py-1 rounded text-xs bg-accent text-accent-foreground">
                    {group.location || '–'}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {group.materials.length > 0
                    ? group.materials.map(m => m.name).join(', ')
                    : <span className="italic">{t('materials.groups.noMaterials')}</span>
                  }
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(group)}>
                    <Edit className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setGroupToDelete(group); setDeleteDialogOpen(true); }}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      </SettingCard>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg modal-h-tall flex flex-col" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editingGroup ? t('materials.groups.dialogEditTitle') : t('materials.groups.dialogCreateTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 space-y-1 overflow-y-auto py-2">
            <DetailField label={t('common.name')} htmlFor="group-name" required>
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={t('materials.groups.namePlaceholder')}
              />
            </DetailField>
            <DetailField label={t('common.location')} htmlFor="group-location">
              <Select
                value={groupLocation}
                onValueChange={(value) => setGroupLocation(value)}
              >
                <SelectTrigger id="group-location" className="w-full">
                  <SelectValue placeholder={t('materials.groups.locationPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {existingLocations.map(l => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DetailField>
            {/* The pick list is a scrolling box, so the label sits at the top of the row. */}
            <DetailField label={t('materials.groups.selectMaterials')} alignStart>
              <div className="max-h-[250px] space-y-1 overflow-y-auto rounded-md border p-2">
                {availableMaterials.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">{t('materials.groups.noAvailableMaterials')}</p>
                ) : (
                  availableMaterials.map((mat) => (
                    <label
                      key={mat.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedMaterialIds.has(mat.id)}
                        onChange={() => toggleMaterial(mat.id)}
                        className="rounded"
                      />
                      <span className="text-sm">{mat.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{mat.location}</span>
                    </label>
                  ))
                )}
              </div>
            </DetailField>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={isSaving || !groupName.trim()}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {editingGroup ? t('common.update') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('materials.groups.deleteTitle')}
        description={t('materials.groups.deleteDescription', { name: groupToDelete?.name ?? '' })}
        onConfirm={handleDelete}
      />
    </div>
  )
}
