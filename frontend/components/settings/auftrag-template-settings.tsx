'use client';

/**
 * Standard-Aufträge — the Aufträge a station opens over and over («Sturmholz»,
 * «Absperren», «TLF-Backup»).
 *
 * The switch on each row is the whole feature: on means a new Lage opens with
 * that Auftrag already on the board, empty but coloured, annotated and holding
 * its usual equipment. Off keeps the Vorlage available as a one-click create in
 * the Aufträge-Slide-up, which is what a rarely-needed «TLF-Backup» wants.
 *
 * Everything saves as you touch it — colour, switch and resources immediately,
 * name and notes on blur. There is no Speichern button because there is no draft
 * state worth losing: the list is station configuration, not a form.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box';
import { ChevronDown, ChevronRight, GripVertical, Package, Plus, Trash2, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { RemovableChip } from '@/components/ui/removable-chip';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { SettingCard } from '@/components/settings/setting-row';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  apiClient,
  type ApiAuftragTemplate,
  type ApiAuftragTemplateResource,
  type TemplateResourceType,
} from '@/lib/api-client';
import { cn } from '@/lib/utils';

/** The Aufträge-Slide-up's own six swatches — a Vorlage must not be able to
 *  produce a colour the manual create dialog cannot. */
const SWATCHES = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'] as const;

/** One selectable vehicle or material, flattened for the picker. */
interface ResourceOption {
  resourceType: TemplateResourceType;
  id: string;
  name: string;
}

function resourceKey(ref: Pick<ApiAuftragTemplateResource, 'resource_type' | 'resource_id'>): string {
  return `${ref.resource_type}:${ref.resource_id}`;
}

