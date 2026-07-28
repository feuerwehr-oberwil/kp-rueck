'use client';

import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';

interface DiveraNotificationProps {
  message: string;
  isTraining: boolean;
}

export function DiveraNotification({ message, isTraining }: DiveraNotificationProps) {
  const t = useTranslations('divera.notification');
  if (!isTraining) {
    return null;
  }

  return (
    <Alert className="bg-info/10 border-info/30">
      <Info className="h-4 w-4 text-info" />
      <AlertDescription className="text-sm">
        <strong>{t('trainingTag')}</strong> {message}
      </AlertDescription>
    </Alert>
  );
}
