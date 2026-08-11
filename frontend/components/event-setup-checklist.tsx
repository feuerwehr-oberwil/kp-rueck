'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
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
import { usePrintJobToast } from '@/lib/hooks/use-print-job-toast'
import { getTileBaseUrl } from '@/lib/env'
import {
  generateChecklistTasks,
  findVehiclesWithoutDriver,
  ChecklistTaskState,
  isTaskComplete,
  isFallbackReady,
  checklistOverridesKey,
  resolveWhatsAppMessage,
  WHATSAPP_MESSAGE_1_KEY,
  WHATSAPP_MESSAGE_2_KEY,
  DEFAULT_WHATSAPP_MESSAGE_1,
  DEFAULT_WHATSAPP_MESSAGE_2,
} from '@/lib/checklist-tasks'
import { useOperations } from '@/lib/contexts/operations-context'
import { cn, copyToClipboard } from '@/lib/utils'
import { isBooleanRecord, readJson, writeJson } from '@/lib/utils/safe-storage'

interface EventSetupChecklistProps {
  eventId: string
  eventName: string
  onDismiss: () => void
  onAllTasksComplete?: () => void
  onChecklistLoaded?: () => void
  /** Opens the Fahrzeuge sheet — the one place a driver is assigned per vehicle. */
  onOpenVehicles?: () => void
  /** Opens the Appell — where the count on the check-in row is actually made. */
  onOpenAttendance?: () => void
}

