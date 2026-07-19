"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"

import {
  apiClient,
  type ApiRekoReportResponse,
} from "@/lib/api-client"
import type { Material, Operation } from "@/lib/contexts/operations-context"
import { translateOutsideReact } from "@/lib/i18n-messages"
import { copyToClipboardAsync } from "@/lib/utils"
import { formatWhatsAppMessage } from "@/lib/whatsapp-formatter"
import { getMessageTemplates } from "@/lib/message-template"

interface UseWhatsAppCopyParams {
  operation: Operation | null
  materials: Material[]
  vehicleDrivers: Map<string, string>
}

export interface WhatsAppCopy {
  isCopying: boolean
  /**
   * Fire-and-track the clipboard copy. Must be called synchronously from a
   * user gesture so Safari's "permission reserved" model lets the Promise
   * resolve into clipboard.write — the underlying util takes care of that.
   */
  copy: () => void
}

/**
 * Builds the WhatsApp-formatted dispatch message for the given operation
 * (fetching its latest non-draft Reko report along the way) and copies it
 * to the clipboard with the right toast feedback. Shared between the
 * sidepanel detail view and the operation detail modal.
 */
export function useWhatsAppCopy({
  operation,
  materials,
  vehicleDrivers,
}: UseWhatsAppCopyParams): WhatsAppCopy {
  const [isCopying, setIsCopying] = useState(false)

  const copy = useCallback(() => {
    if (!operation) return

    setIsCopying(true)

    const messagePromise = (async () => {
      let rekoReport: ApiRekoReportResponse | null = null
      if (operation.hasCompletedReko) {
        try {
          const reports = await apiClient.getIncidentRekoReports(operation.id)
          const completedReports = reports.filter((r) => !r.is_draft)
          if (completedReports.length > 0) {
            rekoReport = completedReports[completedReports.length - 1]
          }
        } catch (error) {
          console.error("Failed to fetch Reko report:", error)
        }
      }

      const { whatsappIncident } = await getMessageTemplates()
      return formatWhatsAppMessage({
        operation,
        materials,
        rekoReport,
        vehicleDrivers,
        template: whatsappIncident,
      })
    })()

    copyToClipboardAsync(messagePromise)
      .then(() => {
        toast.success(translateOutsideReact('notifications.whatsapp.copiedTitle'), {
          description: translateOutsideReact('notifications.whatsapp.copiedDescription'),
        })
      })
      .catch((error) => {
        console.error("Failed to copy WhatsApp message:", error)
        toast.error(translateOutsideReact('notifications.whatsapp.copyFailedTitle'), {
          description: translateOutsideReact('notifications.whatsapp.copyFailedDescription'),
        })
      })
      .finally(() => {
        setIsCopying(false)
      })
  }, [operation, materials, vehicleDrivers])

  return { isCopying, copy }
}
