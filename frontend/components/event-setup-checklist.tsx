'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { X, ClipboardCheck, Check, MessageCircle, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import {
  generateChecklistTasks,
  ChecklistTaskState,
  isTaskComplete,
  checklistOverridesKey,
  resolveWhatsAppMessage,
  WHATSAPP_MESSAGE_1_KEY,
  WHATSAPP_MESSAGE_2_KEY,
  DEFAULT_WHATSAPP_MESSAGE_1,
  DEFAULT_WHATSAPP_MESSAGE_2,
} from '@/lib/checklist-tasks'
import { cn, copyToClipboard } from '@/lib/utils'

interface EventSetupChecklistProps {
  eventId: string
  eventName: string
  onDismiss: () => void
  onAllTasksComplete?: () => void
  onChecklistLoaded?: () => void
}

export function EventSetupChecklist({ eventId, onDismiss, onAllTasksComplete, onChecklistLoaded }: EventSetupChecklistProps) {
  const [tasks, setTasks] = useState<ChecklistTaskState[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [whatsappMessages, setWhatsappMessages] = useState({
    m1: DEFAULT_WHATSAPP_MESSAGE_1,
    m2: DEFAULT_WHATSAPP_MESSAGE_2,
  })

  // --- Link helpers: generate the public link, then copy it or print its QR ---
  const toFullUrl = (link: string) => `${window.location.origin}${link}`

  const shareLink = useCallback(
    async (
      generate: () => Promise<{ link: string }>,
      mode: 'copy' | 'print',
      meta: { title: string; subtitle: string; copyLabel: string }
    ) => {
      try {
        const { link } = await generate()
        const url = toFullUrl(link)
        if (mode === 'copy') {
          await copyToClipboard(url)
          toast.success(`${meta.copyLabel} kopiert`, {
            description: 'Der Link wurde in die Zwischenablage kopiert.',
          })
        } else {
          await apiClient.queueQRCodePrint({
            qr_content: url,
            title: meta.title,
            subtitle: meta.subtitle,
            event_id: eventId,
          })
          toast.info('QR-Code wird gedruckt…', {
            description: 'Der Auftrag wurde an den Drucker gesendet.',
          })
        }
      } catch (error) {
        console.error('Link share failed:', error)
        toast.error(mode === 'copy' ? 'Link konnte nicht kopiert werden' : 'Druck fehlgeschlagen')
      }
    },
    [eventId]
  )

  const checkInMeta = {
    title: 'Personal Check-In',
    subtitle: 'QR scannen zum Einchecken — funktioniert ohne Anmeldung.',
    copyLabel: 'Check-In Link',
  }
  const rekoMeta = {
    title: 'Reko-Dashboard',
    subtitle: 'Reko-Personal sieht Zuweisungen und füllt Formulare aus — ohne Anmeldung.',
    copyLabel: 'Reko-Link',
  }
  const alarmMeta = {
    title: 'Alarm-Link',
    subtitle: 'Neue Alarme erfassen (Telefon/Walk-in) — ohne Anmeldung.',
    copyLabel: 'Alarm-Link',
  }

  const handleCopyCheckInLink = () => shareLink(() => apiClient.generateCheckInLink(eventId), 'copy', checkInMeta)
  const handlePrintCheckInLink = () => shareLink(() => apiClient.generateCheckInLink(eventId), 'print', checkInMeta)
  const handleCopyRekoLink = () => shareLink(() => apiClient.generateRekoDashboardLink(eventId), 'copy', rekoMeta)
  const handlePrintRekoLink = () => shareLink(() => apiClient.generateRekoDashboardLink(eventId), 'print', rekoMeta)
  const handleCopyAlarmLink = () => shareLink(() => apiClient.generateAlarmLink(eventId), 'copy', alarmMeta)
  const handlePrintAlarmLink = () => shareLink(() => apiClient.generateAlarmLink(eventId), 'print', alarmMeta)

  const handleTestPrint = async () => {
    try {
      await apiClient.queueTestPrint()
      toast.info('Testdruck eingereiht – warte auf Drucker…', {
        description: 'Der Drucker-Status wird automatisch aktualisiert.',
      })
    } catch (error) {
      console.error('Failed to queue test print:', error)
      toast.error('Testdruck konnte nicht gestartet werden')
    }
  }

  const handleShowTileSetup = () => {
    toast.info('Tile-Setup', {
      description: 'Öffnen Sie die Hilfe-Seite für Anleitungen zur Offline-Karten-Einrichtung.',
      action: {
        label: 'Zur Hilfe',
        onClick: () => window.open('/help#offline-maps', '_blank'),
      },
    })
  }

  const handleSendWhatsApp = (which: 1 | 2) => {
    // Copy only — never auto-tick, so the operator can re-copy and checks it off
    // manually once it's actually sent.
    const message = which === 1 ? whatsappMessages.m1 : whatsappMessages.m2
    copyToClipboard(message)
      .then(() =>
        toast.success(`WhatsApp-Nachricht ${which} kopiert`, {
          description: 'In WhatsApp einfügen und senden, danach manuell abhaken.',
        })
      )
      .catch(() => toast.error('Fehler beim Kopieren'))
  }

  // Load checklist state
  const loadChecklistState = useCallback(async () => {
    try {
      setIsLoading(true)

      // The tile-server health probe points at the operator's own localhost, which
      // has no tile server on most setups (incl. prod) — a bare fetch there has no
      // timeout and stalls the whole checklist open. Bound it and run it alongside
      // the API calls instead of sequentially after them.
      const checkMapTiles = async () => {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 1500)
          try {
            return (await fetch('http://localhost:8080/health', { signal: controller.signal })).ok
          } finally {
            clearTimeout(timer)
          }
        } catch {
          return false
        }
      }

      const [attendance, specialFunctions, vehicles, settings, printerStatus, mapTilesAvailable] =
        await Promise.all([
          apiClient.getEventAttendance(eventId).catch(() => []),
          apiClient.getEventSpecialFunctions(eventId).catch(() => []),
          apiClient.getVehicles().catch(() => []),
          apiClient.getAllSettings().catch(() => ({})),
          apiClient.getPrinterStatus().catch(() => null),
          checkMapTiles(),
        ])

      setWhatsappMessages({
        m1: resolveWhatsAppMessage(settings, WHATSAPP_MESSAGE_1_KEY, DEFAULT_WHATSAPP_MESSAGE_1),
        m2: resolveWhatsAppMessage(settings, WHATSAPP_MESSAGE_2_KEY, DEFAULT_WHATSAPP_MESSAGE_2),
      })

      const updatedTasks = generateChecklistTasks({
        eventId,
        checkedInPersonnel: attendance.filter((a) => a.checked_in).length,
        totalVehicles: vehicles.length,
        driverAssignments: specialFunctions.filter((f) => f.function_type === 'driver').length,
        rekoOfficers: specialFunctions.filter((f) => f.function_type === 'reko').length,
        magazinStaff: specialFunctions.filter((f) => f.function_type === 'magazin').length,
        mapTilesAvailable,
        printerEnabled: printerStatus?.enabled ?? false,
        printerAgentOnline: printerStatus?.agent_online ?? false,
        onCopyCheckInLink: handleCopyCheckInLink,
        onPrintCheckInLink: handlePrintCheckInLink,
        onCopyRekoLink: handleCopyRekoLink,
        onPrintRekoLink: handlePrintRekoLink,
        onCopyAlarmLink: handleCopyAlarmLink,
        onPrintAlarmLink: handlePrintAlarmLink,
        onShowTileSetup: handleShowTileSetup,
        onTestPrint: handleTestPrint,
      })

      setTasks(updatedTasks)
      onChecklistLoaded?.()
    } catch (error) {
      console.error('Failed to load checklist state:', error)
      toast.error('Fehler beim Laden der Checkliste')
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, onChecklistLoaded])

  useEffect(() => {
    loadChecklistState()
    const interval = setInterval(loadChecklistState, 5000)
    return () => clearInterval(interval)
  }, [loadChecklistState])

  // Load tick/un-tick overrides from localStorage
  useEffect(() => {
    if (!eventId) return
    try {
      const stored = localStorage.getItem(checklistOverridesKey(eventId))
      setOverrides(stored ? JSON.parse(stored) : {})
    } catch {
      setOverrides({})
    }
  }, [eventId])

  const toggleTask = (task: ChecklistTaskState) => {
    const next = { ...overrides, [task.id]: !isTaskComplete(task, overrides) }
    setOverrides(next)
    localStorage.setItem(checklistOverridesKey(eventId), JSON.stringify(next))
  }

  // Derived progress (effective completion = override ?? auto-detected)
  const completedTasks = tasks.filter((t) => isTaskComplete(t, overrides)).length
  const allComplete = tasks.length > 0 && completedTasks === tasks.length
  const progressPercent = tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0

  // Keep tasks in their natural order — don't float completed ones to the bottom.
  // Reordering on tick makes un-ticking harder (the row jumps away).
  const sortedTasks = tasks

  useEffect(() => {
    if (tasks.length === 0) return
    if (allComplete) onAllTasksComplete?.()
  }, [allComplete, tasks.length, onAllTasksComplete])

  if (isLoading && tasks.length === 0) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground">Checkliste wird geladen...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <ClipboardCheck className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold">Setup-Checkliste</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm tabular-nums text-muted-foreground">
              {completedTasks}/{tasks.length}
            </span>
            <Progress value={progressPercent} className="h-2 w-20" />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDismiss}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Task list */}
        <div className="space-y-1">
          {sortedTasks.map((task) => {
            const isCompleted = isTaskComplete(task, overrides)
            const action = task.actionButtons?.[0]
            const ActionIcon = action?.icon

            return (
              <div
                key={task.id}
                role="button"
                tabIndex={0}
                onClick={() => toggleTask(task)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleTask(task)
                  }
                }}
                aria-pressed={isCompleted}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors',
                  isCompleted ? 'bg-muted/30 hover:bg-muted/50' : 'bg-muted/50 hover:bg-muted/70'
                )}
              >
                {/* Checkbox — whole row toggles, this is just the indicator */}
                <div className="flex-shrink-0">
                  {isCompleted ? (
                    <div className="h-[18px] w-[18px] rounded-full bg-success flex items-center justify-center">
                      <Check className="h-3 w-3 text-white" />
                    </div>
                  ) : (
                    <div className="h-[18px] w-[18px] rounded-full border-2 border-muted-foreground/50" />
                  )}
                </div>

                {/* Title + status detail */}
                <div className="flex-1 min-w-0">
                  <span className={cn('block truncate', isCompleted && 'text-muted-foreground line-through')}>
                    {task.title}
                  </span>
                  {task.metadata?.details && !isCompleted && (
                    <span className="block text-xs text-muted-foreground/80 truncate">
                      {task.metadata.details}
                    </span>
                  )}
                </div>

                {/* Action — clicks here must NOT toggle the row */}
                <div
                  className="flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {!isCompleted && task.isWhatsApp ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 px-3 text-xs">
                          <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                          WhatsApp senden
                          <ChevronDown className="h-3.5 w-3.5 ml-1.5 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuItem onClick={() => handleSendWhatsApp(1)} className="flex-col items-start gap-0.5">
                          <span className="font-medium">Nachricht 1 · Standby</span>
                          <span className="text-xs text-muted-foreground line-clamp-2">{whatsappMessages.m1}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSendWhatsApp(2)} className="flex-col items-start gap-0.5">
                          <span className="font-medium">Nachricht 2 · Einrücken</span>
                          <span className="text-xs text-muted-foreground line-clamp-2">{whatsappMessages.m2}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : !isCompleted && action && ActionIcon ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3 text-xs"
                      onClick={action.onClick || undefined}
                      asChild={!!action.href}
                    >
                      {action.href ? (
                        <a href={action.href}>
                          <ActionIcon className="h-3.5 w-3.5 mr-1.5" />
                          {action.label}
                        </a>
                      ) : (
                        <>
                          <ActionIcon className="h-3.5 w-3.5 mr-1.5" />
                          {action.label}
                        </>
                      )}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
    </div>
  )
}