export function AuftragTemplateSettings({ readOnly = false }: { readOnly?: boolean }) {
  const t = useTranslations('settings.page.auftragTemplates');

  const [templates, setTemplates] = useState<ApiAuftragTemplate[]>([]);
  const [options, setOptions] = useState<ResourceOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ApiAuftragTemplate | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      apiClient.getAuftragTemplates(),
      apiClient.getVehicles(),
      apiClient.getAllMaterials(),
    ])
      .then(([loadedTemplates, vehicles, materials]) => {
        setTemplates(loadedTemplates);
        setOptions([
          ...vehicles.map((vehicle) => ({
            resourceType: 'vehicle' as const,
            id: vehicle.id,
            name: vehicle.name,
          })),
          ...materials.map((material) => ({
            resourceType: 'material' as const,
            id: material.id,
            name: material.name,
          })),
        ]);
      })
      .catch(() => toast.error(t('loadFailed')))
      .finally(() => setLoaded(true));
  }, [t]);

  const optionsByKey = useMemo(() => {
    const map = new Map<string, ResourceOption>();
    for (const option of options) map.set(`${option.resourceType}:${option.id}`, option);
    return map;
  }, [options]);

  /** Patch one template, replacing it in place; rolls back on failure. */
  const patch = useCallback(
    async (template: ApiAuftragTemplate, changes: Parameters<typeof apiClient.updateAuftragTemplate>[1]) => {
      setSavingId(template.id);
      const previous = templates;
      setTemplates((current) =>
        current.map((item) => (item.id === template.id ? { ...item, ...changes } : item))
      );
      try {
        const updated = await apiClient.updateAuftragTemplate(template.id, changes);
        setTemplates((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      } catch {
        setTemplates(previous);
        toast.error(t('saveFailed'));
      } finally {
        setSavingId(null);
      }
    },
    [templates, t]
  );

  const createTemplate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created = await apiClient.createAuftragTemplate({ name, color: SWATCHES[0] });
      setTemplates((current) => [...current, created]);
      setNewName('');
      setExpandedId(created.id); // straight into editing — a bare name is not a Vorlage yet
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setCreating(false);
    }
  }, [newName, t]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const previous = templates;
    setTemplates((current) => current.filter((item) => item.id !== pendingDelete.id));
    try {
      await apiClient.deleteAuftragTemplate(pendingDelete.id);
    } catch {
      setTemplates(previous);
      toast.error(t('deleteFailed'));
    } finally {
      setPendingDelete(null);
    }
  }, [pendingDelete, templates, t]);

  // Drag-to-reorder, persisted on drop. Same mechanics as the Kategorien-Sortierung
  // list, minus its Speichern button — order here is one PATCH, not a form.
  useEffect(() => {
    if (readOnly) return;
    const element = containerRef.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      onDragStart: ({ source }) => setDraggingId(source.data.templateId as string),
      onDrop: ({ source, location }) => {
        setDraggingId(null);
        const target = location.current.dropTargets[0];
        if (!target) return;
        const sourceIndex = source.data.index as number;
        const targetIndex = target.data.index as number;
        if (sourceIndex === targetIndex) return;

        const edge = extractClosestEdge(target.data);
        const finishIndex =
          edge === 'bottom' && sourceIndex > targetIndex
            ? targetIndex + 1
            : edge === 'top' && sourceIndex < targetIndex
              ? targetIndex - 1
              : targetIndex;

        setTemplates((current) => {
          const next = reorder({ list: current, startIndex: sourceIndex, finishIndex });
          void apiClient
            .reorderAuftragTemplates(next.map((item) => item.id))
            .catch(() => toast.error(t('saveFailed')));
          return next;
        });
      },
    });
  }, [readOnly, t]);

  if (!loaded) {
    return (
      <Card className="p-5 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-24 w-full" />
      </Card>
    );
  }

  const autoCount = templates.filter((template) => template.auto_create).length;

  return (
    <SettingCard title={t('title')} subtitle={t('description')}>
      <div className="space-y-4">
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-6 text-center">
            {t('empty')}
          </p>
        ) : (
          <div ref={containerRef} className="divide-y divide-border rounded-lg border border-border">
            {templates.map((template, index) => (
              <TemplateRow
                key={template.id}
                template={template}
                index={index}
                expanded={expandedId === template.id}
                dragging={draggingId === template.id}
                saving={savingId === template.id}
                readOnly={readOnly}
                options={options}
                optionsByKey={optionsByKey}
                onToggleExpanded={() =>
                  setExpandedId((current) => (current === template.id ? null : template.id))
                }
                onPatch={(changes) => void patch(template, changes)}
                onDelete={() => setPendingDelete(template)}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void createTemplate();
              }
            }}
            placeholder={t('newPlaceholder')}
            className="h-9 max-w-xs"
            disabled={readOnly || creating}
          />
          <Button
            size="sm"
            onClick={() => void createTemplate()}
            disabled={readOnly || creating || !newName.trim()}
          >
            <Plus className="h-4 w-4" />
            {t('add')}
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {t('summary', { count: templates.length, auto: autoCount })}
          </span>
        </div>

        <DeleteConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => !open && setPendingDelete(null)}
          title={t('deleteTitle')}
          description={t('deleteDescription', { name: pendingDelete?.name ?? '' })}
          onConfirm={confirmDelete}
        />
      </div>
    </SettingCard>
  );
}

