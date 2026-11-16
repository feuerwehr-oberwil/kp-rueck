"use client"

import { useCallback, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import { usePrintJobToast } from "@/lib/hooks/use-print-job-toast"
import type { ThermoPrintOptions } from "@/components/print/print-hub-sheet"

/**
 * The thermal board slip for one Ereignis: queues it and hands the job to the print toast.
 * One press at a time – `printing` is true while the queue request is out; `onSent` runs once
 * the job is queued (the caller closes its print sheet). Used by the board's print sheet and the
 * phone's «Mehr» → Drucken on every page.
 */
export function usePrintBoard(eventId: string | null, onSent?: () => void) {
  const tCommon = useTranslations("kanban.common")
  const tDash = useTranslations("kanban.dashboard")
  const tPrint = useTranslations("print.toasts")
  const trackPrint = usePrintJobToast()
  const [printing, setPrinting] = useState(false)
  const busy = useRef(false)

  const print = useCallback(
    async (options?: ThermoPrintOptions) => {
      if (!eventId || busy.current) return
      busy.current = true
      setPrinting(true)
      try {
        const job = await apiClient.queueBoardPrint(eventId, options ? {
          include_incidents: options.includeIncidents,
          include_completed: options.includeCompleted,
          include_vehicles: options.includeVehicles,
          include_personnel: options.includePersonnel,
        } : undefined)
        trackPrint(job.id, { sentTitle: tDash("boardPrintSent"), subject: tPrint("subjectBoard") })
        onSent?.()
      } catch {
        toast.error(tCommon("printFailed"))
      } finally {
        busy.current = false
        setPrinting(false)
      }
    },
    [eventId, onSent, tCommon, tDash, tPrint, trackPrint],
  )

  return { print, printing }
}
