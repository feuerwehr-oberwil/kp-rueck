'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { DetailField } from '@/components/kanban/detail-field';
import { PlusCircle, Edit, Archive, ArchiveRestore, Trash2, Loader2, ArrowUp, ArrowDown, Ban, Check, CircleSlash } from 'lucide-react';
import { apiClient, ApiError, ApiVehicle } from '@/lib/api-client';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { useUnsavedChangesWarning } from '@/lib/hooks/use-unsaved-changes-warning';
import {
  vehicleFormDefaults,
  vehicleFormSchema,
  type VehicleFormValues,
} from '@/lib/schemas/vehicle';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

type SortColumn = 'display_order' | 'name' | 'radio_call_sign' | 'status';

/** "19.08." — the short stamp the archive line and «seit …» both use. */
function shortDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`;
}

/** Lifecycle/readiness of one fleet row. Deployment is per-Ereignis and lives on
 *  the board, so it is deliberately absent here. */
type RowState = 'archived' | 'outOfService' | 'available';

function rowState(vehicle: ApiVehicle): RowState {
  if (vehicle.archived_at) return 'archived';
  if (vehicle.out_of_service) return 'outOfService';
  return 'available';
}

export function VehicleSettings() {
  const t = useTranslations('settings');
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<ApiVehicle | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [vehicleToDelete, setVehicleToDelete] = useState<ApiVehicle | null>(null);
  // The archive is a second, quieter list behind a toggle — off, the endpoint
  // does not return archived rows at all.
  const [showArchived, setShowArchived] = useState(false);
  const [vehicleToPurge, setVehicleToPurge] = useState<ApiVehicle | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>('display_order');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: vehicleFormDefaults,
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingVehicle(null);
    form.reset(vehicleFormDefaults);
  };

  const guard = useUnsavedChangesWarning({
    isDirty: form.formState.isDirty,
    isOpen: isDialogOpen,
    onClose: closeDialog,
  });

  // Load once on mount. `loadVehicles` is a plain function re-created on every
  // render, so listing it as a dep would refetch on every render.
  useEffect(() => {
    loadVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadVehicles = async (includeArchived = showArchived) => {
    try {
      const data = await apiClient.getVehicles({ includeArchived });
      if (!data) {
        // GET degraded to undefined after retries — keep previous state instead
        // of crashing the sort memos with a non-iterable value.
        if (vehicles.length === 0) {
          toast.error(t('vehicles.loadError'), {
            description: t('common.reloadPage'),
          });
        }
        return;
      }
      setVehicles(data);
    } catch (error) {
      console.error('Failed to load vehicles:', error);
    }
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortedVehicles = useMemo(() => {
    const stateRank: Record<RowState, number> = { available: 0, outOfService: 1, archived: 2 };
    return [...vehicles].sort((a, b) => {
      // Archived rows always sink to the bottom, whatever the column: they are a
      // second list, not a peer of the fleet above them.
      if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;
      let comparison = 0;
      switch (sortColumn) {
        case 'display_order':
          comparison = a.display_order - b.display_order;
          break;
        case 'name':
          comparison = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case 'radio_call_sign':
          comparison = a.radio_call_sign
            .toLowerCase()
            .localeCompare(b.radio_call_sign.toLowerCase());
          break;
        case 'status':
          comparison = stateRank[rowState(a)] - stateRank[rowState(b)];
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [vehicles, sortColumn, sortDirection]);

  const archivedCount = useMemo(() => vehicles.filter((v) => v.archived_at).length, [vehicles]);

  const SortIndicator = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3 inline" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 inline" />
    );
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = { ...values, type: values.type?.trim() || values.name };
    try {
      if (editingVehicle) {
        await apiClient.updateVehicle(editingVehicle.id, payload);
      } else {
        await apiClient.createVehicle(payload);
      }
      await loadVehicles();
      closeDialog();
    } catch (error) {
      console.error('Failed to save vehicle:', error);
      toast.error(t('vehicles.saveError'), {
        description: t('common.checkInputRetry'),
      });
    }
  });

  const handleEdit = (vehicle: ApiVehicle) => {
    setEditingVehicle(vehicle);
    form.reset({
      name: vehicle.name,
      type: vehicle.type,
      display_order: vehicle.display_order,
      status:
        vehicle.status === 'available' || vehicle.status === 'unavailable'
          ? vehicle.status
          : 'available',
      radio_call_sign: vehicle.radio_call_sign,
    });
    setIsDialogOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingVehicle(null);
    form.reset({
      ...vehicleFormDefaults,
      display_order: vehicles.length + 1,
    });
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (vehicle: ApiVehicle) => {
    setVehicleToDelete(vehicle);
    setDeleteDialogOpen(true);
  };

  /** The normal way to retire a unit: reversible, and it really does leave the
   *  board — the dialog that leads here names both facts. Like the purge below,
   *  the API refuses with 409 while the unit stands on an open Einsatz — that
   *  answer gets its own sentence instead of the generic failure. */
  const handleArchiveConfirm = async () => {
    if (!vehicleToDelete) return;
    try {
      await apiClient.archiveVehicle(vehicleToDelete.id);
      await loadVehicles();
    } catch (error) {
      console.error('Failed to archive vehicle:', error);
      toast.error(t('lifecycle.archiveError'), {
        description: ApiError.isConflictError(error)
          ? t('lifecycle.archiveInUseDescription')
          : t('vehicles.deleteErrorDescription'),
      });
    } finally {
      setVehicleToDelete(null);
    }
  };

  const handleRestore = async (vehicle: ApiVehicle) => {
    try {
      await apiClient.restoreVehicle(vehicle.id);
      await loadVehicles();
    } catch (error) {
      console.error('Failed to restore vehicle:', error);
      toast.error(t('lifecycle.restoreError'));
    }
  };

  /** The API refuses with 409 and a German sentence when the unit stood on a
   *  live Einsatz — surface that sentence rather than inventing one. */
  const handlePurgeConfirm = async () => {
    if (!vehicleToPurge) return;
    try {
      await apiClient.deleteVehicle(vehicleToPurge.id, { permanent: true });
      await loadVehicles();
    } catch (error) {
      console.error('Failed to delete vehicle permanently:', error);
      toast.error(t('lifecycle.purgeError'), {
        description: error instanceof ApiError ? error.message : t('vehicles.deleteErrorDescription'),
      });
    } finally {
      setVehicleToPurge(null);
    }
  };

  /** «Nicht einsatzbereit» — the same single field, the same `{ out_of_service }`
   *  PUT the board's right-click menu sends for material. */
  const handleToggleOutOfService = async (vehicle: ApiVehicle, outOfService: boolean) => {
    try {
      const updated = await apiClient.updateVehicle(vehicle.id, { out_of_service: outOfService });
      setVehicles((list) => list.map((v) => (v.id === vehicle.id ? updated : v)));
    } catch (error) {
      console.error('Failed to change vehicle readiness:', error);
      toast.error(t('lifecycle.notReadyError'));
    }
  };

  const toggleShowArchived = async () => {
    const next = !showArchived;
    setShowArchived(next);
    await loadVehicles(next);
  };

  const isSaving = form.formState.isSubmitting;

  return (
    /* Die Liste sitzt auf einer Karte wie jeder andere Abschnitt der Seite – sie war
       zuletzt die einzige, die direkt auf dem Seitenhintergrund stand. «Neues Fahrzeug»
       nimmt den Kopfplatz der Karte ein, denselben, in dem andere Karten ihren
       «Aktualisieren»-Knopf haben. */
    <div className="space-y-6">
      <SettingCard
        action={
          <Button onClick={handleOpenCreate}>
            <PlusCircle className="size-4" />
            {t('vehicles.addButton')}
          </Button>
        }
      >
        <Dialog open={isDialogOpen} onOpenChange={guard.handleOpenChange}>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {editingVehicle ? t('vehicles.dialogEditTitle') : t('vehicles.dialogCreateTitle')}
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
                      htmlFor="vehicle-name"
                      required
                      error={fieldState.error?.message}
                    >
                      <Input
                        {...field}
                        id="vehicle-name"
                        aria-invalid={!!fieldState.error}
                        placeholder={t('vehicles.namePlaceholder')}
                        autoFocus
                      />
                    </DetailField>
                  )}
                />
                <FormField
                  control={form.control}
                  name="display_order"
                  render={({ field, fieldState }) => (
                    <DetailField
                      label={t('vehicles.orderLabel')}
                      htmlFor="vehicle-display-order"
                      required
                      error={fieldState.error?.message}
                    >
                      <Input
                        id="vehicle-display-order"
                        type="number"
                        min={1}
                        aria-invalid={!!fieldState.error}
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          field.onChange(raw === '' ? Number.NaN : Number(raw));
                        }}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                        placeholder={t('vehicles.orderPlaceholder')}
                      />
                    </DetailField>
                  )}
                />
                <FormField
                  control={form.control}
                  name="radio_call_sign"
                  render={({ field, fieldState }) => (
                    <DetailField
                      label={t('common.radioCallSign')}
                      htmlFor="vehicle-radio-call-sign"
                      required
                      error={fieldState.error?.message}
                    >
                      <Input
                        {...field}
                        id="vehicle-radio-call-sign"
                        aria-invalid={!!fieldState.error}
                        placeholder={t('vehicles.radioPlaceholder')}
                      />
                    </DetailField>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field, fieldState }) => (
                    <DetailField
                      label={t('common.status')}
                      htmlFor="vehicle-status"
                      error={fieldState.error?.message}
                    >
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="vehicle-status" className="w-full">
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
                    {editingVehicle ? t('common.update') : t('common.create')}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

      {/* The archive is opened, not filtered — see the note in material-settings. */}
      <div className="flex items-center justify-between gap-3 pb-3">
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
              className="w-16 cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('display_order')}
            >
              #<SortIndicator column="display_order" />
            </TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('name')}
            >
              {t('common.name')}<SortIndicator column="name" />
            </TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('radio_call_sign')}
            >
              {t('common.radioCallSign')}<SortIndicator column="radio_call_sign" />
            </TableHead>
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
          {sortedVehicles.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                {t('vehicles.empty')}
              </TableCell>
            </TableRow>
          )}
          {sortedVehicles.map((vehicle) => {
            const state = rowState(vehicle);
            const isArchived = state === 'archived';
            return (
            <TableRow key={vehicle.id} className={isArchived ? 'bg-muted/40 text-muted-foreground' : undefined}>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {vehicle.display_order}
              </TableCell>
              <TableCell className="font-medium">
                <span className={isArchived ? 'line-through' : undefined}>{vehicle.name}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{vehicle.radio_call_sign}</TableCell>
              <TableCell>
                {isArchived ? (
                  <span className="text-muted-foreground">–</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Checkbox
                      checked={vehicle.out_of_service}
                      onCheckedChange={(checked) => { void handleToggleOutOfService(vehicle, checked === true); }}
                      aria-label={t('lifecycle.notReadyAria', { name: vehicle.name })}
                    />
                    {vehicle.out_of_service && vehicle.out_of_service_since && (
                      <span className="text-xs text-muted-foreground">
                        {t('lifecycle.notReadySince', { date: shortDate(vehicle.out_of_service_since) })}
                      </span>
                    )}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {/* Word + glyph, never colour on its own. */}
                {isArchived ? (
                  <span className="space-y-0.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Archive className="size-3.5" />
                      {t('lifecycle.archivedOn', { date: shortDate(vehicle.archived_at) })}
                    </span>
                    <span className="block text-2xs text-muted-foreground">
                      {vehicle.assignment_count
                        ? t('lifecycle.stoodOnIncidents', { count: vehicle.assignment_count })
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
                    <Button variant="outline" size="sm" onClick={() => { void handleRestore(vehicle); }}>
                      <ArchiveRestore className="size-3.5" />
                      {t('lifecycle.restore')}
                    </Button>
                    {/* Greyed on the API's own `can_delete`, with the reason in
                        the title — button and 409 rule read the same field. */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={vehicle.can_delete === false}
                      title={
                        vehicle.can_delete === false
                          ? t('lifecycle.stoodOnIncidents', { count: vehicle.assignment_count ?? 0 })
                          : undefined
                      }
                      onClick={() => setVehicleToPurge(vehicle)}
                      className={vehicle.can_delete === false ? undefined : 'text-destructive hover:bg-destructive/10 hover:text-destructive'}
                    >
                      <Trash2 className="size-3.5" />
                      {t('lifecycle.deletePermanently')}
                    </Button>
                  </span>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(vehicle)}>
                      <Edit className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteClick(vehicle)}
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
      </SettingCard>

      {/* Archiving is the normal way out, and the dialog says what it does. The
          old one promised «kann nicht rückgängig gemacht werden» and then only
          set a status, leaving the unit on the board. */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('vehicles.archiveTitle', { name: vehicleToDelete?.name ?? '' })}
        description={t('vehicles.archiveDescription')}
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
          <p className="mt-3 text-xs text-muted-foreground">{t('vehicles.archiveHint')}</p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!vehicleToPurge}
        onOpenChange={(open) => { if (!open) setVehicleToPurge(null); }}
        variant="destructive"
        title={t('vehicles.purgeTitle', { name: vehicleToPurge?.name ?? '' })}
        description={t('vehicles.purgeDescription')}
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
          <p className="mt-3 text-xs text-muted-foreground">{t('vehicles.purgeHint')}</p>
        </div>
      </ConfirmDialog>

      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}
