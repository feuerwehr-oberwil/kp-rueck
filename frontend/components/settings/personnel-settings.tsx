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
import { apiClient, ApiPersonnel } from '@/lib/api-client';
import { CategorySortOrder } from './category-sort-order';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { toast } from 'sonner';

export function PersonnelSettings() {
  const [personnel, setPersonnel] = useState<ApiPersonnel[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<ApiPersonnel | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    availability: 'available',
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [personnelToDelete, setPersonnelToDelete] = useState<ApiPersonnel | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadPersonnel();
  }, []);

  const loadPersonnel = async () => {
    try {
      const data = await apiClient.getAllPersonnel();
      setPersonnel(data);
    } catch (error) {
      console.error('Failed to load personnel:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (editingPersonnel) {
        await apiClient.updatePersonnel(editingPersonnel.id, formData);
        toast.success(`Person "${formData.name}" aktualisiert`);
      } else {
        await apiClient.createPersonnel(formData);
        toast.success(`Person "${formData.name}" erstellt`);
      }
      await loadPersonnel();
      handleCloseDialog();
    } catch (error) {
      console.error('Failed to save personnel:', error);
      toast.error('Fehler beim Speichern der Person');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (person: ApiPersonnel) => {
    setEditingPersonnel(person);
    setFormData({
      name: person.name,
      role: person.role || '',
      availability: person.availability,
    });
    setIsDialogOpen(true);
  };

  const handleDeleteClick = (person: ApiPersonnel) => {
    setPersonnelToDelete(person);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!personnelToDelete) return;
    try {
      await apiClient.deletePersonnel(personnelToDelete.id);
      await loadPersonnel();
      toast.success(`Person "${personnelToDelete.name}" archiviert`);
    } catch (error) {
      console.error('Failed to archive personnel:', error);
      toast.error('Fehler beim Archivieren der Person');
    } finally {
      setPersonnelToDelete(null);
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingPersonnel(null);
    setFormData({ name: '', role: '', availability: 'available' });
  };

  // Extract unique roles with their sort orders and counts
  const roleCategories = useMemo(() => {
    const roleMap = new Map<string, { sort_order: number; count: number }>();

    personnel.forEach((person) => {
      const role = person.role || '';
      if (!roleMap.has(role)) {
        roleMap.set(role, {
          sort_order: person.role_sort_order,
          count: 0,
        });
      }
      const current = roleMap.get(role)!;
      current.count++;
    });

    return Array.from(roleMap.entries())
      .map(([name, data]) => ({
        name,
        sort_order: data.sort_order,
        count: data.count,
      }))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [personnel]);

  const handleSaveRoleSortOrder = async (categories: Array<{ name: string; sort_order: number }>) => {
    await apiClient.updatePersonnelCategorySortOrder({
      categories: categories.map((cat) => ({
        category: cat.name,
        sort_order: cat.sort_order,
      })),
    });
    // Reload personnel to reflect new sorting
    await loadPersonnel();
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Personalverwaltung</h2>

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="list">Personalliste</TabsTrigger>
          <TabsTrigger value="sort">Kategorien sortieren</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-0">
            <div />  {/* Spacer */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingPersonnel(null)} className="w-full sm:w-auto">
              <PlusCircle className="mr-2 h-4 w-4" />
              Personal hinzufügen
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingPersonnel ? 'Personal bearbeiten' : 'Neues Personal hinzufügen'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="role">Rolle</Label>
                <Input
                  id="role"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder="z.B. Feuerwehrmann, Sanitäter, Fahrer"
                  required
                />
              </div>
              <div>
                <Label htmlFor="availability">Verfügbarkeit</Label>
                <Select
                  value={formData.availability}
                  onValueChange={(value) => setFormData({ ...formData, availability: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Verfügbar</SelectItem>
                    <SelectItem value="assigned">Zugewiesen</SelectItem>
                    <SelectItem value="off_duty">Ausser Dienst</SelectItem>
                    <SelectItem value="inactive">Inaktiv</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleCloseDialog} disabled={isSaving}>
                  Abbrechen
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingPersonnel ? 'Aktualisieren' : 'Erstellen'}
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
            <TableHead>Rolle</TableHead>
            <TableHead>Verfügbarkeit</TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {personnel.map((person) => (
            <TableRow key={person.id}>
              <TableCell className="font-medium">{person.name}</TableCell>
              <TableCell>{person.role || '-'}</TableCell>
              <TableCell>
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    person.availability === 'available'
                      ? 'bg-zinc-100 text-zinc-800'
                      : person.availability === 'assigned'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {person.availability === 'available' ? 'Verfügbar' :
                   person.availability === 'assigned' ? 'Zugewiesen' :
                   person.availability === 'off_duty' ? 'Ausser Dienst' : 'Inaktiv'}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEdit(person)}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteClick(person)}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
        </TabsContent>

        <TabsContent value="sort">
          <CategorySortOrder
            title="Rollen-Sortierung"
            description="Ziehen Sie die Rollen, um deren Reihenfolge in der Anzeige zu ändern. Personal wird nach dieser Sortierung gruppiert."
            categories={roleCategories}
            onSave={handleSaveRoleSortOrder}
          />
        </TabsContent>
      </Tabs>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Person archivieren"
        description={`Sind Sie sicher, dass Sie "${personnelToDelete?.name}" archivieren möchten? Die Person wird als nicht verfügbar markiert und nicht mehr in der Personalauswahl angezeigt.`}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
