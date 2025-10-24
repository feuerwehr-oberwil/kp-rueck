'use client';

import { useState, useEffect } from 'react';
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
import { PlusCircle, Edit, Trash2 } from 'lucide-react';
import { apiClient, ApiVehicle } from '@/lib/api-client';

export function VehicleSettings() {
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<ApiVehicle | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: '',
    status: 'available',
  });

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    }
  };

  const handleEdit = (vehicle: ApiVehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      name: vehicle.name,
      type: vehicle.type,
      status: vehicle.status,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this vehicle?')) {
      try {
        await apiClient.deleteVehicle(id);
        await loadVehicles();
      } catch (error) {
        console.error('Failed to delete vehicle:', error);
      }
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingVehicle(null);
    setFormData({ name: '', type: '', status: 'available' });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Vehicle Management</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingVehicle(null)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Vehicle
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingVehicle ? 'Edit Vehicle' : 'Add New Vehicle'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Name / Call Sign</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., TLF 1, DLK 2"
                  required
                />
              </div>
              <div>
                <Label htmlFor="type">Vehicle Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TLF">TLF (Tank Fire Engine)</SelectItem>
                    <SelectItem value="DLK">DLK (Turntable Ladder)</SelectItem>
                    <SelectItem value="MTW">MTW (Multi-Purpose Vehicle)</SelectItem>
                    <SelectItem value="RW">RW (Rescue Vehicle)</SelectItem>
                    <SelectItem value="KdoW">KdoW (Command Vehicle)</SelectItem>
                  </SelectContent>
                </Select>
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
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingVehicle ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name / Call Sign</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vehicles.map((vehicle) => (
            <TableRow key={vehicle.id}>
              <TableCell className="font-medium">{vehicle.name}</TableCell>
              <TableCell>{vehicle.type}</TableCell>
              <TableCell>
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    vehicle.status === 'available'
                      ? 'bg-green-100 text-green-800'
                      : vehicle.status === 'assigned'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {vehicle.status}
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
                  onClick={() => handleDelete(vehicle.id)}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
