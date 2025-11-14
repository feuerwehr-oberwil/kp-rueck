'use client';

import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GripVertical, Save } from 'lucide-react';
import { toast } from 'sonner';

interface Category {
  name: string;
  sort_order: number;
  count: number; // Number of items in this category
}

interface CategorySortOrderProps {
  title: string;
  description: string;
  categories: Category[];
  onSave: (categories: Category[]) => Promise<void>;
}

function SortableItem({ category }: { category: Category }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 bg-card border rounded-lg hover:bg-accent/50 transition-colors"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1">
        <div className="font-medium">{category.name || '(Keine Rolle)'}</div>
        <div className="text-sm text-muted-foreground">{category.count} Einträge</div>
      </div>
      <div className="text-sm text-muted-foreground">#{category.sort_order}</div>
    </div>
  );
}

export function CategorySortOrder({ title, description, categories: initialCategories, onSave }: CategorySortOrderProps) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setCategories((items) => {
        const oldIndex = items.findIndex((item) => item.name === active.id);
        const newIndex = items.findIndex((item) => item.name === over.id);

        const newItems = arrayMove(items, oldIndex, newIndex);

        // Update sort_order based on new positions
        const updatedItems = newItems.map((item, index) => ({
          ...item,
          sort_order: index + 1,
        }));

        setHasChanges(true);
        return updatedItems;
      });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(categories);
      setHasChanges(false);
      toast.success('Sortierung gespeichert', {
        description: 'Die Kategoriereihenfolge wurde erfolgreich aktualisiert.',
      });
    } catch (error) {
      console.error('Failed to save sort order:', error);
      toast.error('Fehler beim Speichern', {
        description: 'Die Sortierung konnte nicht gespeichert werden.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (categories.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Keine Kategorien vorhanden. Fügen Sie zuerst Einträge hinzu.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            size="sm"
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Speichert...' : 'Speichern'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={categories.map((c) => c.name)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {categories.map((category) => (
                <SortableItem key={category.name} category={category} />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {hasChanges && (
          <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Sie haben ungespeicherte Änderungen. Klicken Sie auf "Speichern", um die neue Reihenfolge zu übernehmen.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
