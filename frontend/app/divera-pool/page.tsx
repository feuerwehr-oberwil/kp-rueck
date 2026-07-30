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
import { MobileBottomNavigation } from '@/components/mobile-bottom-navigation';
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
import { useGlobalNavigation } from '@/lib/hooks/use-global-navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Link2, RefreshCw, Search, Check, Info, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslations } from 'next-intl';
import { getDateFnsLocale } from '@/lib/date-locale';

export default function DiveraPoolPage() {
  useGlobalNavigation();
  const t = useTranslations('divera.pool');
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
      const AudioContextCtor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const audioContext = new AudioContextCtor();
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
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Verbindung zum Server')) {
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
    const unsubscribe = wsClient.on(
      'divera_emergency_received',
      (data: { emergency: ApiDiveraEmergency; auto_attached?: boolean }) => {
        const emergency = data.emergency;
        // Neutral, not a success: an incoming alarm is news, not something that went well.
        toast(emergency.is_training
            ? t('newAlarmTraining')
            : emergency.source && emergency.source !== 'divera'
              ? t('newAlarmGeneric')
              : t('newEmergency'), {
          description: data.auto_attached
            ? t('autoAttached', { title: emergency.title })
            : emergency.title,
          duration: 10000,
        });
        playAlertSound();
        loadData();
      },
    );
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
      emergency.divera_number?.toLowerCase().includes(query) ||
      emergency.source?.toLowerCase().includes(query)
    );
  });

  // Simulated training alarms can only go to training events (backend enforces
  // this too) — with one selected, only training events are offered.
  const hasTrainingSelection = emergencies.some(
    (e) => selectedEmergencies.has(e.id) && e.is_training
  );
  const attachableEvents = hasTrainingSelection
    ? activeEvents.filter((e) => e.training_flag)
    : activeEvents;

  const handleAttachClick = () => {
    if (selectedEmergencies.size === 0) return;
    // Default to the currently selected event, but only if it's in the
    // selectable (non-archived, attachable) list so the dropdown can display it.
    // Otherwise clear any previously chosen event — a stale id from an earlier
    // dialog may not be attachable anymore (e.g. ÜBUNG entry selected now) and
    // would be submitted invisibly.
    setSelectedEventId(
      currentEvent?.id && attachableEvents.some((e) => e.id === currentEvent.id)
        ? currentEvent.id
        : ''
    );
    setShowAttachDialog(true);
  };

  const handleAttach = async () => {
    if (!selectedEventId) return;
    setAttaching(true);
    try {
      const emergencyIds = Array.from(selectedEmergencies);
      if (emergencyIds.length === 1) {
        await apiClient.attachEmergencyToEvent(emergencyIds[0], selectedEventId);
        toast.success(t('attachedSuccess'), {
          description: t('attachedOne'),
        });
      } else {
        const { created, errors } = await apiClient.bulkAttachEmergencies(emergencyIds, selectedEventId);
        if (errors.length > 0) {
          // Partial success — tell the operator exactly how many actually attached.
          toast.error(t('partiallyAttached'), {
            description: t('partiallyAttachedDescription', {
              created: created.length,
              total: emergencyIds.length,
              failed: errors.length,
            }),
          });
        } else {
          toast.success(t('attachedSuccess'), {
            description: t('attachedMany', { count: created.length }),
          });
        }
      }
      setShowAttachDialog(false);
      setSelectedEmergencies(new Set());
      setSelectedEventId('');
      await loadData();
    } catch (error) {
      console.error('Failed to attach emergencies:', error);
      toast.error(t('errorTitle'), {
        description: t('attachError'),
      });
    } finally {
      setAttaching(false);
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: getDateFnsLocale() });
    } catch {
      return timestamp;
    }
  };

  if (!isAuthenticated) {
    return <div className="p-8 text-center text-muted-foreground">{t('notLoggedIn')}</div>;
  }

  const hasSelection = selectedEmergencies.size > 0;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-2 min-h-14">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">{t('title')}</h1>
          <Badge variant="secondary" className="hidden sm:inline-flex">
            {t('entriesCount', { count: emergencies.length })}
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
              placeholder={t('searchPlaceholder')}
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
            className="px-3"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <div className="flex-1" />

          {isEditor && (
            <>
              {hasSelection && (
                <button
                  onClick={() => setSelectedEmergencies(new Set())}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  {t('selectedClear', { count: selectedEmergencies.size })}
                </button>
              )}
              <Button
                onClick={handleAttachClick}
                disabled={!hasSelection}
                size="sm"
              >
                <Link2 className="size-3.5" />
                {t('attach')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* List */}
      <main className="flex-1 overflow-auto pb-20 md:pb-0">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            {t('loading')}
          </div>
        ) : filteredEmergencies.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            {demoMode && !searchQuery ? (
              <div className="flex flex-col items-center gap-3 max-w-sm text-center">
                <Info className="h-8 w-8 text-warning-foreground" />
                <p className="font-medium text-foreground">{t('demoTitle')}</p>
                <p className="text-sm">
                  {t.rich('demoDescription', {
                    b: (chunks) => <span className="font-medium">{chunks}</span>,
                  })}
                </p>
              </div>
            ) : (
              <>
                <p>{searchQuery ? t('noResults') : t('noEmergencies')}</p>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-2 text-sm text-primary hover:underline"
                  >
                    {t('resetSearch')}
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
                          {emergency.is_training && (
                            <Badge
                              variant="outline"
                              className="mr-2 border-warning/60 text-warning-foreground align-middle"
                            >
                              {t('trainingBadge')}
                            </Badge>
                          )}
                          {/* Alarms from the generic webhook show their sender slug */}
                          {!emergency.is_training && emergency.source && emergency.source !== 'divera' && (
                            <Badge variant="outline" className="mr-2 align-middle uppercase">
                              {emergency.source}
                            </Badge>
                          )}
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
                            {t('assigned')}
                          </span>
                        )}
                        {isArchived && !isAssigned && (
                          <span className="text-xs text-muted-foreground">
                            {t('archived')}
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

      <MobileBottomNavigation currentPage="divera" hasSelectedEvent={true} />

      {/* Attach Dialog */}
      <Dialog open={showAttachDialog} onOpenChange={setShowAttachDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('attachDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('attachDialogDescription', { count: selectedEmergencies.size })}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Select value={selectedEventId} onValueChange={setSelectedEventId}>
              <SelectTrigger>
                {/* Render the label from our own state — Radix derives SelectValue's
                    text from the lazily-mounted SelectItems, which aren't mounted
                    until the dropdown is first opened, so a preset value would
                    otherwise show the placeholder. */}
                <SelectValue placeholder={t('selectEventPlaceholder')}>
                  {(() => {
                    const selected = attachableEvents.find((e) => e.id === selectedEventId);
                    if (!selected) return undefined;
                    return selected.training_flag ? t('eventTraining', { name: selected.name }) : selected.name;
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {attachableEvents.map((event) => (
                  <SelectItem key={event.id} value={event.id}>
                    {event.training_flag ? t('eventTraining', { name: event.name }) : event.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasTrainingSelection && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('trainingOnlyHint')}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowAttachDialog(false)} disabled={attaching}>
              {t('cancel')}
            </Button>
            <Button onClick={handleAttach} disabled={!selectedEventId || attaching}>
              {attaching && <Loader2 className="size-4 animate-spin" />}
              {t('attach')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
