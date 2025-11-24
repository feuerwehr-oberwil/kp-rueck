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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlusCircle, Edit, Trash2, Loader2 } from 'lucide-react';
import { apiClient, ApiMaterialResource } from '@/lib/api-client';
import { CategorySortOrder } from './category-sort-order';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { toast } from 'sonner';

export function MaterialSettings() {
  const [materials, setMaterials] = useState<ApiMaterialResource[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<ApiMaterialResource | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    status: 'available',
    location: '',
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<ApiMaterialResource | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
    setIsSaving(true);
    try {
      if (editingMaterial) {
        await apiClient.updateMaterialResource(editingMaterial.id, formData);
        toast.success(`Material "${formData.name}" aktualisiert`);
      } else {
        await apiClient.createMaterialResource(formData);
        toast.success(`Material "${formData.name}" erstellt`);
      }
      await loadMaterials();
      handleCloseDialog();
    } catch (error) {
      console.error('Failed to save material:', error);
      toast.error('Fehler beim Speichern des Materials');
    } finally {
      setIsSaving(false);
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

  const handleDeleteClick = (material: ApiMaterialResource) => {
    setMaterialToDelete(material);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!materialToDelete) return;
    try {
      await apiClient.deleteMaterialResource(materialToDelete.id);
      await loadMaterials();
      toast.success(`Material "${materialToDelete.name}" gelöscht`);
    } catch (error) {
      console.error('Failed to delete material:', error);
      toast.error('Fehler beim Löschen des Materials');
    } finally {
      setMaterialToDelete(null);
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMaterial(null);
    setFormData({ name: '', status: 'available', location: '' });
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
    // Reload materials to reflect new sorting
    await loadMaterials();
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Materialverwaltung</h2>

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="list">Materialliste</TabsTrigger>
          <TabsTrigger value="sort">Kategorien sortieren</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-0">
            <div />  {/* Spacer */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingMaterial(null)} className="w-full sm:w-auto">
              <PlusCircle className="mr-2 h-4 w-4" />
              Material hinzufügen
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingMaterial ? 'Material bearbeiten' : 'Neues Material hinzufügen'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="z.B. Tauchpumpe Gr."
                  required
                />
              </div>
              <div>
                <Label htmlFor="location">Standort/Kategorie</Label>
                <Select
                  value={formData.location}
                  onValueChange={(value) => setFormData({ ...formData, location: value })}
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kategorie auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Tauchpumpen">Tauchpumpen</SelectItem>
                    <SelectItem value="Wassersauger">Wassersauger</SelectItem>
                    <SelectItem value="Sägen">Sägen</SelectItem>
                    <SelectItem value="Generatoren">Generatoren</SelectItem>
                    <SelectItem value="Elektrowerkzeug">Elektrowerkzeug</SelectItem>
                    <SelectItem value="Anhänger">Anhänger</SelectItem>
                    <SelectItem value="TLF">TLF</SelectItem>
                    <SelectItem value="Pio">Pio</SelectItem>
                    <SelectItem value="Depot">Depot</SelectItem>
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
                    <SelectItem value="available">Verfügbar</SelectItem>
                    <SelectItem value="assigned">Zugewiesen</SelectItem>
                    <SelectItem value="planned">Geplant</SelectItem>
                    <SelectItem value="maintenance">Wartung</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCloseDialog} disabled={isSaving}>
                  Abbrechen
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingMaterial ? 'Aktualisieren' : 'Erstellen'}
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
            <TableHead>Kategorie</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {materials.map((material) => (
            <TableRow key={material.id}>
              <TableCell className="font-medium">{material.name}</TableCell>
              <TableCell>
                <span className="px-2 py-1 rounded text-xs bg-purple-100 text-purple-800">
                  {material.location || 'General'}
                </span>
              </TableCell>
              <TableCell>
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    material.status === 'available'
                      ? 'bg-zinc-100 text-zinc-800'
                      : material.status === 'assigned'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {material.status === 'available' ? 'Verfügbar' :
                   material.status === 'assigned' ? 'Zugewiesen' :
                   material.status === 'planned' ? 'Geplant' : 'Wartung'}
                </span>
              </TableCell>
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
                  onClick={() => handleDeleteClick(material)}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
        </TabsContent>

        <TabsContent value="sort">
          <CategorySortOrder
            title="Standort-Sortierung"
            description="Ziehen Sie die Standorte, um deren Reihenfolge in der Anzeige zu ändern. Material wird nach dieser Sortierung gruppiert."
            categories={locationCategories}
            onSave={handleSaveLocationSortOrder}
          />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Material löschen"
        description={`Sind Sie sicher, dass Sie das Material "${materialToDelete?.name}" löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
