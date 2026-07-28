'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEvent } from '@/lib/contexts/event-context';
import { useOperations } from '@/lib/contexts/operations-context';
import { apiClient, type ApiEmergencyTemplate, type ApiTrainingLocation } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { formatLocationForDisplay, getGlobalHomeCity } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import {
  Zap,
  Flame,
  Droplet,
  Sparkles,
  Target,
  MapPin,
  Phone,
  X,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MapPickerModal } from '@/components/location/map-picker-modal';

// Toast line "Titel @ Adresse" with the home town stripped; the address part is
// dropped entirely when it was only the home town.
function incidentToastDescription(incident: { title: string; location_address?: string | null; location_display?: string | null }): string {
  const location = incident.location_display ?? formatLocationForDisplay(incident.location_address ?? '', getGlobalHomeCity());
  return location ? `${incident.title} @ ${location}` : incident.title;
}

export function TrainingControls() {
  const t = useTranslations('training');
  const { selectedEvent } = useEvent();
  const { operations } = useOperations();
  const [isGenerating, setIsGenerating] = useState(false);

  // Manual dispatch picker state
  const [templates, setTemplates] = useState<ApiEmergencyTemplate[]>([]);
  const [locations, setLocations] = useState<ApiTrainingLocation[]>([]);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  // Ad-hoc pin from MapPickerModal — when set, overrides the dropdown.
  const [pinLocation, setPinLocation] = useState<
    { latitude: number; longitude: number; address: string } | null
  >(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);

  // Lazy-load template/location pools (only once when this panel mounts in a
  // training event).
  useEffect(() => {
    if (!selectedEvent?.training_flag || pickerLoaded) return;
    Promise.all([apiClient.getEmergencyTemplates(), apiClient.getTrainingLocations()])
      .then(([t, l]) => {
        setTemplates(t.filter((x) => x.is_active));
        setLocations(l.filter((x) => x.is_active));
        setPickerLoaded(true);
      })
      .catch(() => {
        // silent — picker just stays disabled
      });
  }, [selectedEvent?.training_flag, pickerLoaded]);

  // Sort templates by (category, title) so the dropdown reads predictably.
  const sortedTemplates = useMemo(
    () =>
      [...templates].sort((a, b) => {
        if (a.category !== b.category) return a.category === 'critical' ? -1 : 1;
        return a.title_pattern.localeCompare(b.title_pattern, 'de');
      }),
    [templates],
  );

  const sortedLocations = useMemo(
    () =>
      [...locations].sort((a, b) =>
        `${a.street} ${a.house_number}`.localeCompare(`${b.street} ${b.house_number}`, 'de'),
      ),
    [locations],
  );

  if (!selectedEvent?.training_flag) {
    return null; // Only show for training events
  }

  const handleGenerateNormal = async () => {
    setIsGenerating(true);
    try {
      const incidents = await apiClient.generateTrainingEmergency(selectedEvent.id, { category: 'normal', count: 1 });
      const incident = incidents[0];
      toast.success(t('controls.toastGenerated'), {
        description: incidentToastDescription(incident),
      });
    } catch (error) {
      console.error('❌ Failed to generate emergency:', error);
      toast.error(t('common.error'), {
        description: t('controls.toastGenerateFailed'),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateCritical = async () => {
    setIsGenerating(true);
    try {
      const incidents = await apiClient.generateTrainingEmergency(selectedEvent.id, { category: 'critical', count: 1 });
      const incident = incidents[0];
      toast.success(t('controls.toastGeneratedCritical'), {
        description: incidentToastDescription(incident),
      });
    } catch (error) {
      console.error('❌ Failed to generate emergency:', error);
      toast.error(t('common.error'), {
        description: t('controls.toastGenerateFailed'),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateTelefon = async () => {
    setIsGenerating(true);
    try {
      const incidents = await apiClient.generateTrainingEmergency(selectedEvent.id, { count: 1, source: 'intake' });
      const incident = incidents[0];
      toast.success(t('controls.toastPhoneGenerated'), {
        description: incidentToastDescription(incident),
      });
    } catch (error) {
      console.error('❌ Failed to generate telefon alarm:', error);
      toast.error(t('common.error'), {
        description: t('controls.toastPhoneFailed'),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const canDispatch =
    !!selectedTemplateId && (!!selectedLocationId || !!pinLocation);

  const handleManualDispatch = async () => {
    if (!selectedEvent || !selectedTemplateId) return;
    if (!selectedLocationId && !pinLocation) return;
    setIsDispatching(true);
    try {
      const incident = await apiClient.manualDispatch(
        selectedEvent.id,
        selectedTemplateId,
        // Pin takes precedence over the seeded dropdown if both are set.
        pinLocation
          ? { kind: 'pin', ...pinLocation }
          : { kind: 'seeded', locationId: selectedLocationId },
      );
      toast.success(t('controls.toastDispatched'), {
        description: incidentToastDescription(incident),
      });
    } catch {
      toast.error(t('common.error'), {
        description: t('controls.toastDispatchFailed'),
      });
    } finally {
      setIsDispatching(false);
    }
  };

  const handlePinSelect = (lat: number, lng: number, address: string | null) => {
    setPinLocation({
      latitude: lat,
      longitude: lng,
      // Fall back to coords-as-string when Nominatim couldn't resolve an address.
      address: address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    });
    // Pin wins over seeded selection — clear the dropdown for clarity.
    setSelectedLocationId('');
  };

  const handleGenerateBurst = async () => {
    setIsGenerating(true);
    try {
      // A burst simulates a wave of routine alarms — keep it mostly default
      // severity with only a rare critical (high-prio) one, so it doesn't blast
      // the high-prio alert sound five times or read as an implausible cluster
      // of major incidents.
      const CRIT_CHANCE = 0.05;
      let critical = 0;
      for (let i = 0; i < 5; i++) if (Math.random() < CRIT_CHANCE) critical++;
      const normal = 5 - critical;
      const batches = await Promise.all([
        normal > 0
          ? apiClient.generateTrainingEmergency(selectedEvent.id, { category: 'normal', count: normal })
          : Promise.resolve([]),
        critical > 0
          ? apiClient.generateTrainingEmergency(selectedEvent.id, { category: 'critical', count: critical })
          : Promise.resolve([]),
      ]);
      const incidents = batches.flat();
      toast.success(t('controls.toastBurstGenerated', { count: incidents.length }), {
        description: incidents.map(i => i.title).join(', '),
      });
    } catch (error) {
      console.error('❌ Failed to generate burst:', error);
      toast.error(t('common.error'), {
        description: t('controls.toastBurstFailed'),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-orange-600" />
            {t('common.title')}
          </CardTitle>
          <CardDescription>
            {t('controls.description', { count: operations.length })}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Manual Generation Buttons */}
        <div className="space-y-2">
          <Label>{t('controls.generateSingle')}</Label>
          {/* Three-up row down to phone width: the Button base is
              `whitespace-nowrap shrink-0`, so each cell needs `min-w-0` + a
              truncating label or the content overflows the grid column. */}
          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={handleGenerateNormal}
              disabled={isGenerating}
              variant="outline"
              className="w-full min-w-0 text-xs sm:text-sm"
            >
              <Droplet className="size-3.5 text-blue-600 sm:size-4" />
              <span className="truncate">{t('controls.normal')}</span>
            </Button>
            <Button
              onClick={handleGenerateCritical}
              disabled={isGenerating}
              variant="outline"
              className="w-full min-w-0 text-xs sm:text-sm"
            >
              <Flame className="size-3.5 text-red-600 sm:size-4" />
              <span className="truncate">{t('controls.critical')}</span>
            </Button>
            <Button
              onClick={handleGenerateTelefon}
              disabled={isGenerating}
              variant="outline"
              className="w-full min-w-0 text-xs sm:text-sm"
            >
              <Phone className="size-3.5 text-sky-600 sm:size-4" />
              <span className="truncate">{t('controls.phoneAlarm')}</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('controls.generateHint')}
          </p>
        </div>

        <Separator />

        {/* Manual / targeted dispatch */}
        <div className="space-y-2">
          <Label>{t('controls.targetedDispatch')}</Label>
          <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={pickerLoaded ? t('controls.scenarioPlaceholder') : t('controls.scenarioLoading')}
              />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {sortedTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="flex items-center gap-2">
                    {t.category === 'critical' ? (
                      <Flame className="h-3.5 w-3.5 text-red-600" />
                    ) : (
                      <Droplet className="h-3.5 w-3.5 text-blue-600" />
                    )}
                    {t.title_pattern}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Location row — either pick from seeded addresses or drop a pin
              on the map. The pin overrides the dropdown when both are set. */}
          {pinLocation ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-sm">
              <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
              <span className="flex-1 truncate" title={pinLocation.address}>
                {pinLocation.address}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setPinLocation(null)}
                // Desktop-only is the rule for the board, but this page is the
                // one thing that gets driven from a phone (spawning training
                // incidents), so the target stays generous below `sm`.
                className="min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px]"
                title={t('controls.removePin')}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                <SelectTrigger className="flex-1">
                  <SelectValue
                    placeholder={pickerLoaded ? t('controls.addressPlaceholder') : t('controls.addressLoading')}
                  />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {sortedLocations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.street} {l.house_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPickerOpen(true)}
                className="min-h-[44px] min-w-[44px] flex-shrink-0 sm:min-h-[36px] sm:min-w-[36px]"
                title={t('controls.setPin')}
              >
                <MapPin className="size-3.5" />
              </Button>
            </div>
          )}
          <Button
            onClick={handleManualDispatch}
            disabled={isDispatching || !canDispatch}
            className="w-full"
          >
            <Target className="size-4" />
            {t('controls.dispatch')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('controls.dispatchHint')}
          </p>
        </div>

        <Separator />

        {/* Burst Generation */}
        <div className="space-y-2">
          <Label>{t('controls.multipleIncidents')}</Label>
          <Button
            onClick={handleGenerateBurst}
            disabled={isGenerating}
            variant="secondary"
            className="w-full"
          >
            <Zap className="size-4" />
            {t('controls.burst')}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('controls.burstHint')}
          </p>
        </div>
      </CardContent>

      {/* Map-pin picker for ad-hoc dispatch locations */}
      <MapPickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        initialLat={pinLocation?.latitude}
        initialLon={pinLocation?.longitude}
        onLocationSelect={handlePinSelect}
      />
    </Card>
  );
}
