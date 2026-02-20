'use client';

/**
 * Divera Emergency Pool Page
 * Shows all incoming Divera 24/7 emergencies for selective attachment to events
 */

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { useEvent } from '@/lib/contexts/event-context';
import { apiClient, type ApiDiveraEmergency, type ApiEvent } from '@/lib/api-client';
import { wsClient } from '@/lib/websocket-client';
import { PageNavigation } from '@/components/page-navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Link2, RefreshCw, Search, Check, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

export default function DiveraPoolPage() {
  const { isAuthenticated, isEditor } = useAuth();
  const { selectedEvent: currentEvent } = useEvent();
  const [emergencies, setEmergencies] = useState<ApiDiveraEmergency[]>([]);
  const [activeEvents, setActiveEvents] = useState<ApiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmergencies, setSelectedEmergencies] = useState<Set<string>>(new Set());
  const [showAttachDialog, setShowAttachDialog] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [attaching, setAttaching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [demoMode, setDemoMode] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAlertSound = () => {
    if (!audioRef.current) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const emergenciesData = await apiClient.getDiveraEmergencies({ include_archived: true });
      setEmergencies(emergenciesData.emergencies);
      const eventsData = await apiClient.getEvents(false);
      setActiveEvents(eventsData.events);
    } catch (error: any) {
      if (!error.message?.includes('Verbindung zum Server')) {
        console.error('Failed to load Divera pool:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
    apiClient.getDemoStatus().then((status) => setDemoMode(status?.demo === true));
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    wsClient.connect();
    const unsubscribe = wsClient.on('divera_emergency_received', (data: any) => {
      const emergency = data.emergency as ApiDiveraEmergency;
      toast({
        title: 'Neuer Divera-Notfall',
        description: emergency.title,
        duration: 10000,
      });
      playAlertSound();
      loadData();
    });
    return () => unsubscribe();
  }, [isAuthenticated]);

  const toggleSelection = (emergencyId: string) => {
    const newSelection = new Set(selectedEmergencies);
    if (newSelection.has(emergencyId)) {
      newSelection.delete(emergencyId);
    } else {
      newSelection.add(emergencyId);
    }
    setSelectedEmergencies(newSelection);
  };

  const filteredEmergencies = emergencies.filter((emergency) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      emergency.title.toLowerCase().includes(query) ||
      emergency.text?.toLowerCase().includes(query) ||
      emergency.address?.toLowerCase().includes(query) ||
      emergency.divera_number?.toLowerCase().includes(query)
    );
  });

  const handleAttachClick = () => {
    if (selectedEmergencies.size === 0) return;
    if (currentEvent?.id) {
      setSelectedEventId(currentEvent.id);
    }
    setShowAttachDialog(true);
  };

  const handleAttach = async () => {
    if (!selectedEventId) return;
    setAttaching(true);
    try {
      const emergencyIds = Array.from(selectedEmergencies);
      if (emergencyIds.length === 1) {
        await apiClient.attachEmergencyToEvent(emergencyIds[0], selectedEventId);
      } else {
        await apiClient.bulkAttachEmergencies(emergencyIds, selectedEventId);
      }
      toast({
        title: 'Erfolgreich angehängt',
        description: `${emergencyIds.length} Notfall${emergencyIds.length > 1 ? 'e' : ''} wurde${emergencyIds.length > 1 ? 'n' : ''} dem Ereignis zugewiesen`,
      });
      setShowAttachDialog(false);
      setSelectedEmergencies(new Set());
      setSelectedEventId('');
      await loadData();
    } catch (error) {
      console.error('Failed to attach emergencies:', error);
      toast({
        variant: 'destructive',
        title: 'Fehler',
        description: 'Notfälle konnten nicht angehängt werden',
      });
    } finally {
      setAttaching(false);
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: de });
    } catch {
      return timestamp;
    }
  };

  if (!isAuthenticated) {
    return <div className="p-8 text-center text-muted-foreground">Nicht angemeldet</div>;
  }

  const hasSelection = selectedEmergencies.size > 0;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-2 min-h-14">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Divera Notfälle</h1>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {emergencies.length} Einträge
          </Badge>
        </div>
        <PageNavigation currentPage="divera" hasSelectedEvent={true} />
      </header>

      {/* Toolbar */}
      <div className="border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="h-9 px-3"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <div className="flex-1" />

          {isEditor && (
            <>
              {hasSelection && (
                <button
                  onClick={() => setSelectedEmergencies(new Set())}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {selectedEmergencies.size} ausgewählt — Aufheben
                </button>
              )}
              <Button
                onClick={handleAttachClick}
                disabled={!hasSelection}
                size="sm"
                className="h-9"
              >
                <Link2 className="mr-2 h-4 w-4" />
                Anhängen
              </Button>
            </>
          )}
        </div>
      </div>

      {/* List */}
      <main className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            Lädt...
          </div>
        ) : filteredEmergencies.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            {demoMode && !searchQuery ? (
              <div className="flex flex-col items-center gap-3 max-w-sm text-center">
                <Info className="h-8 w-8 text-amber-500" />
                <p className="font-medium text-foreground">Divera ist im Demo-Modus nicht verfügbar</p>
                <p className="text-sm">
                  Diese Seite zeigt eingehende Alarme von <span className="font-medium">Divera 24/7</span> an.
                  Im Demo-Modus ist keine Divera-Verbindung konfiguriert.
                </p>
              </div>
            ) : (
              <>
                <p>{searchQuery ? 'Keine Treffer' : 'Keine Notfälle vorhanden'}</p>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-2 text-sm text-primary hover:underline"
                  >
                    Suche zurücksetzen
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {filteredEmergencies.map((emergency) => {
              const isSelected = selectedEmergencies.has(emergency.id);
              const isAssigned = !!emergency.attached_to_event_id;
              const isArchived = emergency.is_archived;

              return (
                <div
                  key={emergency.id}
                  onClick={() => isEditor && toggleSelection(emergency.id)}
                  className={`
                    px-6 py-4 flex gap-4 transition-colors
                    ${isEditor ? 'cursor-pointer hover:bg-muted/50' : ''}
                    ${isSelected ? 'bg-primary/5' : ''}
                    ${isArchived ? 'opacity-50' : ''}
                  `}
                >
                  {/* Selection indicator */}
                  {isEditor && (
                    <div className="flex items-start pt-0.5">
                      <div
                        className={`
                          w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                          ${isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30'
                          }
                        `}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className={`font-medium truncate ${isAssigned ? 'text-muted-foreground' : ''}`}>
                          {emergency.title}
                        </p>
                        {emergency.address && (
                          <p className="text-sm text-muted-foreground truncate mt-0.5">
                            {emergency.address}
                          </p>
                        )}
                        {emergency.text && (
                          <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                            {emergency.text}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatTimeAgo(emergency.received_at)}
                        </span>
                        {isAssigned && (
                          <span className="text-xs text-muted-foreground">
                            Zugewiesen
                          </span>
                        )}
                        {isArchived && !isAssigned && (
                          <span className="text-xs text-muted-foreground">
                            Archiviert
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Attach Dialog */}
      <Dialog open={showAttachDialog} onOpenChange={setShowAttachDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>An Ereignis anhängen</DialogTitle>
            <DialogDescription>
              {selectedEmergencies.size} {selectedEmergencies.size === 1 ? 'Notfall wird' : 'Notfälle werden'} dem gewählten Ereignis zugewiesen.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Select value={selectedEventId} onValueChange={setSelectedEventId}>
              <SelectTrigger>
                <SelectValue placeholder="Ereignis wählen..." />
              </SelectTrigger>
              <SelectContent>
                {activeEvents.map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {event.name}
                    {event.training_flag && ' (Übung)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setShowAttachDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleAttach} disabled={!selectedEventId || attaching}>
              {attaching ? 'Wird angehängt...' : 'Anhängen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
