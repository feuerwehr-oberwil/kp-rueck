'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { X, ClipboardCheck, Rocket, Copy, Check, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { generateChecklistTasks, ChecklistTaskState } from '@/lib/checklist-tasks'
import { ChecklistTaskItem } from '@/components/checklist-task-item'
import { QRCodeSVG } from 'qrcode.react'
import { cn, copyToClipboard } from '@/lib/utils'

interface EventSetupChecklistProps {
  eventId: string
  eventName: string
  onDismiss: () => void
  onAllTasksComplete?: () => void
  onChecklistLoaded?: () => void
}

export function EventSetupChecklist({ eventId, eventName, onDismiss, onAllTasksComplete, onChecklistLoaded }: EventSetupChecklistProps) {
  const [tasks, setTasks] = useState<ChecklistTaskState[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCheckInQR, setShowCheckInQR] = useState(false)
  const [checkInUrl, setCheckInUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [firstWhatsAppSent, setFirstWhatsAppSent] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [manualCompletions, setManualCompletions] = useState<Record<string, boolean>>({})

  // Action handlers
  const handleCopyCheckInLink = async () => {
    try {
      const response = await apiClient.generateCheckInLink(eventId)
      const fullUrl = `${window.location.origin}${response.link}`
      await copyToClipboard(fullUrl)
      toast.success('Check-In Link kopiert', {
        description: 'Der Link wurde in die Zwischenablage kopiert.'
      })
    } catch (error) {
      console.error('Failed to copy check-in link:', error)
      toast.error('Fehler', {
        description: 'Link konnte nicht kopiert werden.'
      })
    }
  }

  const handleShowCheckInQR = async () => {
    try {
      const response = await apiClient.generateCheckInLink(eventId)
      const fullUrl = `${window.location.origin}${response.link}`
      setCheckInUrl(fullUrl)
      setShowCheckInQR(true)
    } catch (error) {
      console.error('Failed to generate QR code:', error)
      toast.error('Fehler', {
        description: 'QR-Code konnte nicht generiert werden.'
      })
    }
  }

  const handleAutoAssignDrivers = async () => {
    toast.info('Auto-Zuweisung noch nicht implementiert', {
      description: 'Diese Funktion wird in einem zukünftigen Update verfügbar sein.'
    })
  }

  const handleSendWhatsApp = useCallback(() => {
    // Mark as sent in localStorage
    const whatsappKey = `first-whatsapp-sent-${eventId}`
    localStorage.setItem(whatsappKey, 'true')
    setFirstWhatsAppSent(true)

    // Generate basic event notification message
    const message = `🚨 EREIGNIS GESTARTET\n\n` +
      `Ereignis: ${eventName}\n` +
      `Zeit: ${new Date().toLocaleString('de-CH')}\n\n` +
      `Bitte zur Einsatzzentrale begeben und einchecken.\n\n` +
      `📱 Check-In Link wird separat gesendet.`

    // Copy to clipboard
    copyToClipboard(message).then(() => {
      toast.success('WhatsApp-Nachricht kopiert', {
        description: 'Die Nachricht wurde in die Zwischenablage kopiert. Fügen Sie sie in WhatsApp ein.'
      })
    }).catch(() => {
      toast.error('Fehler beim Kopieren')
    })
  }, [eventId, eventName])

  const handleShowTileSetup = () => {
    toast.info('Tile-Setup', {
      description: 'Öffnen Sie die Hilfe-Seite für Anleitungen zur Offline-Karten-Einrichtung.',
      action: {
        label: 'Zur Hilfe',
        onClick: () => window.open('/help#offline-maps', '_blank')
      }
    })
  }

  const copyCheckInUrlToClipboard = async () => {
    if (!checkInUrl) return

    try {
      await copyToClipboard(checkInUrl)
      setCopied(true)
      toast.success('Link kopiert')
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      toast.error('Fehler beim Kopieren')
    }
  }

  // Load checklist state
  const loadChecklistState = useCallback(async () => {
    try {
      setIsLoading(true)

      // Fetch all data needed for checklist
      const [attendance, specialFunctions, vehicles, settings] = await Promise.all([
        apiClient.getEventAttendance(eventId).catch(() => []),
        apiClient.getEventSpecialFunctions(eventId).catch(() => []),
        apiClient.getVehicles().catch(() => []),
        apiClient.getAllSettings().catch(() => ({}))
      ])

      const checkedInCount = attendance.filter((a) => a.checked_in).length
      const driverCount = specialFunctions.filter((f) => f.function_type === 'driver').length
      const rekoCount = specialFunctions.filter((f) => f.function_type === 'reko').length
      const magazinCount = specialFunctions.filter((f) => f.function_type === 'magazin').length

      // Check if map tiles are available
      let mapTilesAvailable = false
      try {
        const response = await fetch('http://localhost:8080/health')
        mapTilesAvailable = response.ok
      } catch {
        mapTilesAvailable = false
      }

      // Check localStorage for first WhatsApp sent state
      const whatsappKey = `first-whatsapp-sent-${eventId}`
      const whatsappSent = localStorage.getItem(whatsappKey) === 'true'
      setFirstWhatsAppSent(whatsappSent)

      // Generate tasks
      const updatedTasks = generateChecklistTasks({
        eventId,
        checkedInPersonnel: checkedInCount,
        totalVehicles: vehicles.length,
        driverAssignments: driverCount,
        rekoOfficers: rekoCount,
        magazinStaff: magazinCount,
        mapTilesAvailable,
        firstWhatsAppSent: whatsappSent,
        onCopyCheckInLink: handleCopyCheckInLink,
        onShowCheckInQR: handleShowCheckInQR,
        onAutoAssignDrivers: handleAutoAssignDrivers,
        onSendWhatsApp: handleSendWhatsApp,
        onShowTileSetup: handleShowTileSetup
      })

      setTasks(updatedTasks)

      // Notify parent that checklist has loaded
      onChecklistLoaded?.()
    } catch (error) {
      console.error('Failed to load checklist state:', error)
      toast.error('Fehler beim Laden der Checkliste')
    } finally {
      setIsLoading(false)
    }
  }, [eventId, handleSendWhatsApp, onChecklistLoaded])

  useEffect(() => {
    loadChecklistState()

    // Refresh every 5 seconds to update completion status
    const interval = setInterval(loadChecklistState, 5000)
    return () => clearInterval(interval)
  }, [loadChecklistState])

  // Calculate progress including manual completions
  const tasksWithManualState = tasks.map(t => ({
    ...t,
    completed: t.completed || manualCompletions[t.id] || false
  }))

  const completedTasks = tasksWithManualState.filter((t) => t.completed).length
  const criticalTasks = tasksWithManualState.filter((t) => t.priority === 'critical')
  const criticalCompleted = criticalTasks.filter((t) => t.completed).length
  const allCriticalComplete = criticalCompleted === criticalTasks.length && criticalTasks.length > 0

  const progressPercent = tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0

  // Sort tasks: incomplete first, then completed
  const sortedTasks = [...tasksWithManualState].sort((a, b) => {
    if (a.completed === b.completed) return 0
    return a.completed ? 1 : -1
  })

  // Load manual completions from localStorage
  useEffect(() => {
    if (!eventId) return
    const key = `manual-completions-${eventId}`
    const stored = localStorage.getItem(key)
    if (stored) {
      setManualCompletions(JSON.parse(stored))
    }
  }, [eventId])

  // Notify parent when all tasks are complete
  useEffect(() => {
    if (tasks.length === 0) return

    const allComplete = tasksWithManualState.every(t => t.completed)
    if (allComplete && onAllTasksComplete) {
      onAllTasksComplete()
    }
  }, [tasksWithManualState, onAllTasksComplete, tasks.length])

  const toggleManualCompletion = (taskId: string) => {
    const key = `manual-completions-${eventId}`
    const newCompletions = {
      ...manualCompletions,
      [taskId]: !manualCompletions[taskId]
    }
    setManualCompletions(newCompletions)
    localStorage.setItem(key, JSON.stringify(newCompletions))
  }

  if (isLoading && tasks.length === 0) {
    return (
      <Card className="border-l-4 border-l-primary bg-primary/5">
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-muted-foreground">Checkliste wird geladen...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="w-full max-w-2xl">
      <Card className="border shadow-lg">
        <CardContent className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold">Setup-Checkliste</h3>
              {allCriticalComplete && (
                <Badge variant="default" className="bg-green-600 text-xs h-5 px-2">
                  <Rocket className="h-3.5 w-3.5 mr-1" />
                  Bereit
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {completedTasks}/{tasks.length}
              </span>
              <Progress value={progressPercent} className="h-2 w-20" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onDismiss}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Task List - Compact */}
          <div className="space-y-2">
            {sortedTasks.map((task) => {
              // Only show action button for specific tasks
              const shouldShowAction = task.id === 'send-first-whatsapp' || task.id === 'personnel-checkin'
              const firstAction = shouldShowAction ? task.actionButtons?.[0] : null
              const ActionIcon = firstAction?.icon
              const isCompleted = task.completed

              return (
                <div
                  key={task.id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                    isCompleted ? "bg-muted/30" : "bg-muted/50"
                  )}
                >
                  {/* Checkbox - clickable */}
                  <button
                    onClick={() => toggleManualCompletion(task.id)}
                    className="flex-shrink-0 hover:opacity-80 transition-opacity"
                  >
                    {isCompleted ? (
                      <div className="h-4.5 w-4.5 rounded-full bg-green-600 flex items-center justify-center">
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    ) : (
                      <div className="h-4.5 w-4.5 rounded-full border-2 border-muted-foreground/50 hover:border-muted-foreground transition-colors" />
                    )}
                  </button>

                  {/* Task title */}
                  <span className={cn(
                    "flex-1 min-w-0",
                    isCompleted && "text-muted-foreground line-through"
                  )}>
                    {task.title}
                  </span>

                  {/* Action button - only for WhatsApp and Personnel check-in */}
                  {!isCompleted && firstAction && ActionIcon && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={firstAction.onClick || undefined}
                      asChild={!!firstAction.href}
                    >
                      {firstAction.href ? (
                        <a href={firstAction.href}>
                          <ActionIcon className="h-3.5 w-3.5 mr-1.5" />
                          {firstAction.label}
                        </a>
                      ) : (
                        <>
                          <ActionIcon className="h-3.5 w-3.5 mr-1.5" />
                          {firstAction.label}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* QR Code Dialog */}
      <Dialog open={showCheckInQR} onOpenChange={setShowCheckInQR}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Personal Check-In</DialogTitle>
            <DialogDescription>QR-Code scannen oder Link teilen für mobilen Zugriff</DialogDescription>
          </DialogHeader>
          {checkInUrl && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="rounded-lg border p-4 bg-white">
                <QRCodeSVG value={checkInUrl} size={200} level="M" includeMargin />
              </div>

              <div className="w-full">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={checkInUrl}
                    readOnly
                    className="flex-1 rounded-md border px-3 py-2 text-sm bg-muted"
                  />
                  <Button variant="outline" size="icon" onClick={copyCheckInUrlToClipboard}>
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Dieser Link ermöglicht den Zugriff auf das Check-In ohne Anmeldung
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
