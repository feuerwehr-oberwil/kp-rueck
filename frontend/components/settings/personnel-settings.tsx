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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { PlusCircle, Edit, Trash2, Loader2, ArrowUp, ArrowDown, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { apiClient, ApiPersonnel, ApiDiveraSyncPreview } from '@/lib/api-client';
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
  const [sortColumn, setSortColumn] = useState<'name' | 'role' | 'availability'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Divera sync state
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const [syncPreview, setSyncPreview] = useState<ApiDiveraSyncPreview | null>(null);
  const [isSyncLoading, setIsSyncLoading] = useState(false);
  const [isSyncExecuting, setIsSyncExecuting] = useState(false);
  const [removeStale, setRemoveStale] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

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
      toast.success(`Person "${personnelToDelete.name}" gelöscht`);
    } catch (error) {
      console.error('Failed to delete personnel:', error);
      toast.error('Fehler beim Löschen der Person');
    } finally {
      setPersonnelToDelete(null);
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingPersonnel(null);
    setFormData({ name: '', role: '', availability: 'available' });
  };

  // Handle column header click for sorting
  const handleSort = (column: 'name' | 'role' | 'availability') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Sort personnel based on current sort settings
  const sortedPersonnel = useMemo(() => {
    return [...personnel].sort((a, b) => {
      let aVal: string;
      let bVal: string;

      switch (sortColumn) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'role':
          aVal = (a.role || '').toLowerCase();
          bVal = (b.role || '').toLowerCase();
          break;
        case 'availability':
          aVal = a.availability;
          bVal = b.availability;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [personnel, sortColumn, sortDirection]);

  // Render sort indicator
  const SortIndicator = ({ column }: { column: 'name' | 'role' | 'availability' }) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ArrowUp className="ml-1 h-3 w-3 inline" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3 inline" />
    );
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

  // Divera sync handlers
  const handleOpenSyncDialog = async () => {
    setIsSyncDialogOpen(true);
    setIsSyncLoading(true);
    setSyncPreview(null);
    setSyncError(null);
    setRemoveStale(false);

    try {
      const preview = await apiClient.getDiveraSyncPreview();
      setSyncPreview(preview);
    } catch (error) {
      console.error('Failed to fetch sync preview:', error);
      setSyncError(error instanceof Error ? error.message : 'Fehler beim Laden der Vorschau');
    } finally {
      setIsSyncLoading(false);
    }
  };

  const handleExecuteSync = async () => {
    setIsSyncExecuting(true);
    try {
      const result = await apiClient.executeDiveraSync({ remove_stale: removeStale });
      const parts = [];
      if (result.created > 0) parts.push(`${result.created} erstellt`);
      if (result.deleted > 0) parts.push(`${result.deleted} gelöscht`);
      if (result.unchanged > 0) parts.push(`${result.unchanged} unverändert`);
      toast.success(`Synchronisation abgeschlossen: ${parts.join(', ')}`);
      setIsSyncDialogOpen(false);
      await loadPersonnel();
    } catch (error) {
      console.error('Failed to execute sync:', error);
      toast.error('Fehler bei der Synchronisation');
    } finally {
      setIsSyncExecuting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="list" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="list">Personalliste</TabsTrigger>
          <TabsTrigger value="sort">Kategorien sortieren</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">
          <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleOpenSyncDialog}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Von Divera synchronisieren
        </Button>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingPersonnel(null)}>
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
            <TableHead
              className="cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('name')}
            >
              Name<SortIndicator column="name" />
            </TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('role')}
            >
              Rolle<SortIndicator column="role" />
            </TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50 select-none"
              onClick={() => handleSort('availability')}
            >
              Verfügbarkeit<SortIndicator column="availability" />
            </TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedPersonnel.map((person) => (
            <TableRow key={person.id}>
              <TableCell className="font-medium">{person.name}</TableCell>
              <TableCell>{person.role || '-'}</TableCell>
              <TableCell>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    person.availability === 'available'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }`}
                >
                  {person.availability === 'available' ? 'Verfügbar' : 'Nicht verfügbar'}
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
        title="Person löschen"
        description={`Sind Sie sicher, dass Sie "${personnelToDelete?.name}" löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`}
        onConfirm={handleDeleteConfirm}
      />

      {/* Divera Sync Dialog */}
      <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Divera Personal synchronisieren</DialogTitle>
          </DialogHeader>

          {isSyncLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-muted-foreground">Lade Vorschau von Divera...</span>
            </div>
          )}

          {syncError && (
            <div className="rounded-md bg-destructive/10 p-4 text-destructive text-sm">
              {syncError}
            </div>
          )}

          {syncPreview && !isSyncLoading && (
            <div className="flex flex-col gap-3 min-h-0">
              <div className="overflow-y-auto min-h-0 flex-1 pr-2">
                <div className="space-y-2">
                  <SyncSection
                    title="Neu"
                    items={syncPreview.new}
                    badgeVariant="default"
                    defaultOpen={syncPreview.new.length > 0}
                  />
                  <SyncSection
                    title="Unverändert"
                    items={syncPreview.unchanged}
                    badgeVariant="outline"
                    defaultOpen={false}
                  />
                  <SyncSection
                    title="Nicht in Divera"
                    items={syncPreview.not_in_divera}
                    badgeVariant="destructive"
                    defaultOpen={syncPreview.not_in_divera.length > 0}
                  />
                </div>
              </div>

              <div className="flex-shrink-0 space-y-3 border-t pt-3">
                {syncPreview.not_in_divera.length > 0 && (
                  <div className="flex items-center space-x-2 rounded-md border p-3">
                    <Checkbox
                      id="remove-stale"
                      checked={removeStale}
                      onCheckedChange={(checked) => setRemoveStale(checked === true)}
                    />
                    <label htmlFor="remove-stale" className="text-sm cursor-pointer">
                      {syncPreview.not_in_divera.length} Person(en) entfernen, die nicht in Divera vorhanden sind
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsSyncDialogOpen(false)} disabled={isSyncExecuting}>
                    Abbrechen
                  </Button>
                  <Button
                    onClick={handleExecuteSync}
                    disabled={isSyncExecuting || (syncPreview.new.length === 0 && !removeStale)}
                  >
                    {isSyncExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Synchronisieren
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SyncSection({
  title,
  items,
  badgeVariant,
  defaultOpen,
}: {
  title: string;
  items: { member: { divera_id: number; name: string }; status: string; existing_id: string | null }[];
  badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (items.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-muted/50 text-sm font-medium">
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {title}
        <Badge variant={badgeVariant} className="ml-auto">{items.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-6 py-1 space-y-0.5">
          {items.map((item, idx) => (
            <div key={`${item.member.divera_id}-${idx}`} className="text-sm py-0.5">
              {item.member.name}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
