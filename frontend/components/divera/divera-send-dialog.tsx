"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Siren, Loader2, Link2Off } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { type Operation, type Material } from "@/lib/contexts/operations-context"
import { usePersonnel, type Person } from "@/lib/contexts/personnel-context"
import { useEvent } from "@/lib/contexts/event-context"
import { formatAlarmMessage, formatAlarmTitle } from "@/lib/divera-formatter"
import { formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { getMessageTemplates } from "@/lib/message-template"
import { apiClient } from "@/lib/api-client"
import { toast } from "sonner"

interface DiveraSendDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  operation: Operation | null
  materials: Material[]
}

interface Recipient {
  person: Person
  isDriverRow: boolean
}

export function DiveraSendDialog({ open, onOpenChange, operation, materials }: DiveraSendDialogProps) {
  const t = useTranslations("divera.sendDialog")
  const { personnel } = usePersonnel()
  const { selectedEvent } = useEvent()

  // Recipients = the incident's assigned crew (pre-selected) plus the drivers of
  // its assigned vehicles (listed, but NOT pre-selected).
  const recipients = useMemo<Recipient[]>(() => {
    if (!operation) return []
    const crew = operation.crew
      .map((name) => personnel.find((p) => p.name === name))
      .filter((p): p is Person => Boolean(p))
    const crewIds = new Set(crew.map((p) => p.id))
    const vehicleSet = new Set(operation.vehicles)
    const drivers = personnel.filter(
      (p) =>
        p.isDriver &&
        p.driverVehicleName &&
        vehicleSet.has(p.driverVehicleName) &&
        !crewIds.has(p.id),
    )
    return [
      ...crew.map((person) => ({ person, isDriverRow: false })),
      ...drivers.map((person) => ({ person, isDriverRow: true })),
    ]
  }, [operation, personnel])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [priority, setPriority] = useState(false)
  const [isSending, setIsSending] = useState(false)
  // True once the async template fetch has populated title/text. Guards against
  // sending while the editable fields are still empty (the fetch hadn't resolved).
  const [templatesReady, setTemplatesReady] = useState(false)

  // Re-prefill every time the dialog opens, so it reflects the current
  // assignments (changing the crew while closed and reopening shows the new set).
  // Pre-select all linked crew; leave drivers unticked.
  useEffect(() => {
    if (!open || !operation) return
    setSelected(
      new Set(
        recipients
          .filter((r) => !r.isDriverRow && r.person.diveraUserId)
          .map((r) => r.person.id),
      ),
    )
    setPriority(false)
    setTemplatesReady(false)
    // Prefill title/text from the editable templates (fetched async). Until this
    // resolves, the fields stay empty and the send button is disabled, so we can
    // never POST a blank message just because the fetch hadn't finished.
    let cancelled = false
    getMessageTemplates().then(({ alarmTitle, alarmText }) => {
      if (cancelled) return
      const isTraining = selectedEvent?.training_flag ?? false
      const baseTitle = formatAlarmTitle(operation, alarmTitle)
      const body = formatAlarmMessage({ operation, materials, template: alarmText })
      // In a training event no real alarm is sent (the backend simulates it). Make
      // that unmistakable in the message itself so nobody mistakes it for a callout.
      setTitle((isTraining ? `ÜBUNG: ${baseTitle}` : baseTitle).slice(0, 50))
      setText(isTraining ? `🔶 ÜBUNG – PROBEALARM, es wird NICHT real alarmiert.\n\n${body}` : body)
      setTemplatesReady(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, operation?.id])

  if (!operation) return null

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedLinkedCount = recipients.filter(
    (r) => selected.has(r.person.id) && r.person.diveraUserId,
  ).length

  const handleSend = async () => {
    const personnelIds = recipients
      .filter((r) => selected.has(r.person.id) && r.person.diveraUserId)
      .map((r) => r.person.id)
    if (personnelIds.length === 0) {
      toast.error(t("noRecipientsError"))
      return
    }
    setIsSending(true)
    try {
      const result = await apiClient.sendIncidentDiveraAlarm(operation.id, {
        personnel_ids: personnelIds,
        title,
        text,
        priority,
        send_push: true, // push only — no SMS/call/mail
      })
      if (result.success) {
        if (result.simulated) {
          toast.success(t("simulatedTitle"), {
            description: t("simulatedDescription"),
          })
        } else {
          toast.success(
            result.skipped.length > 0
              ? t("sentWithSkipped", { count: result.sent.length, skipped: result.skipped.length })
              : t("sent", { count: result.sent.length }),
          )
        }
        onOpenChange(false)
      } else {
        toast.error(result.error || t("sendError"))
      }
    } catch {
      // request() already surfaces a toast for gating/network errors.
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Siren className="h-5 w-5 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("description", { location: (operation.locationDisplay ?? formatLocationForDisplay(operation.location, getGlobalHomeCity())) || getIncidentTypeLabel(operation.incidentType) })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipients */}
          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground">
              {t("recipients", { count: selectedLinkedCount })}
            </Label>
            {recipients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("noAssigned")}
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {recipients.map((r) => {
                  const linked = Boolean(r.person.diveraUserId)
                  return (
                    <label
                      key={r.person.id}
                      className={`flex items-center gap-2.5 px-3 py-2 text-sm ${
                        linked ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                      }`}
                    >
                      <Checkbox
                        checked={selected.has(r.person.id)}
                        onCheckedChange={() => linked && toggle(r.person.id)}
                        disabled={!linked}
                      />
                      <span className="flex-1 truncate">{r.person.name}</span>
                      {r.isDriverRow && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {t("driverBadge")}
                        </Badge>
                      )}
                      {linked ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("linked")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                          <Link2Off className="h-3 w-3" />
                          {t("notLinked")}
                        </Badge>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label htmlFor="divera-title" className="text-xs tracking-wide text-muted-foreground">
              {t("titleLabel")}
            </Label>
            <Input
              id="divera-title"
              value={title}
              maxLength={50}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="divera-text" className="text-xs tracking-wide text-muted-foreground">
                {t("textLabel")}
              </Label>
              <span className={`text-[11px] ${text.length > 1000 ? "text-destructive" : "text-muted-foreground"}`}>
                {text.length > 1000 ? t("charCountTruncated", { count: text.length }) : t("charCount", { count: text.length })}
              </span>
            </div>
            <Textarea
              id="divera-text"
              value={text}
              rows={8}
              className="text-xs"
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          {/* Priority */}
          <div className="flex items-center justify-between">
            <Label htmlFor="divera-priority" className="text-sm">
              {t("priorityLabel")}
            </Label>
            <Switch id="divera-priority" checked={priority} onCheckedChange={setPriority} />
          </div>

          {/* Actions */}
          <DialogFooter className="pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSend} disabled={isSending || selectedLinkedCount === 0 || !templatesReady}>
              {isSending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Siren className="mr-2 h-4 w-4" />
              )}
              {t("send", { count: selectedLinkedCount })}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
