'use client';

import { useState, useEffect, useRef } from 'react';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
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

function SortableItem({
  category,
  index,
  isDragging
}: {
  category: Category;
  index: number;
  isDragging: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    const dragHandle = dragHandleRef.current;
    if (!element || !dragHandle) return;

    return combine(
      draggable({
        element: dragHandle,
        getInitialData: () => ({ index, category }),
        onDragStart: () => element.setAttribute('data-dragging', 'true'),
        onDrop: () => element.removeAttribute('data-dragging'),
      }),
      dropTargetForElements({
        element,
        getData: () => ({ index }),
        canDrop: ({ source }) => source.data.index !== index,
      })
    );
  }, [index, category]);

  return (
    <div
      ref={ref}
      className="flex items-center gap-3 p-3 bg-card border rounded-lg hover:bg-accent/50 transition-colors"
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      <div
        ref={dragHandleRef}
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
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      onDrop: ({ source, location }) => {
        const destination = location.current.dropTargets[0];
        if (!destination) return;

        const sourceIndex = source.data.index as number;
        const destinationIndex = destination.data.index as number;

        if (sourceIndex === destinationIndex) return;

        setCategories((items) => {
          const reordered = reorder({
            list: items,
            startIndex: sourceIndex,
            finishIndex: destinationIndex,
          });

          // Update sort_order based on new positions
          const updatedItems = reordered.map((item, index) => ({
            ...item,
            sort_order: index + 1,
          }));

          setHasChanges(true);
          setDraggingIndex(null);
          return updatedItems;
        });
      },
      onDragStart: ({ source }) => {
        setDraggingIndex(source.data.index as number);
      },
      onDrag: () => {
        // Optional: could add visual feedback during drag
      },
    });
  }, []);

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
        <div ref={containerRef} className="space-y-2">
          {categories.map((category, index) => (
            <SortableItem
              key={category.name}
              category={category}
              index={index}
              isDragging={draggingIndex === index}
            />
          ))}
        </div>

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