function TemplateRow({
  template,
  index,
  expanded,
  dragging,
  saving,
  readOnly,
  options,
  optionsByKey,
  onToggleExpanded,
  onPatch,
  onDelete,
}: {
  template: ApiAuftragTemplate;
  index: number;
  expanded: boolean;
  dragging: boolean;
  saving: boolean;
  readOnly: boolean;
  options: ResourceOption[];
  optionsByKey: Map<string, ResourceOption>;
  onToggleExpanded: () => void;
  onPatch: (changes: Parameters<typeof apiClient.updateAuftragTemplate>[1]) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('settings.page.auftragTemplates');
  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (readOnly) return;
    const element = rowRef.current;
    const handle = handleRef.current;
    if (!element || !handle) return;

    return combine(
      draggable({
        element: handle,
        getInitialData: () => ({ index, templateId: template.id }),
      }),
      dropTargetForElements({
        element,
        getData: ({ input }) =>
          attachClosestEdge({ index }, { element, input, allowedEdges: ['top', 'bottom'] }),
        canDrop: ({ source }) => source.data.index !== index,
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      })
    );
  }, [index, template.id, readOnly]);

  const selected = template.resources.map((ref) => ({
    ref,
    option: optionsByKey.get(resourceKey(ref)),
  }));
  const selectedKeys = new Set(template.resources.map(resourceKey));

  const setResources = (next: ApiAuftragTemplateResource[]) => onPatch({ resources: next });

  return (
    <div
      ref={rowRef}
      className={cn('relative space-y-2 p-3', !template.auto_create && 'opacity-70', dragging && 'opacity-50')}
    >
      <div className="flex items-center gap-2">
        <div
          ref={handleRef}
          className={readOnly ? 'text-muted-foreground/40' : 'cursor-grab active:cursor-grabbing touch-none'}
          aria-hidden="true"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: template.color ?? 'var(--muted-foreground)' }}
        />
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex items-center gap-1.5 text-sm font-medium hover:underline"
          aria-expanded={expanded}
        >
          {template.name}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {t('resourceCount', { count: template.resources.length })}
        </span>
        <span className="w-24 text-right text-xs text-muted-foreground">
          {template.auto_create ? t('autoOn') : t('autoOff')}
        </span>
        <Switch
          checked={template.auto_create}
          disabled={readOnly || saving}
          onCheckedChange={(on) => onPatch({ auto_create: on })}
          aria-label={t('autoLabel', { name: template.name })}
        />
      </div>

      {expanded && (
        <div className="space-y-3 pl-6">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('nameLabel')}</div>
            <Input
              key={template.name}
              defaultValue={template.name}
              className="h-8 max-w-xs text-xs"
              disabled={readOnly || saving}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value && value !== template.name) onPatch({ name: value });
                else event.target.value = template.name;
              }}
            />
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('colorLabel')}</div>
            <div className="flex gap-1.5">
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  disabled={readOnly || saving}
                  onClick={() => onPatch({ color: swatch })}
                  className={cn(
                    'h-5 w-5 rounded-sm border-2 disabled:cursor-not-allowed',
                    template.color === swatch ? 'border-foreground' : 'border-transparent'
                  )}
                  style={{ backgroundColor: swatch }}
                  aria-label={t('colorSwatch', { color: swatch })}
                  aria-pressed={template.color === swatch}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('notesLabel')}</div>
            <Textarea
              key={template.notes ?? ''}
              defaultValue={template.notes ?? ''}
              placeholder={t('notesPlaceholder')}
              className="min-h-16 text-xs"
              disabled={readOnly || saving}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== (template.notes ?? '')) onPatch({ notes: value || null });
              }}
            />
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('resourcesLabel')}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {selected.map(({ ref, option }) => (
                <RemovableChip
                  key={resourceKey(ref)}
                  onRemove={
                    readOnly
                      ? undefined
                      : () =>
                          setResources(
                            template.resources.filter((item) => resourceKey(item) !== resourceKey(ref))
                          )
                  }
                  removeTitle={t('removeResource')}
                >
                  {ref.resource_type === 'vehicle' ? (
                    <Truck className="mr-1 h-3 w-3" />
                  ) : (
                    <Package className="mr-1 h-3 w-3" />
                  )}
                  {/* A resource deleted after the Vorlage was written: shown as
                      missing rather than silently dropped, so the station can fix it. */}
                  {option?.name ?? t('resourceMissing')}
                </RemovableChip>
              ))}

              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="xs" disabled={readOnly || saving}>
                    <Plus className="h-3 w-3" />
                    {t('addResource')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('searchResource')} />
                    <CommandList>
                      <CommandEmpty>{t('noResource')}</CommandEmpty>
                      {(['vehicle', 'material'] as const).map((kind) => (
                        <CommandGroup key={kind} heading={t(`resourceGroup.${kind}`)}>
                          {options
                            .filter(
                              (option) =>
                                option.resourceType === kind &&
                                !selectedKeys.has(`${option.resourceType}:${option.id}`)
                            )
                            .map((option) => (
                              <CommandItem
                                key={option.id}
                                value={`${option.name} ${kind}`}
                                onSelect={() => {
                                  setResources([
                                    ...template.resources,
                                    { resource_type: kind, resource_id: option.id },
                                  ]);
                                  setPickerOpen(false);
                                }}
                              >
                                {kind === 'vehicle' ? (
                                  <Truck className="h-3.5 w-3.5" />
                                ) : (
                                  <Package className="h-3.5 w-3.5" />
                                )}
                                {option.name}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <Button
            variant="ghost"
            size="xs"
            className="text-destructive hover:text-destructive"
            disabled={readOnly || saving}
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
            {t('delete')}
          </Button>
        </div>
      )}

      {closestEdge && <DropIndicator edge={closestEdge} />}
    </div>
  );
}