export function EventSetupChecklist({
  eventId,
  onDismiss,
  onAllTasksComplete,
  onChecklistLoaded,
  onOpenVehicles,
  onOpenAttendance,
}: EventSetupChecklistProps) {
  // The driver prompt is queued through the context, not opened here — it is mounted in
  // the root layout, so it survives this popover being dismissed.
  const { promptDriversForVehicles } = useOperations()
  const t = useTranslations('checklist.setup')
  const tPrint = useTranslations('print.toasts')
  const trackPrint = usePrintJobToast()
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
          toast.success(t('linkCopied', { label: meta.copyLabel }), {
            description: t('linkCopiedDescription'),
          })
        } else {
          await apiClient.queueQRCodePrint({
            qr_content: url,
            title: meta.title,
            subtitle: meta.subtitle,
            event_id: eventId,
          })
          toast.info(t('qrPrinting'), {
            description: t('qrPrintingDescription'),
          })
        }
      } catch (error) {
        console.error('Link share failed:', error)
        toast.error(mode === 'copy' ? t('copyFailed') : t('printFailed'))
      }
    },
    [eventId, t]
  )

  const checkInMeta = {
    title: t('checkInTitle'),
    subtitle: t('checkInSubtitle'),
    copyLabel: t('checkInCopyLabel'),
  }
  const rekoMeta = {
    title: t('rekoTitle'),
    subtitle: t('rekoSubtitle'),
    copyLabel: t('rekoCopyLabel'),
  }
  const alarmMeta = {
    title: t('alarmTitle'),
    subtitle: t('alarmSubtitle'),
    copyLabel: t('alarmCopyLabel'),
  }

  const handleCopyCheckInLink = () => shareLink(() => apiClient.generateCheckInLink(eventId), 'copy', checkInMeta)
  const handlePrintCheckInLink = () => shareLink(() => apiClient.generateCheckInLink(eventId), 'print', checkInMeta)
  const handleCopyRekoLink = () => shareLink(() => apiClient.generateRekoDashboardLink(eventId), 'copy', rekoMeta)
  const handlePrintRekoLink = () => shareLink(() => apiClient.generateRekoDashboardLink(eventId), 'print', rekoMeta)
  const handleCopyAlarmLink = () => shareLink(() => apiClient.generateAlarmLink(eventId), 'copy', alarmMeta)
  const handlePrintAlarmLink = () => shareLink(() => apiClient.generateAlarmLink(eventId), 'print', alarmMeta)

  const handleTestPrint = async () => {
    try {
      const job = await apiClient.queueTestPrint()
      // "Der Drucker-Status wird automatisch aktualisiert" only became true here:
      // the toast is now followed to completed/failed instead of ending at "queued".
      trackPrint(job.id, {
        sentTitle: t('testPrintQueued'),
        sentDescription: t('testPrintQueuedDescription'),
        subject: tPrint('subjectTest'),
      })
    } catch (error) {
      console.error('Failed to queue test print:', error)
      toast.error(t('testPrintFailed'))
    }
  }

  const handleShowTileSetup = () => {
    toast.info(t('tileSetupTitle'), {
      description: t('tileSetupDescription'),
      action: {
        label: t('tileSetupAction'),
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
        toast.success(t('whatsappCopied', { number: which }), {
          description: t('whatsappCopiedDescription'),
        })
      )
      .catch(() => toast.error(t('copyError')))
  }

  // Load checklist state
  const loadChecklistState = useCallback(async () => {
    try {
      setIsLoading(true)

      // Tile-server health probe. On a deployment this is /tiles on our own origin; in
      // local dev it is the tileserver container on :8080, which most dev machines don't
      // run — and a bare fetch there has no timeout and stalls the whole checklist open.
      // Bound it and run it alongside the API calls instead of sequentially after them.
      const checkMapTiles = async () => {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 1500)
          try {
            return (await fetch(`${getTileBaseUrl()}/health`, { signal: controller.signal })).ok
          } finally {
            clearTimeout(timer)
          }
        } catch {
          return false
        }
      }

      const [attendance, specialFunctions, vehicles, settings, printerStatus, mapTilesAvailable] =
        await Promise.all([
          apiClient.getEventCheckInList(eventId).catch(() => ({ personnel: [] })),
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
        checkedInPersonnel: attendance.personnel.filter((p) => p.checked_in).length,
        totalVehicles: vehicles.length,
        driverAssignments: specialFunctions.filter((f) => f.function_type === 'driver').length,
        vehiclesWithoutDriver: findVehiclesWithoutDriver(vehicles, specialFunctions).length,
        rekoOfficers: specialFunctions.filter((f) => f.function_type === 'reko').length,
        magazinStaff: specialFunctions.filter((f) => f.function_type === 'magazin').length,
        mapTilesAvailable,
        printerEnabled: printerStatus?.enabled ?? false,
        printerAgentOnline: printerStatus?.agent_online ?? false,
        fallbackReady: isFallbackReady(settings, printerStatus?.enabled ?? false),
        onCopyCheckInLink: handleCopyCheckInLink,
        onPrintCheckInLink: handlePrintCheckInLink,
        onCopyRekoLink: handleCopyRekoLink,
        onPrintRekoLink: handlePrintRekoLink,
        onCopyAlarmLink: handleCopyAlarmLink,
        onPrintAlarmLink: handlePrintAlarmLink,
        onShowTileSetup: handleShowTileSetup,
        onTestPrint: handleTestPrint,
        onOpenFallbackSettings: () => {
          window.location.href = '/settings?section=fallback'
        },
        // A step that names a modal should open it. Closing the popover first,
        // because the sheet it opens sits behind it.
        onOpenVehicles: () => {
          onDismiss()
          onOpenVehicles?.()
        },
        // Hand the whole run over at once: the prompt lives in the root layout, so it
        // outlives this popover closing underneath it.
        onAssignDrivers: () => {
          onDismiss()
          promptDriversForVehicles(findVehiclesWithoutDriver(vehicles, specialFunctions))
        },
        onOpenAttendance: () => {
          onDismiss()
          onOpenAttendance?.()
        },
      })

      setTasks(updatedTasks)
      onChecklistLoaded?.()
    } catch (error) {
      console.error('Failed to load checklist state:', error)
      toast.error(t('loadFailed'))
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
    setOverrides(readJson(checklistOverridesKey(eventId), isBooleanRecord, {}))
  }, [eventId])

  const toggleTask = (task: ChecklistTaskState) => {
    const next = { ...overrides, [task.id]: !isTaskComplete(task, overrides) }
    setOverrides(next)
    // Guarded: an unguarded setItem throws once localStorage is full, and this
    // runs in a click handler where the throw escapes React entirely.
    writeJson(checklistOverridesKey(eventId), next)
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
          <span className="text-muted-foreground">{t('loading')}</span>
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
            <h3 className="text-base font-semibold">{t('title')}</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm tabular-nums text-muted-foreground">
              {completedTasks}/{tasks.length}
            </span>
            <Progress value={progressPercent} className="h-2 w-20" />
            <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label={t('dismiss')}>
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Task list */}
        <div className="space-y-1">
          {sortedTasks.map((task) => {
            const isCompleted = isTaskComplete(task, overrides)
            // Every button, not just the first — a row that offers two ways in (share
            // the link *or* tick the names yourself) silently lost the second one here.
            const actions = task.actionButtons ?? []

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

                {/* Actions — clicks here must NOT toggle the row */}
                <div
                  className="flex flex-shrink-0 items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {!isCompleted && task.isWhatsApp ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 px-3 text-xs">
                          <MessageCircle className="size-3.5" />
                          {t('whatsappSend')}
                          <ChevronDown className="size-3.5 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuItem onClick={() => handleSendWhatsApp(1)} className="flex-col items-start gap-0.5">
                          <span className="font-medium">{t('message1')}</span>
                          <span className="text-xs text-muted-foreground line-clamp-2">{whatsappMessages.m1}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleSendWhatsApp(2)} className="flex-col items-start gap-0.5">
                          <span className="font-medium">{t('message2')}</span>
                          <span className="text-xs text-muted-foreground line-clamp-2">{whatsappMessages.m2}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : !isCompleted ? (
                    actions.map((action) => {
                      const ActionIcon = action.icon
                      if (!ActionIcon) return null
                      return (
                        <Button
                          key={action.label}
                          // Deliberately not action.variant: the renderer has always drawn
                          // these outline, and honouring the field would restyle every row.
                          variant="outline"
                          size="sm"
                          className="h-8 px-3 text-xs"
                          onClick={action.onClick || undefined}
                          asChild={!!action.href}
                        >
                          {action.href ? (
                            <a href={action.href}>
                              <ActionIcon className="size-3.5" />
                              {action.label}
                            </a>
                          ) : (
                            <>
                              <ActionIcon className="size-3.5" />
                              {action.label}
                            </>
                          )}
                        </Button>
                      )
                    })
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
    </div>
  )
}
