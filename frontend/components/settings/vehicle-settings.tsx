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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PlusCircle, Edit, Trash2, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { apiClient, ApiVehicle } from '@/lib/api-client';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
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

export function VehicleSettings() {
  const t = useTranslations('settings');
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<ApiVehicle | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [vehicleToDelete, setVehicleToDelete] = useState<ApiVehicle | null>(null);
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

  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    try {
      const data = await apiClient.getVehicles();
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
    return [...vehicles].sort((a, b) => {
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
          comparison = a.status.localeCompare(b.status);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [vehicles, sortColumn, sortDirection]);

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

  const handleDeleteConfirm = async () => {
    if (!vehicleToDelete) return;
    try {
      await apiClient.deleteVehicle(vehicleToDelete.id);
      await loadVehicles();
    } catch (error) {
      console.error('Failed to delete vehicle:', error);
      toast.error(t('vehicles.deleteError'), {
        description: t('vehicles.deleteErrorDescription'),
      });
    } finally {
      setVehicleToDelete(null);
    }
  };

  const isSaving = form.formState.isSubmitting;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={handleOpenCreate}>
          <PlusCircle className="size-4" />
          {t('vehicles.addButton')}
        </Button>
        <Dialog open={isDialogOpen} onOpenChange={guard.handleOpenChange}>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {editingVehicle ? t('vehicles.dialogEditTitle') : t('vehicles.dialogCreateTitle')}
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
                          placeholder={t('vehicles.namePlaceholder')}
                          autoFocus
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="display_order"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-muted-foreground">
                        {t('vehicles.orderLabel')} <span className="text-destructive" aria-hidden="true">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
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
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="radio_call_sign"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-muted-foreground">
                        {t('common.radioCallSign')} <span className="text-destructive" aria-hidden="true">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t('vehicles.radioPlaceholder')} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-muted-foreground">
                        {t('common.status')}
                      </FormLabel>
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
              <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                {t('vehicles.empty')}
              </TableCell>
            </TableRow>
          )}
          {sortedVehicles.map((vehicle) => (
            <TableRow key={vehicle.id}>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {vehicle.display_order}
              </TableCell>
              <TableCell className="font-medium">{vehicle.name}</TableCell>
              <TableCell className="text-muted-foreground">{vehicle.radio_call_sign}</TableCell>
              <TableCell>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    vehicle.status === 'available'
                      ? 'bg-success/10 text-success'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {vehicle.status === 'available' ? t('common.available') : t('common.unavailable')}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="sm" onClick={() => handleEdit(vehicle)}>
                  <Edit className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteClick(vehicle)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('vehicles.deleteTitle')}
        description={t('vehicles.deleteDescription', { name: vehicleToDelete?.name ?? '' })}
        onConfirm={handleDeleteConfirm}
      />

      <UnsavedChangesDialog {...guard.dialogProps} />
    </div>
  );
}
