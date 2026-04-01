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
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { PlusCircle, Edit, Trash2, Loader2, ArrowUp, ArrowDown, ChevronDown, Infinity as InfinityIcon } from 'lucide-react';
import { apiClient, ApiMaterialResource, ApiMaterialGroup } from '@/lib/api-client';
import { CategorySortOrder } from './category-sort-order';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { toast } from 'sonner';

export function MaterialSettings() {
  const [materials, setMaterials] = useState<ApiMaterialResource[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<ApiMaterialResource | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: '',
    status: 'available',
    location: '',
    consumable: false,
  });
  const [materialGroups, setMaterialGroups] = useState<ApiMaterialGroup[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<ApiMaterialResource | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sortColumn, setSortColumn] = useState<'name' | 'location' | 'status'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    loadMaterials();
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      const data = await apiClient.getMaterialGroups();
      setMaterialGroups(data);
    } catch (error) {
      console.error('Failed to load material groups:', error);
    }
  };

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
        await apiClient.updateMaterialResource(editingMaterial.id, { ...formData });
      } else {
        await apiClient.createMaterialResource({ ...formData });
      }
      await loadMaterials();
      handleCloseDialog();
    } catch (error) {
      console.error('Failed to save material:', error);
      toast.error('Fehler beim Speichern des Materials', { description: 'Überprüfen Sie die Eingabe und versuchen Sie es erneut.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (material: ApiMaterialResource) => {
    setEditingMaterial(material);
    setFormData({
      name: material.name,
      type: material.type || '',
      status: material.status,
      location: material.location || '',
      consumable: material.consumable ?? false,
    });
    setNewType('');
    setNewLocation('');
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
    } catch (error) {
      console.error('Failed to delete material:', error);
      toast.error('Fehler beim Löschen des Materials', { description: 'Das Material konnte nicht gelöscht werden. Versuchen Sie es erneut.' });
    } finally {
      setMaterialToDelete(null);
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMaterial(null);
    setFormData({ name: '', type: '', status: 'available', location: '', consumable: false });
    setNewType('');
    setNewLocation('');
  };

  // Derive unique types and locations from existing materials for dynamic selects
  const existingTypes = useMemo(() => {
    const types = new Set(materials.map(m => m.type).filter(Boolean))
    return Array.from(types).sort()
  }, [materials])

  const existingLocations = useMemo(() => {
    const locs = new Set(materials.map(m => m.location || '').filter(Boolean))
    return Array.from(locs).sort()
  }, [materials])

  const [newType, setNewType] = useState('')
  const [newLocation, setNewLocation] = useState('')

  // Handle column header click for sorting
  const handleSort = (column: 'name' | 'location' | 'status') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sort materials based on current sort settings
  const sortedMaterials = useMemo(() => {
    return [...materials].sort((a, b) => {
      let aVal: string;
      let bVal: string;

      switch (sortColumn) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'location':
          aVal = (a.location || '').toLowerCase();
          bVal = (b.location || '').toLowerCase();
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [materials, sortColumn, sortDirection]);

  // Render sort indicator
  const SortIndicator = ({ column }: { column: 'name' | 'location' | 'status' }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3 inline" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 inline" />
    );
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
      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="list">Materialliste</TabsTrigger>
          <TabsTrigger value="groups">Gruppen</TabsTrigger>
          <TabsTrigger value="sort">Kategorien sortieren</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex justify-end">
        <Button onClick={() => {
          setEditingMaterial(null);
          setFormData({ name: '', type: '', status: 'available', location: '', consumable: false });
          setNewType('');
          setNewLocation('');
          setIsDialogOpen(true);
        }}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Material hinzufügen
        </Button>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); else setIsDialogOpen(true); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingMaterial ? 'Material bearbeiten' : 'Neues Material hinzufügen'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="z.B. Tauchpumpe Gr."
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">Typ</Label>
                <div className="flex gap-2">
                  <Input
                    id="type"
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    placeholder="z.B. Pumpe, Schlauch"
                    className="flex-1"
                  />
                  {existingTypes.filter(t => t !== formData.type).length > 0 && (
                    <Select
                      value=""
                      onValueChange={(value) => setFormData({ ...formData, type: value })}
                    >
                      <SelectTrigger className="w-10 px-0 justify-center flex-shrink-0">
                        <ChevronDown className="h-4 w-4" />
                      </SelectTrigger>
                      <SelectContent>
                        {existingTypes.filter(t => t !== formData.type).map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="location">Standort</Label>
                <div className="flex gap-2">
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="z.B. TLF, Pio, Depot"
                    className="flex-1"
                  />
                  {existingLocations.filter(l => l !== formData.location).length > 0 && (
                    <Select
                      value=""
                      onValueChange={(value) => setFormData({ ...formData, location: value })}
                    >
                      <SelectTrigger className="w-10 px-0 justify-center flex-shrink-0">
                        <ChevronDown className="h-4 w-4" />
                      </SelectTrigger>
                      <SelectContent>
                        {existingLocations.filter(l => l !== formData.location).map(l => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
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
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="consumable">Verbrauchsmaterial</Label>
                  <p className="text-xs text-muted-foreground">Unbegrenzt verfügbar, keine Zuordnung nötig</p>
                </div>
                <Switch
                  id="consumable"
                  checked={formData.consumable}
                  onCheckedChange={(checked) => setFormData({ ...formData, consumable: checked })}
                />
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
            <TableHead
              className="cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('name')}
            >
              Name<SortIndicator column="name" />
            </TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('location')}
            >
              Kategorie<SortIndicator column="location" />
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
          {sortedMaterials.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                Kein Material vorhanden.
              </TableCell>
            </TableRow>
          )}
          {sortedMaterials.map((material) => (
            <TableRow key={material.id}>
              <TableCell className="font-medium">
                {material.name}
                {material.consumable && <InfinityIcon className="inline ml-1.5 h-3.5 w-3.5 text-muted-foreground" />}
              </TableCell>
              <TableCell>
                <span className="px-2 py-1 rounded text-xs bg-accent text-accent-foreground">
                  {material.location || 'General'}
                </span>
              </TableCell>
              <TableCell>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    material.status === 'available'
                      ? 'bg-success/10 text-success'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {material.status === 'available' ? 'Verfügbar' : 'Nicht verfügbar'}
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
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
        </TabsContent>

        <TabsContent value="groups">
          <MaterialGroupSettings
            groups={materialGroups}
            materials={materials}
            onRefresh={() => { loadGroups(); loadMaterials(); }}
          />
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
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<ApiMaterialGroup | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupLocation, setGroupLocation] = useState('')
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set())
  const [isSaving, setIsSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [groupToDelete, setGroupToDelete] = useState<ApiMaterialGroup | null>(null)

  const ungroupedMaterials = materials.filter(m => !m.group_id && !m.consumable)

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
      toast.error('Fehler beim Speichern der Gruppe')
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
      toast.error('Fehler beim Löschen der Gruppe')
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

  // Available materials = ungrouped + materials already in this group
  const availableMaterials = materials.filter(
    m => !m.consumable && (!m.group_id || (editingGroup && editingGroup.materials.some(gm => gm.id === m.id)))
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Materialgruppen fassen mehrere Einzelmaterialien zu einem Block zusammen (z.B. &quot;Modul 1&quot;).
        </p>
        <Button onClick={handleOpenCreate} size="sm">
          <PlusCircle className="mr-2 h-4 w-4" />
          Gruppe erstellen
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 text-sm">
          Keine Gruppen vorhanden. Erstellen Sie eine neue Gruppe.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kategorie</TableHead>
              <TableHead>Materialien</TableHead>
              <TableHead className="text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={group.id}>
                <TableCell className="font-medium">{group.name}</TableCell>
                <TableCell>
                  <span className="px-2 py-1 rounded text-xs bg-accent text-accent-foreground">
                    {group.location || '—'}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {group.materials.length > 0
                    ? group.materials.map(m => m.name).join(', ')
                    : <span className="italic">Keine Materialien</span>
                  }
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(group)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setGroupToDelete(group); setDeleteDialogOpen(true); }}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Gruppe bearbeiten' : 'Neue Gruppe erstellen'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-y-auto">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="z.B. Modul 1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-location">Standort</Label>
              <Select
                value={groupLocation}
                onValueChange={(value) => setGroupLocation(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Standort auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {existingLocations.map(l => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Materialien auswählen</Label>
              <div className="mt-2 space-y-1 max-h-[250px] overflow-y-auto border rounded-md p-2">
                {availableMaterials.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Keine verfügbaren Materialien</p>
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
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={isSaving || !groupName.trim()}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingGroup ? 'Aktualisieren' : 'Erstellen'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Gruppe löschen"
        description={`Sind Sie sicher, dass Sie die Gruppe "${groupToDelete?.name}" löschen möchten? Die Materialien werden nicht gelöscht, nur die Gruppierung aufgelöst.`}
        onConfirm={handleDelete}
      />
    </div>
  )
}
