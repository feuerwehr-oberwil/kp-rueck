"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"

import { apiClient } from "@/lib/api-client"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { copyToClipboard } from "@/lib/utils"

export type RekoLinkCopied = "direct" | "dashboard" | null

interface UseRekoLinkActionsParams {
  /** The incident the modal is bound to. */
  incidentId: string | null
  /** The currently-assigned Reko personnel; required for the direct link. */
  assignedReko: { id: string; name: string } | null
  /** Event ID used by the shareable dashboard link. */
  eventId: string | null
}

export interface RekoLinkActions {
  /** Currently-copied link type (clears after 2s). */
  copied: RekoLinkCopied
  /** True while either copy call is in flight. */
  isCopying: boolean
  /**
   * Generate + copy the per-person Reko form link. Requires `assignedReko`
   * and `incidentId` — toasts an error otherwise so the operator sees why.
   */
  copyDirectLink: () => Promise<void>
  /**
   * Generate + copy the event-wide Reko dashboard link. Requires `eventId`.
   */
  copyDashboardLink: () => Promise<void>
}

/**
 * Encapsulates the two clipboard-copy flows that live in the operation
 * detail modal: per-person Reko form link, and event Reko dashboard link.
 * Extracted so the modal doesn't have to inline three useState + two
 * async handlers; also unit-testable in isolation.
 */
export function useRekoLinkActions({
  incidentId,
  assignedReko,
  eventId,
}: UseRekoLinkActionsParams): RekoLinkActions {
  const [copied, setCopied] = useState<RekoLinkCopied>(null)
  const [isCopying, setIsCopying] = useState(false)

  const flashCopied = useCallback((kind: Exclude<RekoLinkCopied, null>) => {
    setCopied(kind)
    setTimeout(() => setCopied(null), 2000)
  }, [])

  const copyDirectLink = useCallback(async () => {
    if (!incidentId || !assignedReko) {
      toast.error(translateOutsideReact('notifications.rekoLinks.noRekoAssigned'))
      return
    }
    setIsCopying(true)
    try {
      const response = await apiClient.generateRekoLink(incidentId, assignedReko.id)
      const fullUrl = `${window.location.origin}${response.link}`
      await copyToClipboard(fullUrl)
      flashCopied("direct")
      toast.success(translateOutsideReact('notifications.rekoLinks.directCopiedTitle'), {
        description: translateOutsideReact('notifications.rekoLinks.directCopiedDescription', { name: assignedReko.name }),
      })
    } catch (error) {
      console.error("Failed to copy direct reko link:", error)
      toast.error(translateOutsideReact('notifications.rekoLinks.copyFailed'))
    } finally {
      setIsCopying(false)
    }
  }, [incidentId, assignedReko, flashCopied])

  const copyDashboardLink = useCallback(async () => {
    if (!eventId) {
      toast.error(translateOutsideReact('notifications.rekoLinks.noEventSelected'))
      return
    }
    setIsCopying(true)
    try {
      const response = await apiClient.generateRekoDashboardLink(eventId)
      const fullUrl = `${window.location.origin}${response.link}`
      await copyToClipboard(fullUrl)
      flashCopied("dashboard")
      toast.success(translateOutsideReact('notifications.rekoLinks.dashboardCopiedTitle'), {
        description: translateOutsideReact('notifications.rekoLinks.dashboardCopiedDescription'),
      })
    } catch (error) {
      console.error("Failed to copy dashboard link:", error)
      toast.error(translateOutsideReact('notifications.rekoLinks.copyFailed'))
    } finally {
      setIsCopying(false)
    }
  }, [eventId, flashCopied])

  return { copied, isCopying, copyDirectLink, copyDashboardLink }
}
