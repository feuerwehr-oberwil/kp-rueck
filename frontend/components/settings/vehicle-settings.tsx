'use client';

import { useState, useEffect, useMemo } from 'react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusCircle, Edit, Trash2, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { apiClient, ApiVehicle } from '@/lib/api-client';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { toast } from 'sonner';

export function VehicleSettings() {
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<ApiVehicle | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: '',
    display_order: 1,
    status: 'available',
    radio_call_sign: '',
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [vehicleToDelete, setVehicleToDelete] = useState<ApiVehicle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sortColumn, setSortColumn] = useState<'display_order' | 'name' | 'radio_call_sign' | 'status'>('display_order');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    try {
      const data = await apiClient.getVehicles();
      setVehicles(data);
    } catch (error) {
      console.error('Failed to load vehicles:', error);
    }
  };

  // Get unique vehicle types from existing vehicles
  const availableVehicleTypes = Array.from(new Set(vehicles.map(v => v.type))).sort();

  // Handle column header click for sorting
  const handleSort = (column: 'display_order' | 'name' | 'radio_call_sign' | 'status') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sort vehicles based on current sort settings
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
          comparison = a.radio_call_sign.toLowerCase().localeCompare(b.radio_call_sign.toLowerCase());
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [vehicles, sortColumn, sortDirection]);

  // Render sort indicator
  const SortIndicator = ({ column }: { column: 'display_order' | 'name' | 'radio_call_sign' | 'status' }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3 inline" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 inline" />
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (editingVehicle) {
        await apiClient.updateVehicle(editingVehicle.id, formData);
      } else {
        await apiClient.createVehicle(formData);
      }
      await loadVehicles();
      handleCloseDialog();
    } catch (error) {
      console.error('Failed to save vehicle:', error);
      toast.error('Fehler beim Speichern des Fahrzeugs', { description: 'Überprüfen Sie die Eingabe und versuchen Sie es erneut.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (vehicle: ApiVehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      name: vehicle.name,
      type: vehicle.type,
      display_order: vehicle.display_order,
      status: vehicle.status,
      radio_call_sign: vehicle.radio_call_sign,
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
      toast.error('Fehler beim Löschen des Fahrzeugs', { description: 'Das Fahrzeug konnte nicht gelöscht werden. Versuchen Sie es erneut.' });
    } finally {
      setVehicleToDelete(null);
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingVehicle(null);
    setFormData({ name: '', type: '', display_order: 1, status: 'available', radio_call_sign: '' });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingVehicle(null)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Fahrzeug hinzufügen
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingVehicle ? 'Fahrzeug bearbeiten' : 'Neues Fahrzeug hinzufügen'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="z.B. TLF, Pio, Mowa"
                  required
                />
              </div>
              <div>
                <Label htmlFor="type">Fahrzeugtyp</Label>
                {availableVehicleTypes.length > 0 ? (
                  <Select
                    value={formData.type}
                    onValueChange={(value) => setFormData({ ...formData, type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Typ auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableVehicleTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="type"
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    placeholder="Fahrzeugtyp eingeben (z.B. TLF, DLK, MTW)"
                    required
                  />
                )}
              </div>
              <div>
                <Label htmlFor="display_order">Reihenfolge (Tastaturkürzel)</Label>
                <Input
                  id="display_order"
                  type="number"
                  min="1"
                  value={formData.display_order}
                  onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 1 })}
                  placeholder="z.B. 1, 2, 3"
                  required
                />
              </div>
              <div>
                <Label htmlFor="radio_call_sign">Funkrufname</Label>
                <Input
                  id="radio_call_sign"
                  value={formData.radio_call_sign}
                  onChange={(e) => setFormData({ ...formData, radio_call_sign: e.target.value })}
                  placeholder="z.B. Omega 1, Omega 2"
                  required
                />
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Verfügbar</SelectItem>
                    <SelectItem value="unavailable">Nicht verfügbar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCloseDialog} disabled={isSaving}>
                  Abbrechen
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingVehicle ? 'Aktualisieren' : 'Erstellen'}
                </Button>
              </div>
            </form>
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
              Name<SortIndicator column="name" />
            </TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('radio_call_sign')}
            >
              Funkrufname<SortIndicator column="radio_call_sign" />
            </TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('status')}
            >
              Status<SortIndicator column="status" />
            </TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedVehicles.map((vehicle) => (
              <TableRow key={vehicle.id}>
                <TableCell className="font-mono text-sm text-muted-foreground">{vehicle.display_order}</TableCell>
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
                    {vehicle.status === 'available' ? 'Verfügbar' : 'Nicht verfügbar'}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(vehicle)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteClick(vehicle)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Fahrzeug löschen"
        description={`Sind Sie sicher, dass Sie das Fahrzeug "${vehicleToDelete?.name}" löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
