'use client';

/**
 * Divera Emergency Pool Page
 * Shows all incoming Divera 24/7 emergencies for selective attachment to events
 */

import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { apiClient, type ApiDiveraEmergency, type ApiEvent } from '@/lib/api-client';
import { wsClient } from '@/lib/websocket-client';
import { PageNavigation } from '@/components/page-navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Radio,
  AlertCircle,
  CheckCircle2,
  Archive,
  Link2,
  RefreshCw,
  MapPin,
  Clock,
  AlertTriangle,
  Bell
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';

export default function DiveraPoolPage() {
  const { isAuthenticated, isEditor } = useAuth();
  const [emergencies, setEmergencies] = useState<ApiDiveraEmergency[]>([]);
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmergencies, setSelectedEmergencies] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'unattached' | 'attached'>('all');
  const [showAttachDialog, setShowAttachDialog] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<string>('');
  const [attaching, setAttaching] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Play alert sound for high-priority emergencies
  const playAlertSound = () => {
    if (!audioRef.current) {
      // Create a simple beep sound using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // 800Hz beep
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
      // Load emergencies based on filter
      const params: any = { include_archived: false };
      if (filter === 'unattached') {
        params.attached = false;
      } else if (filter === 'attached') {
        params.attached = true;
      }

      const emergenciesData = await apiClient.getDiveraEmergencies(params);
      setEmergencies(emergenciesData.emergencies);

      // Load active events for attachment dropdown
      const eventsData = await apiClient.getEvents(false);
      setEvents(eventsData.events);
    } catch (error: any) {
      // Suppress logging for connection errors - the API client handles retries
      // Only log if it's not a connection timeout/network error
      if (!error.message?.includes('Verbindung zum Server')) {
        console.error('Failed to load Divera pool:', error);
      }
      // Don't show toast - API client already shows appropriate error messages
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, filter]);

  // Subscribe to WebSocket notifications for new Divera emergencies
  useEffect(() => {
    if (!isAuthenticated) return;

    // Connect WebSocket client
    wsClient.connect();

    // Subscribe to Divera emergency events
    const unsubscribe = wsClient.on('divera_emergency_received', (data: any) => {
      const emergency = data.emergency as ApiDiveraEmergency;

      // Show toast notification
      toast({
        title: '🚨 Neuer Divera-Notfall',
        description: (
          <div className="space-y-1">
            <div className="font-medium">{emergency.title}</div>
            {emergency.address && (
              <div className="text-sm text-muted-foreground">{emergency.address}</div>
            )}
          </div>
        ),
        duration: 10000, // 10 seconds
      });

      // Play sound alert for high-priority emergencies
      if (emergency.priority === 2) {
        playAlertSound();
      }

      // Auto-reload emergency list to show new emergency
      loadData();
    });

    return () => {
      unsubscribe();
    };
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

  const selectAll = () => {
    // Select all emergencies (including attached ones for re-attachment)
    setSelectedEmergencies(new Set(emergencies.map(e => e.id)));
  };

  const deselectAll = () => {
    setSelectedEmergencies(new Set());
  };

  const handleAttachClick = () => {
    if (selectedEmergencies.size === 0) {
      toast({
        variant: 'destructive',
        title: 'Fehler',
        description: 'Bitte wählen Sie mindestens einen Notfall aus',
      });
      return;
    }
    setShowAttachDialog(true);
  };

  const handleAttach = async () => {
    if (!selectedEvent) {
      toast({
        variant: 'destructive',
        title: 'Fehler',
        description: 'Bitte wählen Sie ein Ereignis aus',
      });
      return;
    }

    setAttaching(true);
    try {
      const emergencyIds = Array.from(selectedEmergencies);

      if (emergencyIds.length === 1) {
        await apiClient.attachEmergencyToEvent(emergencyIds[0], selectedEvent);
      } else {
        await apiClient.bulkAttachEmergencies(emergencyIds, selectedEvent);
      }

      toast({
        title: 'Erfolgreich',
        description: `${emergencyIds.length} Notfall${emergencyIds.length > 1 ? 'e' : ''} wurde${emergencyIds.length > 1 ? 'n' : ''} angehängt`,
      });

      setShowAttachDialog(false);
      setSelectedEmergencies(new Set());
      setSelectedEvent('');
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

  const getPriorityBadge = (priority: number) => {
    switch (priority) {
      case 2:
        return <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Hoch</Badge>;
      case 1:
        return <Badge variant="default" className="gap-1"><AlertCircle className="h-3 w-3" />Mittel</Badge>;
      default:
        return <Badge variant="secondary">Niedrig</Badge>;
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
    return <div>Nicht angemeldet</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/50 bg-card/50 backdrop-blur-sm px-4 md:px-6 py-4 min-h-20">
        <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div className="flex h-9 w-9 md:h-11 md:w-11 items-center justify-center rounded-xl bg-gradient-to-br from-orange-600 to-red-600 text-2xl shadow-lg flex-shrink-0">
              <Radio className="h-5 w-5 md:h-6 md:w-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-2xl font-bold tracking-tight">Divera 24/7 Notfälle</h1>
              <p className="text-xs md:text-sm text-muted-foreground hidden sm:block truncate">
                Eingehende Notfallmeldungen von Divera 24/7
              </p>
            </div>
          </div>
        </div>

        <PageNavigation currentPage="divera" hasSelectedEvent={true} />
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="container mx-auto space-y-6">
          <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Notfälle</SelectItem>
                    <SelectItem value="unattached">Nicht zugewiesen</SelectItem>
                    <SelectItem value="attached">Zugewiesen</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={loadData}
                  disabled={loading}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Action Bar */}
            {isEditor && (
              <div className="flex items-center justify-between mb-4 p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {selectedEmergencies.size} ausgewählt
                  </span>
                  {selectedEmergencies.size > 0 && (
                    <Button variant="ghost" size="sm" onClick={deselectAll}>
                      Auswahl aufheben
                    </Button>
                  )}
                  {emergencies.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={selectAll}>
                      Alle auswählen
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleAttachClick}
                    disabled={selectedEmergencies.size === 0}
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    An Ereignis anhängen ({selectedEmergencies.size})
                  </Button>
                </div>
              </div>
            )}

            {/* Emergency Table */}
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Lädt...
              </div>
            ) : emergencies.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Keine Notfälle gefunden
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {isEditor && <TableHead className="w-16 pl-6">Auswahl</TableHead>}
                    <TableHead>Priorität</TableHead>
                    <TableHead>Titel</TableHead>
                    <TableHead>Ort</TableHead>
                    <TableHead>Eingegangen</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emergencies.map((emergency) => (
                    <TableRow
                      key={emergency.id}
                      className={emergency.attached_to_event_id ? 'opacity-70' : ''}
                    >
                      {isEditor && (
                        <TableCell className="pl-6">
                          <div className="flex items-center justify-center w-8 h-8 rounded hover:bg-muted/50">
                            <Checkbox
                              checked={selectedEmergencies.has(emergency.id)}
                              onCheckedChange={() => toggleSelection(emergency.id)}
                              className="h-6 w-6 border-2 border-gray-400 dark:border-gray-500 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                            />
                          </div>
                        </TableCell>
                      )}
                      <TableCell>{getPriorityBadge(emergency.priority)}</TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{emergency.title}</div>
                          {emergency.divera_number && (
                            <div className="text-sm text-muted-foreground">
                              {emergency.divera_number}
                            </div>
                          )}
                          {emergency.text && (
                            <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {emergency.text}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {emergency.address ? (
                          <div className="flex items-start gap-1">
                            <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm">{emergency.address}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">Kein Ort</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {formatTimeAgo(emergency.received_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {emergency.attached_to_event_id ? (
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Zugewiesen
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Ausstehend
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        </div>
      </main>

      {/* Attach Dialog */}
      <Dialog open={showAttachDialog} onOpenChange={setShowAttachDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notfälle anhängen</DialogTitle>
            <DialogDescription>
              {selectedEmergencies.size} Notfall{selectedEmergencies.size > 1 ? 'e' : ''} an ein Ereignis anhängen
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Ereignis auswählen</label>
              <Select value={selectedEvent} onValueChange={setSelectedEvent}>
                <SelectTrigger>
                  <SelectValue placeholder="Ereignis wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {events.map((event) => (
                    <SelectItem key={event.id} value={event.id}>
                      {event.name}
                      {event.training_flag && ' [ÜBUNG]'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAttachDialog(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleAttach} disabled={!selectedEvent || attaching}>
              {attaching ? 'Wird angehängt...' : 'Anhängen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
