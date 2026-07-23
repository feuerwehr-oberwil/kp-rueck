"use client"

import { useCallback, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, User, Loader2, Binoculars, ArrowLeft } from "lucide-react"
import { apiClient, type ApiAvailableRekoPersonnel } from "@/lib/api-client"
import { useEvent } from "@/lib/contexts/event-context"
import { useOperations } from "@/lib/contexts/operations-context"
import type { Person } from "@/lib/contexts/personnel-context"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useTranslations } from "next-intl"

interface MarkExistingRekoPersonnelProps {
  personnel: Person[]
  onSelect: (person: Person) => Promise<void>
  excludedPersonnelIds?: ReadonlySet<string>
}

export function MarkExistingRekoPersonnel({
  personnel,
  onSelect,
  excludedPersonnelIds,
}: MarkExistingRekoPersonnelProps) {
  const t = useTranslations('incidents.assignReko')
  const [search, setSearch] = useState("")
  const [marking, setMarking] = useState<string | null>(null)
  const candidates = personnel
    .filter((person) => !person.isReko)
    .filter((person) => !excludedPersonnelIds?.has(person.id))
    .filter((person) => !search.trim() || person.name.toLowerCase().includes(search.trim().toLowerCase()))

  const handleSelect = async (person: Person) => {
    setMarking(person.id)
    try {
      await onSelect(person)
    } finally {
      setMarking(null)
    }
  }

  return (
    <div className="flex flex-col h-[300px]">
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('markSearchPlaceholder')}
          className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      {candidates.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {search.trim()
            ? t('markNoMatch')
            : personnel.length === 0
              ? t('markNoCheckedIn')
              : t('markAllReko')}
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0 pr-4">
          <div className="space-y-2">
            {candidates.map((person) => (
              <button
                key={person.id}
                onClick={() => handleSelect(person)}
                disabled={marking !== null}
                className={cn(
                  "w-full flex items-center justify-between p-3 rounded-lg border border-border/50 transition-all text-left hover:border-primary/50 hover:bg-secondary/30",
                  marking === person.id && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{person.name}</p>
                    {person.role && (
                      <p className="text-xs text-muted-foreground">{person.role}</p>
                    )}
                  </div>
                </div>
                {marking === person.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Binoculars className="h-4 w-4 text-muted-foreground" />}
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

interface AssignRekoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  incidentId: string
  incidentTitle: string
  onAssigned?: () => void
}

export function AssignRekoDialog({
  open,
  onOpenChange,
  incidentId,
  incidentTitle,
  onAssigned,
}: AssignRekoDialogProps) {
  const t = useTranslations('incidents.assignReko')
  const tCommon = useTranslations('incidents.common')
  const { selectedEvent } = useEvent()
  const { personnel: allPersonnel, refreshOperations } = useOperations()
  const [personnel, setPersonnel] = useState<ApiAvailableRekoPersonnel[]>([])
  const [currentlyAssignedId, setCurrentlyAssignedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [markMode, setMarkMode] = useState(false)
  const [uncertainPersonnelIds, setUncertainPersonnelIds] = useState<ReadonlySet<string>>(new Set())

  const loadAvailablePersonnel = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiClient.getAvailableRekoPersonnel(incidentId)
      setPersonnel(response.personnel)
      setCurrentlyAssignedId(response.currently_assigned_id)
    } catch (err) {
      console.error('Failed to load Reko personnel:', err)
      setError(t('loadError'))
    } finally {
      setLoading(false)
    }
  }, [incidentId, t])

  // Load available Reko personnel when dialog opens
  useEffect(() => {
    if (open) {
      loadAvailablePersonnel()
      setMarkMode(false)
    }
  }, [open, loadAvailablePersonnel])

  const handleMarkAndAssign = async (person: Person) => {
    if (!selectedEvent) return
    let roleAssigned = false
    try {
      await apiClient.assignSpecialFunction(selectedEvent.id, {
        personnel_id: person.id,
        function_type: 'reko',
        vehicle_id: null,
      })
      roleAssigned = true
      await apiClient.assignRekoPersonnel(incidentId, person.id)
      onAssigned?.()
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to mark/assign Reko personnel:', err)
      if (roleAssigned) {
        try {
          await apiClient.unassignSpecialFunction(selectedEvent.id, {
            personnel_id: person.id,
            function_type: 'reko',
            vehicle_id: null,
          })
        } catch (rollbackError) {
          console.error('Failed to roll back Reko role assignment:', rollbackError)
          setUncertainPersonnelIds((current) => new Set(current).add(person.id))
          try {
            await refreshOperations()
          } catch (refreshError) {
            console.error('Failed to refresh Reko assignments:', refreshError)
          }
        }
      }
      toast.error(t('assignErrorTitle'), { description: t('markError') })
    }
  }

  const handleAssign = async (person: ApiAvailableRekoPersonnel) => {
    setAssigning(person.personnel_id)
    try {
      await apiClient.assignRekoPersonnel(incidentId, person.personnel_id)
      onAssigned?.()
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to assign Reko personnel:', err)
      toast.error(t('assignErrorTitle'), { description: t('assignErrorDescription') })
    } finally {
      setAssigning(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription className="truncate">
            {t('incidentLabel', { title: incidentTitle })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Fixed height container to prevent layout shifts */}
          <div className="min-h-[300px]">
            {markMode ? (
                <MarkExistingRekoPersonnel
                  personnel={allPersonnel}
                  onSelect={handleMarkAndAssign}
                  excludedPersonnelIds={uncertainPersonnelIds}
                />
            ) : loading ? (
              <div className="flex items-center justify-center h-[300px]">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">{t('loading')}</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-[300px]">
                <p className="text-destructive">{error}</p>
                <Button variant="outline" onClick={loadAvailablePersonnel} className="mt-4">
                  {t('retry')}
                </Button>
              </div>
            ) : personnel.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[300px]">
                <User className="h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-sm font-medium text-foreground mb-3">
                  {t('emptyTitle')}
                </p>
                <Button onClick={() => setMarkMode(true)} className="mb-3">
                  <Binoculars className="h-4 w-4" />
                  {t('markExisting')}
                </Button>
                <p className="text-xs text-muted-foreground text-center max-w-xs">
                  {t('emptyHint')}
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-2">
                  {personnel.map((person) => {
                  const isCurrentlyAssigned = person.personnel_id === currentlyAssignedId
                  return (
                    <button
                      key={person.personnel_id}
                      onClick={() => handleAssign(person)}
                      disabled={assigning !== null || isCurrentlyAssigned}
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left",
                        isCurrentlyAssigned
                          ? "border-success bg-success/10 cursor-default"
                          : "border-border/50 hover:border-primary/50 hover:bg-secondary/30",
                        assigning === person.personnel_id && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <User className={cn(
                          "h-5 w-5 flex-shrink-0",
                          isCurrentlyAssigned ? "text-success" :
                          person.assignment_count > 0 ? "text-orange-500" : "text-muted-foreground"
                        )} />
                        <div>
                          <p className="font-medium text-sm">{person.name}</p>
                          {person.role && (
                            <p className="text-xs text-muted-foreground">{person.role}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isCurrentlyAssigned ? (
                          <Badge variant="default" className="text-xs bg-success">
                            {t('assigned')}
                          </Badge>
                        ) : person.assignment_count > 0 ? (
                          <Badge variant="outline" className="text-xs">
                            {t('assignmentCount', { count: person.assignment_count })}
                          </Badge>
                        ) : null}
                        {assigning === person.personnel_id && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
              </ScrollArea>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between pt-2">
            {markMode ? (
              <Button variant="ghost" onClick={() => setMarkMode(false)}>
                <ArrowLeft className="h-4 w-4" />
                {t('back')}
              </Button>
            ) : <span />}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
