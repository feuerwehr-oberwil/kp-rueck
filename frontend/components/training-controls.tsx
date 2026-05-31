'use client';

import { useEffect, useMemo, useState } from 'react';
import { useEvent } from '@/lib/contexts/event-context';
import { useOperations } from '@/lib/contexts/operations-context';
import { apiClient, type ApiEmergencyTemplate, type ApiTrainingLocation } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Separator } from '@/components/ui/separator';
import {
  Zap,
  Flame,
  Droplet,
  Sparkles,
  Target,
  MapPin,
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

export function TrainingControls() {
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
      console.log('🚀 Generating normal training emergency...');
      const incidents = await apiClient.generateTrainingEmergency(selectedEvent.id, { category: 'normal', count: 1 });
      const incident = incidents[0];
      console.log('✓ Normal training emergency created:', incident.title, 'at', incident.location_address);

    } catch (error) {
      console.error('❌ Failed to generate emergency:', error);
      toast.error('Fehler', {
        description: 'Einsatz konnte nicht generiert werden',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateCritical = async () => {
    setIsGenerating(true);
    try {
      console.log('🚀 Generating critical training emergency...');
      const incidents = await apiClient.generateTrainingEmergency(selectedEvent.id, { category: 'critical', count: 1 });
      const incident = incidents[0];
      console.log('✓ Critical training emergency created:', incident.title, 'at', incident.location_address);

    } catch (error) {
      console.error('❌ Failed to generate emergency:', error);
      toast.error('Fehler', {
        description: 'Einsatz konnte nicht generiert werden',
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
      toast.success('Einsatz ausgelöst', {
        description: `${incident.title} @ ${incident.location_address}`,
      });
    } catch {
      toast.error('Fehler', {
        description: 'Einsatz konnte nicht ausgelöst werden',
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
      console.log('🚀 Generating burst of 5 training emergencies...');
      const incidents = await apiClient.generateTrainingEmergency(selectedEvent.id, { category: null, count: 5 });
      console.log(`✓ ${incidents.length} training emergencies created:`, incidents.map(i => i.title).join(', '));

    } catch (error) {
      console.error('❌ Failed to generate burst:', error);
      toast.error('Fehler', {
        description: 'Burst konnte nicht generiert werden',
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
            Übungs-Steuerung
          </CardTitle>
          <CardDescription>
            Manuelle Einsatz-Generierung für Training · {operations.length} Einsätze total
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Manual Generation Buttons */}
        <div className="space-y-2">
          <Label>Einzelne Einsätze generieren</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={handleGenerateNormal}
              disabled={isGenerating}
              variant="outline"
              className="w-full"
            >
              <Droplet className="mr-2 h-4 w-4 text-blue-600" />
              Normal
            </Button>
            <Button
              onClick={handleGenerateCritical}
              disabled={isGenerating}
              variant="outline"
              className="w-full"
            >
              <Flame className="mr-2 h-4 w-4 text-red-600" />
              Kritisch
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Normal: Wasser, Sturm, Baum | Kritisch: Brand, BMA, Personenrettung
          </p>
        </div>

        <Separator />

        {/* Manual / targeted dispatch */}
        <div className="space-y-2">
          <Label>Gezielter Einsatz</Label>
          <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={pickerLoaded ? 'Szenario wählen...' : 'Lade Szenarien...'}
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
                size="sm"
                onClick={() => setPinLocation(null)}
                className="h-7 w-7 p-0"
                title="Pin entfernen"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                <SelectTrigger className="flex-1">
                  <SelectValue
                    placeholder={pickerLoaded ? 'Adresse wählen...' : 'Lade Adressen...'}
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
                title="Pin auf Karte setzen"
              >
                <MapPin className="h-4 w-4" />
              </Button>
            </div>
          )}
          <Button
            onClick={handleManualDispatch}
            disabled={isDispatching || !canDispatch}
            className="w-full"
          >
            <Target className="mr-2 h-4 w-4" />
            Auslösen
          </Button>
          <p className="text-xs text-muted-foreground">
            Szenario + Adresse aus der Liste — oder Pin direkt auf die Karte setzen.
          </p>
        </div>

        <Separator />

        {/* Burst Generation */}
        <div className="space-y-2">
          <Label>Mehrere Einsätze gleichzeitig</Label>
          <Button
            onClick={handleGenerateBurst}
            disabled={isGenerating}
            variant="secondary"
            className="w-full"
          >
            <Zap className="mr-2 h-4 w-4" />
            Burst (5x zufällig)
          </Button>
          <p className="text-xs text-muted-foreground">
            Generiert 5 zufällige Einsätze gleichzeitig
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
