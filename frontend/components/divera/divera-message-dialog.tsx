"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MessageCircle, Loader2, AlertTriangle, Users, Megaphone, Check } from "lucide-react"
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
import { apiClient } from "@/lib/api-client"
import type { ApiDiveraGroup } from "@/lib/api/types"
import { useDeploymentBlock } from "@/lib/hooks/use-deployment"
import { cn } from "@/lib/utils"
import { useEvent } from "@/lib/contexts/event-context"
import { toast } from "sonner"

interface DiveraMessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Prefilled body — the same template the WhatsApp button copies. */
  defaultText: string
  /** Prefilled subject; Divera caps this at 50 characters. */
  defaultTitle?: string
}

/**
 * Confirmation sheet for a Divera *Mitteilung* — the quiet sibling of an alarm.
 *
 * Nothing is sent until this dialog is confirmed, and the recipients start as
 * "no groups selected" rather than "everybody": the whole point of the sheet is
 * that a message meant for Pikett cannot become a push to the entire Feuerwehr
 * by way of a default. «Alle» stays available, one deliberate radio click away,
 * with a warning next to it.
 */
export function DiveraMessageDialog({
  open,
  onOpenChange,
  defaultText,
  defaultTitle,
}: DiveraMessageDialogProps) {
  const t = useTranslations("divera.messageDialog")
  const tBlocked = useTranslations("common.deploymentBlocked")
  const { selectedEvent } = useEvent()
  const alerting = useDeploymentBlock("alerting")
  const blockedReason = alerting.blocked ? tBlocked("alerting", { label: alerting.label ?? "" }) : null

  const [groups, setGroups] = useState<ApiDiveraGroup[]>([])
  const [groupsError, setGroupsError] = useState(false)
  const [isLoadingGroups, setIsLoadingGroups] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set())
  const [target, setTarget] = useState<"groups" | "all">("groups")
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [isSending, setIsSending] = useState(false)

  // Re-prefill on every open, so an edited template (or a changed event) is
  // picked up instead of a stale first render being sent.
  useEffect(() => {
    if (!open) return
    const isTraining = selectedEvent?.training_flag ?? false
    setTitle((isTraining ? `ÜBUNG: ${defaultTitle || "KP-Rück"}` : defaultTitle || "KP-Rück").slice(0, 50))
    setText(isTraining ? `🔶 ÜBUNG – dies ist eine Übung.\n\n${defaultText}` : defaultText)
    setTarget("groups")
    setSelectedGroups(new Set())

    let cancelled = false
    setIsLoadingGroups(true)
    setGroupsError(false)
    apiClient
      .getDiveraGroups()
      .then((list) => {
        if (!cancelled) setGroups(list)
      })
      .catch(() => {
        if (!cancelled) setGroupsError(true)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingGroups(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultText, defaultTitle])

  const toggleGroup = (id: number) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const recipientsChosen = target === "all" || selectedGroups.size > 0

  const handleSend = async () => {
    if (!recipientsChosen) {
      toast.error(t("noRecipientsError"))
      return
    }
    setIsSending(true)
    try {
      const result = await apiClient.sendDiveraMessage({
        text,
        title,
        target,
        group_ids: target === "groups" ? [...selectedGroups] : [],
        event_id: selectedEvent?.id,
      })
      if (result.simulated) {
        toast.success(t("simulatedTitle"), { description: t("simulatedDescription") })
      } else if (result.target === "all") {
        toast.success(t("sentToAll"))
      } else {
        toast.success(t("sentToGroups", { groups: result.group_names.join(", ") }))
      }
      onOpenChange(false)
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
            <MessageCircle className="h-5 w-5 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {blockedReason && (
            <p
              role="note"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm leading-relaxed"
            >
              {blockedReason}
            </p>
          )}

          {/* Recipients — groups first, «alle» as the deliberate exception */}
          <div className="space-y-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground">{t("recipients")}</Label>
            <div className="rounded-lg border border-border divide-y divide-border">
              <button
                type="button"
                onClick={() => setTarget("groups")}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  target === "groups" ? "bg-primary/10 text-primary" : "hover:bg-muted",
                )}
              >
                <Users className="size-4 shrink-0" />
                <span className="flex-1">{t("targetGroups")}</span>
                {target === "groups" && <Check className="size-4 shrink-0" />}
              </button>

              {target === "groups" && (
                <div className="max-h-48 overflow-y-auto">
                  {isLoadingGroups ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">{t("loadingGroups")}</p>
                  ) : groupsError ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">{t("groupsError")}</p>
                  ) : groups.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">{t("noGroups")}</p>
                  ) : (
                    groups.map((group) => (
                      <label
                        key={group.divera_id}
                        className="flex cursor-pointer items-center gap-2.5 py-1.5 pl-8 pr-3 text-sm"
                      >
                        <Checkbox
                          checked={selectedGroups.has(group.divera_id)}
                          onCheckedChange={() => toggleGroup(group.divera_id)}
                        />
                        <span className="flex-1 truncate">{group.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={() => setTarget("all")}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                  target === "all" ? "bg-primary/10 text-primary" : "hover:bg-muted",
                )}
              >
                <Megaphone className="size-4 shrink-0" />
                <span className="flex-1">{t("targetAll")}</span>
                {target === "all" && <Check className="size-4 shrink-0" />}
              </button>
              {target === "all" && (
                <p className="flex items-start gap-2 px-3 py-2 text-xs text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {t("allWarning")}
                </p>
              )}
            </div>
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label htmlFor="divera-message-title" className="text-sm font-semibold text-muted-foreground">
              {t("titleLabel")}
            </Label>
            <Input
              id="divera-message-title"
              value={title}
              maxLength={50}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="divera-message-text" className="text-sm font-semibold text-muted-foreground">
              {t("textLabel")}
            </Label>
            <Textarea
              id="divera-message-text"
              value={text}
              rows={7}
              className="text-xs"
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <DialogFooter className="pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSending}>
              {t("cancel")}
            </Button>
            <Button
              onClick={handleSend}
              title={blockedReason ?? undefined}
              disabled={Boolean(blockedReason) || isSending || !recipientsChosen || !text.trim()}
            >
              {isSending ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
              {target === "all" ? t("sendAll") : t("send", { count: selectedGroups.size })}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
