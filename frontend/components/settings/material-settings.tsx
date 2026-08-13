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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { PlusCircle, Edit, Trash2, Loader2, ArrowUp, ArrowDown, ArrowRight, Infinity as InfinityIcon } from 'lucide-react';
import Link from 'next/link';
import { apiClient, ApiMaterialResource, ApiMaterialGroup } from '@/lib/api-client';
import { CategorySortOrder } from './category-sort-order';
import { DemoLock } from './demo-lock';
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

export function MaterialSettings({ demoMode = false }: { demoMode?: boolean }) {
  const t = useTranslations('settings');
  const [materials, setMaterials] = useState<ApiMaterialResource[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<ApiMaterialResource | null>(null);
  const [materialGroups, setMaterialGroups] = useState<ApiMaterialGroup[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<ApiMaterialResource | null>(null);
  const [sortColumn, setSortColumn] = useState<'name' | 'location' | 'status'>('name');
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

  const loadMaterials = async () => {
    try {
      const data = await apiClient.getAllMaterials();
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

  const handleDeleteConfirm = async () => {
    if (!materialToDelete) return;
    try {
      await apiClient.deleteMaterialResource(materialToDelete.id);
      await loadMaterials();
    } catch (error) {
      console.error('Failed to delete material:', error);
      toast.error(t('materials.deleteError'), {
        description: t('materials.deleteErrorDescription'),
      });
    } finally {
      setMaterialToDelete(null);
    }
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
  const handleSort = (column: 'name' | 'location' | 'status') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sort materials based on current sort settings
  const sortedMaterials = useMemo(() => {
    return [...materials].sort((a, b) => {
      let aVal: string;
      let bVal: string;

      switch (sortColumn) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'location':
          aVal = (a.location || '').toLowerCase();
          bVal = (b.location || '').toLowerCase();
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [materials, sortColumn, sortDirection]);

  // Render sort indicator
  const SortIndicator = ({ column }: { column: 'name' | 'location' | 'status' }) => {
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
    <div className="space-y-4">
      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="list">{t('materials.tabList')}</TabsTrigger>
          <TabsTrigger value="groups">{t('materials.tabGroups')}</TabsTrigger>
          <TabsTrigger value="sort">{t('common.sortCategoriesTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <Link
            href="/settings?section=notifications"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {t('materials.thresholdsLink')}
            <ArrowRight className="h-3 w-3" />
          </Link>
          <DemoLock active={demoMode} className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={handleOpenCreate}>
              <PlusCircle className="size-4" />
              {t('materials.addButton')}
            </Button>
            <Dialog open={isDialogOpen} onOpenChange={guard.handleOpenChange}>
              <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>
                    {editingMaterial ? t('materials.dialogEditTitle') : t('materials.dialogCreateTitle')}
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
                              placeholder={t('materials.namePlaceholder')}
                              autoFocus
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-muted-foreground">{t('common.type')}</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t('materials.typePlaceholder')}
                                className="flex-1"
                              />
                            </FormControl>
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
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="location"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-muted-foreground">{t('common.location')}</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t('materials.locationPlaceholder')}
                                className="flex-1"
                              />
                            </FormControl>
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
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-sm font-semibold text-muted-foreground">{t('common.status')}</FormLabel>
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
                    <FormField
                      control={form.control}
                      name="consumable"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border p-3 space-y-0">
                          <div className="space-y-0.5">
                            <FormLabel>{t('materials.consumableLabel')}</FormLabel>
                            <p className="text-xs text-muted-foreground">
                              {t('materials.consumableHint')}
                            </p>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
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
                  onClick={() => handleSort('location')}
                >
                  {t('materials.categoryHead')}<SortIndicator column="location" />
                </TableHead>
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
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    {t('materials.empty')}
                  </TableCell>
                </TableRow>
              )}
              {sortedMaterials.map((material) => (
                <TableRow key={material.id}>
                  <TableCell className="font-medium">
                    {material.name}
                    {material.consumable && <InfinityIcon className="inline ml-1.5 h-3.5 w-3.5 text-muted-foreground" />}
                  </TableCell>
                  <TableCell>
                    <span className="px-2 py-1 rounded text-xs bg-accent text-accent-foreground">
                      {material.location || 'General'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        material.status === 'available'
                          ? 'bg-success/10 text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {material.status === 'available' ? t('common.available') : t('common.unavailable')}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
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

        <TabsContent value="groups">
          <DemoLock active={demoMode}>
            <MaterialGroupSettings
              groups={materialGroups}
              materials={materials}
              onRefresh={() => { loadGroups(); loadMaterials(); }}
            />
          </DemoLock>
        </TabsContent>

        <TabsContent value="sort">
          <CategorySortOrder
            title={t('materials.sortTitle')}
            description={t('materials.sortDescription')}
            categories={locationCategories}
            onSave={handleSaveLocationSortOrder}
            readOnly={demoMode}
          />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('materials.deleteTitle')}
        description={t('materials.deleteDescription', { name: materialToDelete?.name ?? '' })}
        onConfirm={handleDeleteConfirm}
      />

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

  // Available materials = ungrouped + materials already in this group
  const availableMaterials = materials.filter(
    m => !m.consumable && (!m.group_id || (editingGroup && editingGroup.materials.some(gm => gm.id === m.id)))
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t('materials.groups.intro')}
        </p>
        <Button onClick={handleOpenCreate} size="sm">
          <PlusCircle className="size-3.5" />
          {t('materials.groups.createButton')}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 text-sm">
          {t('materials.groups.empty')}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common.name')}</TableHead>
              <TableHead>{t('materials.categoryHead')}</TableHead>
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

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg modal-h-tall flex flex-col" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editingGroup ? t('materials.groups.dialogEditTitle') : t('materials.groups.dialogCreateTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-y-auto">
            <div className="space-y-1.5">
              <Label htmlFor="group-name" className="text-sm font-semibold text-muted-foreground">
                {t('common.name')} <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={t('materials.groups.namePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-location" className="text-sm font-semibold text-muted-foreground">{t('common.location')}</Label>
              <Select
                value={groupLocation}
                onValueChange={(value) => setGroupLocation(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('materials.groups.locationPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {existingLocations.map(l => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-semibold text-muted-foreground">{t('materials.groups.selectMaterials')}</Label>
              <div className="mt-2 space-y-1 max-h-[250px] overflow-y-auto border rounded-md p-2">
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
            </div>
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
