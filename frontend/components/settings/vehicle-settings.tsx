'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fieldMessageProps } from '@/components/ui/form-message';
import {
  Table,
  TableBody,
  TableCell,
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
import { PlusCircle } from 'lucide-react';
import { apiClient, ApiVehicle } from '@/lib/api-client';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { ArchiveDialogs, ArchiveToggle, LifecycleCells, LifecycleHeads, SortableHead } from './inventory-table';
import { rowState, rowStateRank, useArchivableInventory, useInventoryDialog } from './use-archivable-inventory';
import {
  vehicleFormDefaults,
  vehicleFormSchema,
  type VehicleFormValues,
} from '@/lib/schemas/vehicle';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ShellLoader } from '@/components/ui/shell-loader';

type SortColumn = 'display_order' | 'name' | 'radio_call_sign' | 'status';

/** Ascending order of two fleet rows on one column. */
function compareVehicles(a: ApiVehicle, b: ApiVehicle, column: SortColumn): number {
  switch (column) {
    case 'display_order':
      return a.display_order - b.display_order;
    case 'name':
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    case 'radio_call_sign':
      return a.radio_call_sign.toLowerCase().localeCompare(b.radio_call_sign.toLowerCase());
    case 'status':
      return rowStateRank(a) - rowStateRank(b);
  }
}

export function VehicleSettings() {
  const t = useTranslations('settings');

  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: vehicleFormDefaults,
  });
  const dialog = useInventoryDialog<ApiVehicle, VehicleFormValues>(form, vehicleFormDefaults);
  const { guard } = dialog;

  const inventory = useArchivableInventory<ApiVehicle, SortColumn>({
    api: {
      list: (includeArchived) => apiClient.getVehicles({ includeArchived }),
      archive: (id) => apiClient.archiveVehicle(id),
      restore: (id) => apiClient.restoreVehicle(id),
      purge: (id) => apiClient.deleteVehicle(id, { permanent: true }),
      setOutOfService: (id, outOfService) => apiClient.updateVehicle(id, { out_of_service: outOfService }),
    },
    compare: compareVehicles,
    initialSort: 'display_order',
    loadError: t('vehicles.loadError'),
    failureDescription: t('vehicles.deleteErrorDescription'),
    logNoun: 'vehicle',
  });
  const { sort } = inventory;

  const onSubmit = form.handleSubmit(async (values) => {
    const payload = { ...values, type: values.type?.trim() || values.name };
    try {
      if (dialog.editing) {
        await apiClient.updateVehicle(dialog.editing.id, payload);
      } else {
        await apiClient.createVehicle(payload);
      }
      await inventory.reload();
      dialog.close();
    } catch (error) {
      console.error('Failed to save vehicle:', error);
      toast.error(t('vehicles.saveError'), {
        description: t('common.checkInputRetry'),
      });
    }
  });

  const handleEdit = (vehicle: ApiVehicle) => {
    dialog.open(vehicle, {
      name: vehicle.name,
      type: vehicle.type,
      display_order: vehicle.display_order,
      status:
        vehicle.status === 'available' || vehicle.status === 'unavailable'
          ? vehicle.status
          : 'available',
      radio_call_sign: vehicle.radio_call_sign,
    });
  };

  const handleOpenCreate = () => {
    dialog.open(null, {
      ...vehicleFormDefaults,
      display_order: inventory.rows.length + 1,
    });
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
        <Dialog open={dialog.isOpen} onOpenChange={guard.handleOpenChange}>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {dialog.editing ? t('vehicles.dialogEditTitle') : t('vehicles.dialogCreateTitle')}
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
                        {...fieldMessageProps('vehicle-name', fieldState.error ? 'error' : null)}
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
                        {...fieldMessageProps('vehicle-display-order', fieldState.error ? 'error' : null)}
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
                        {...fieldMessageProps('vehicle-radio-call-sign', fieldState.error ? 'error' : null)}
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
                    {isSaving && <ShellLoader className="size-4" />}
                    {dialog.editing ? t('common.update') : t('common.create')}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

      <ArchiveToggle inventory={inventory} className="pb-3" />

      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead sort={sort} column="display_order" className="w-16">
              #
            </SortableHead>
            <SortableHead sort={sort} column="name">
              {t('common.name')}
            </SortableHead>
            <SortableHead sort={sort} column="radio_call_sign">
              {t('common.radioCallSign')}
            </SortableHead>
            <LifecycleHeads sort={sort} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {inventory.sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                {t('vehicles.empty')}
              </TableCell>
            </TableRow>
          )}
          {inventory.sorted.map((vehicle) => {
            const isArchived = rowState(vehicle) === 'archived';
            return (
            <TableRow key={vehicle.id} className={isArchived ? 'bg-muted/40 text-muted-foreground' : undefined}>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {vehicle.display_order}
              </TableCell>
              <TableCell className="font-medium">
                <span className={isArchived ? 'line-through' : undefined}>{vehicle.name}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{vehicle.radio_call_sign}</TableCell>
              <LifecycleCells row={vehicle} actions={inventory} onEdit={handleEdit} />
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </SettingCard>

      <ArchiveDialogs
        inventory={inventory}
        copy={{
          archiveTitle: t('vehicles.archiveTitle', { name: inventory.archiveTarget?.name ?? '' }),
          archiveDescription: t('vehicles.archiveDescription'),
          archiveHint: t('vehicles.archiveHint'),
          purgeTitle: t('vehicles.purgeTitle', { name: inventory.purgeTarget?.name ?? '' }),
          purgeDescription: t('vehicles.purgeDescription'),
          purgeHint: t('vehicles.purgeHint'),
        }}
      />

      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}
