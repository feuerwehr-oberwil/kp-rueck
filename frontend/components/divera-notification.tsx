'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';

interface DiveraNotificationProps {
  message: string;
  isTraining: boolean;
}

export function DiveraNotification({ message, isTraining }: DiveraNotificationProps) {
  if (!isTraining) {
    return null;
  }

  return (
    <Alert className="bg-blue-50 border-blue-200">
      <Info className="h-4 w-4 text-blue-600" />
      <AlertDescription className="text-sm">
        <strong>[ÜBUNG]</strong> {message}
      </AlertDescription>
    </Alert>
  );
}
