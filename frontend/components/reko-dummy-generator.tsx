'use client';

import { Button } from '@/components/ui/button';
import { Wand2 } from 'lucide-react';

interface RekoDummyGeneratorProps {
  isTraining: boolean;
  onGenerate: () => void;
}

export function RekoDummyGenerator({ isTraining, onGenerate }: RekoDummyGeneratorProps) {
  if (!isTraining) {
    return null; // Only show in training mode
  }

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">Übungs-Modus</h3>
          <p className="text-xs text-muted-foreground">
            Dummy-Daten für schnelleres Training generieren
          </p>
        </div>
        <Button onClick={onGenerate} variant="outline" size="sm">
          <Wand2 className="mr-2 h-4 w-4" />
          Ausfüllen
        </Button>
      </div>
    </div>
  );
}
