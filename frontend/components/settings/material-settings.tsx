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
import { apiClient, ApiMaterialResource } from '@/lib/api-client';

export function MaterialSettings() {
  const [materials, setMaterials] = useState<ApiMaterialResource[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<ApiMaterialResource | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    status: 'available',
    location: '',
  });

  useEffect(() => {
    loadMaterials();
  }, []);

  const loadMaterials = async () => {
    try {
      const data = await apiClient.getAllMaterials();
      setMaterials(data);
    } catch (error) {
      console.error('Failed to load materials:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingMaterial) {
        await apiClient.updateMaterialResource(editingMaterial.id, formData);
      } else {
        await apiClient.createMaterialResource(formData);
      }
      await loadMaterials();
      handleCloseDialog();
    } catch (error) {
      console.error('Failed to save material:', error);
    }
  };

  const handleEdit = (material: ApiMaterialResource) => {
    setEditingMaterial(material);
    setFormData({
      name: material.name,
      status: material.status,
      location: material.location || '',
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this material?')) {
      try {
        await apiClient.deleteMaterialResource(id);
        await loadMaterials();
      } catch (error) {
        console.error('Failed to delete material:', error);
      }
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMaterial(null);
    setFormData({ name: '', status: 'available', location: '' });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-semibold">Material Management</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingMaterial(null)}>
              <PlusCircle className="mr-2 h-4 w-4" />
              Add Material
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingMaterial ? 'Edit Material' : 'Add New Material'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., pump small from car 1"
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
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="Storage location"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingMaterial ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Location</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {materials.map((material) => (
            <TableRow key={material.id}>
              <TableCell className="font-medium">{material.name}</TableCell>
              <TableCell>
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    material.status === 'available'
                      ? 'bg-green-100 text-green-800'
                      : material.status === 'assigned'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {material.status}
                </span>
              </TableCell>
              <TableCell>{material.location || '-'}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEdit(material)}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(material.id)}
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
