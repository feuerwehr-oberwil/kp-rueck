'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldMessageProps } from '@/components/ui/form-message';
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
import { PlusCircle, Edit, Trash2, ArrowRight, Infinity as InfinityIcon, PackageMinus } from 'lucide-react';
import Link from 'next/link';
import { apiClient, ApiMaterialResource, ApiMaterialGroup } from '@/lib/api-client';
import { CategorySortOrder } from './category-sort-order';
import { DemoLock } from './demo-lock';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { ArchiveDialogs, ArchiveToggle, LifecycleCells, LifecycleHeads, SortableHead } from './inventory-table';
import { rowState, rowStateRank, useArchivableInventory, useInventoryDialog } from './use-archivable-inventory';
import {
  materialFormDefaults,
  materialFormSchema,
  type MaterialFormValues,
} from '@/lib/schemas/material';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ShellLoader } from '@/components/ui/shell-loader';

type SortColumn = 'name' | 'type' | 'location' | 'status';

/** Ascending order of two inventory rows on one column. Lowercased strings
 *  compare with `<`/`>` (code-unit order), as this list always has. */
function compareMaterials(a: ApiMaterialResource, b: ApiMaterialResource, column: SortColumn): number {
  let aVal: string | number;
  let bVal: string | number;

  switch (column) {
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
      aVal = rowStateRank(a);
      bVal = rowStateRank(b);
      break;
    default:
      return 0;
  }

  if (aVal < bVal) return -1;
  if (aVal > bVal) return 1;
  return 0;
}

/** A tab label that may take two lines on a phone rather than run out of its third. */
const TAB_WRAP = 'h-auto min-h-[calc(2.25rem-7px)] whitespace-normal py-1 leading-tight'

export function MaterialSettings({ demoMode = false }: { demoMode?: boolean }) {
  const t = useTranslations('settings');
  const [materialGroups, setMaterialGroups] = useState<ApiMaterialGroup[]>([]);

  const form = useForm<MaterialFormValues>({
    resolver: zodResolver(materialFormSchema),
    defaultValues: materialFormDefaults,
  });
  const dialog = useInventoryDialog<ApiMaterialResource, MaterialFormValues>(form, materialFormDefaults);
  const { guard } = dialog;

  const inventory = useArchivableInventory<ApiMaterialResource, SortColumn>({
    api: {
      list: (includeArchived) => apiClient.getAllMaterials({ includeArchived }),
      archive: (id) => apiClient.archiveMaterialResource(id),
      restore: (id) => apiClient.restoreMaterialResource(id),
      purge: (id) => apiClient.deleteMaterialResource(id, { permanent: true }),
      setOutOfService: (id, outOfService) => apiClient.updateMaterialResource(id, { out_of_service: outOfService }),
    },
    compare: compareMaterials,
    initialSort: 'name',
    loadError: t('materials.loadError'),
    failureDescription: t('materials.deleteErrorDescription'),
    logNoun: 'material',
  });
  const { rows: materials, sort } = inventory;

  // The modules load once on mount, after the rows (`useArchivableInventory`).
  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      const data = await apiClient.getMaterialGroups();
      // Same degrade-to-undefined guard as the rows' load — keep previous state.
      if (!data) return;
      setMaterialGroups(data);
    } catch (error) {
      console.error('Failed to load material groups:', error);
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (dialog.editing) {
        await apiClient.updateMaterialResource(dialog.editing.id, values);
      } else {
        await apiClient.createMaterialResource(values);
      }
      await inventory.reload();
      dialog.close();
    } catch (error) {
      console.error('Failed to save material:', error);
      toast.error(t('materials.saveError'), {
        description: t('common.checkInputRetry'),
      });
    }
  });

  const handleEdit = (material: ApiMaterialResource) => {
    dialog.open(material, {
      name: material.name,
      type: material.type || '',
      status:
        material.status === 'available' || material.status === 'unavailable'
          ? material.status
          : 'available',
      location: material.location || '',
      consumable: material.consumable ?? false,
    });
  };

  const handleOpenCreate = () => {
    dialog.open(null, materialFormDefaults);
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

  /** groupId → module name, for the «Modul» column. */
  const groupNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of materialGroups) map.set(group.id, group.name);
    return map;
  }, [materialGroups]);

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
    await inventory.reload();
  };

  const isSaving = form.formState.isSubmitting;
  const typeValue = form.watch('type');
  const locationValue = form.watch('location');

  return (
    <div className="space-y-6">
      <Tabs defaultValue="list" className="w-full">
        {/* Three equal thirds of a 360px phone are ~100px: «Standorte sortieren» ran out of
            its tab. The labels wrap there instead (overflow sweep, 03.10.). */}
        <TabsList className="grid h-auto min-h-9 w-full grid-cols-3">
          <TabsTrigger value="list" className={TAB_WRAP}>{t('materials.tabList')}</TabsTrigger>
          <TabsTrigger value="groups" className={TAB_WRAP}>{t('materials.tabModules')}</TabsTrigger>
          <TabsTrigger value="sort" className={TAB_WRAP}>{t('common.sortLocationsTab')}</TabsTrigger>
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
                className="inline-flex items-center gap-1 text-xs text-foreground underline underline-offset-2 hover:decoration-2"
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
            <Dialog open={dialog.isOpen} onOpenChange={guard.handleOpenChange}>
              <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                  <DialogTitle>
                    {dialog.editing ? t('materials.dialogEditTitle') : t('materials.dialogCreateTitle')}
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
                            {...fieldMessageProps('material-name', fieldState.error ? 'error' : null)}
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
                              {...fieldMessageProps('material-type', fieldState.error ? 'error' : null)}
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
                              {...fieldMessageProps('material-location', fieldState.error ? 'error' : null)}
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
                        {isSaving && <ShellLoader className="size-4" />}
                        {dialog.editing ? t('common.update') : t('common.create')}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>

          <ArchiveToggle inventory={inventory} />

          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead sort={sort} column="name">
                  {t('materials.deviceHead')}
                </SortableHead>
                {/* One word per axis: Typ = what it is, Standort = where it
                    lies, Modul = what it belongs with. The «Kategorie» head that
                    used to sit here showed the location and the form called the
                    same field «Standort». */}
                <SortableHead sort={sort} column="type">
                  {t('common.type')}
                </SortableHead>
                <SortableHead sort={sort} column="location">
                  {t('common.location')}
                </SortableHead>
                <TableHead>{t('materials.moduleHead')}</TableHead>
                <LifecycleHeads sort={sort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {t('materials.empty')}
                  </TableCell>
                </TableRow>
              )}
              {inventory.sorted.map((material) => {
                const isArchived = rowState(material) === 'archived';
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
                  <LifecycleCells row={material} actions={inventory} onEdit={handleEdit} />
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
              onRefresh={() => { loadGroups(); inventory.reload(); }}
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

      <ArchiveDialogs
        inventory={inventory}
        copy={{
          archiveTitle: t('materials.archiveTitle', { name: inventory.archiveTarget?.name ?? '' }),
          archiveDescription: t('materials.archiveDescription'),
          archiveHint: t('materials.archiveHint'),
          purgeTitle: t('materials.purgeTitle', { name: inventory.purgeTarget?.name ?? '' }),
          purgeDescription: t('materials.purgeDescription'),
          purgeHint: t('materials.purgeHint'),
        }}
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
              {isSaving && <ShellLoader className="size-4" />}
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
