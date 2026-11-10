"use client"

import { useCallback, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import { usePrintJobToast } from "@/lib/hooks/use-print-job-toast"

/**
 * «Einsatzzettel drucken» for one Einsatz: queues the thermal slip and hands the job
 * to the print toast, which then says what the printer actually did. One press at a
 * time – `printing` is true while the queue request is out. Used by the card's
 * right-click menu and by the same entry in the commands (Ctrl K).
 */
export function usePrintAssignmentSlip() {
  const t = useTranslations("kanban.common")
  const tPrint = useTranslations("print.toasts")
  const trackPrint = usePrintJobToast()
  const [printing, setPrinting] = useState(false)
  const busy = useRef(false)

  const print = useCallback(
    async (operationId: string) => {
      if (busy.current) return
      busy.current = true
      setPrinting(true)
      try {
        const job = await apiClient.queueAssignmentPrint(operationId)
        trackPrint(job.id, { sentTitle: t("printJobSent"), subject: tPrint("subjectSlip") })
      } catch (error) {
        console.error("Print failed:", error)
        toast.error(t("printFailed"))
      } finally {
        busy.current = false
        setPrinting(false)
      }
    },
    [t, tPrint, trackPrint],
  )

  return { print, printing }
}
