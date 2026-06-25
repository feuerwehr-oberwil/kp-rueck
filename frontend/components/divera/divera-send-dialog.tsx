"use client"

import { useEffect, useMemo, useState } from "react"
import { Siren, Loader2, Link2Off } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { formatDiveraMessage, formatDiveraTitle } from "@/lib/divera-formatter"
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
  const { personnel } = usePersonnel()

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
    // Prefill title/text from the editable templates (fetched async).
    let cancelled = false
    getMessageTemplates().then(({ diveraTitle, diveraText }) => {
      if (cancelled) return
      setTitle(formatDiveraTitle(operation, diveraTitle).slice(0, 50))
      setText(formatDiveraMessage({ operation, materials, template: diveraText }))
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
      toast.error("Keine mit Divera verknüpften Empfänger ausgewählt")
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
        const skippedNote = result.skipped.length > 0 ? `, ${result.skipped.length} übersprungen` : ""
        toast.success(`Divera-Alarm gesendet an ${result.sent.length} Person(en)${skippedNote}`)
        onOpenChange(false)
      } else {
        toast.error(result.error || "Divera-Alarm konnte nicht gesendet werden")
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
            <Siren className="h-4 w-4 text-primary" />
            Divera-Alarm senden
          </DialogTitle>
          <DialogDescription>
            {operation.location} — nur ausgewählte, mit Divera verknüpfte Personen werden alarmiert.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Recipients */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Empfänger ({selectedLinkedCount})
            </Label>
            {recipients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Diesem Einsatz ist keine Person zugewiesen.
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
                          Fahrer
                        </Badge>
                      )}
                      {linked ? (
                        <Badge variant="secondary" className="text-[10px]">
                          verknüpft
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                          <Link2Off className="h-3 w-3" />
                          nicht verknüpft
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
            <Label htmlFor="divera-title" className="text-xs uppercase tracking-wide text-muted-foreground">
              Titel
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
              <Label htmlFor="divera-text" className="text-xs uppercase tracking-wide text-muted-foreground">
                Text
              </Label>
              <span className={`text-[11px] ${text.length > 1000 ? "text-destructive" : "text-muted-foreground"}`}>
                {text.length}/1000{text.length > 1000 ? " · wird gekürzt" : ""}
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
              Priorität (Sonderrechte)
            </Label>
            <Switch id="divera-priority" checked={priority} onCheckedChange={setPriority} />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSending}>
              Abbrechen
            </Button>
            <Button onClick={handleSend} disabled={isSending || selectedLinkedCount === 0}>
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Siren className="h-4 w-4" />
              )}
              Alarm senden ({selectedLinkedCount})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
