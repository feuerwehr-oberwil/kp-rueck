/**
 * Thermal printer jobs.
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { request as httpRequest } from '../http'
import type { ApiPrinterStatus, ApiQRCodePrintRequest, ApiPrintJob } from '../types'

export class PrintApi {
  // Print Jobs (Thermal Printer)
  async getPrinterStatus(): Promise<ApiPrinterStatus> {
    return httpRequest<ApiPrinterStatus>('/api/print/status/')
  }

  async queueAssignmentPrint(incidentId: string): Promise<ApiPrintJob> {
    return httpRequest<ApiPrintJob>(`/api/print/assignment/${incidentId}/`, {
      method: 'POST',
    })
  }

  async queueBoardPrint(eventId: string, options?: {
    include_incidents?: boolean
    include_completed?: boolean
    include_vehicles?: boolean
    include_personnel?: boolean
  }): Promise<ApiPrintJob> {
    return httpRequest<ApiPrintJob>('/api/print/board/', {
      method: 'POST',
      body: JSON.stringify({ event_id: eventId, ...options }),
    })
  }

  /**
   * The Abholliste (decision 25): the material half of the Restliste on paper.
   *
   * The existing print-job path on purpose – it is a driving list, not a fourth
   * document format.
   */
  async queueAbhollistePrint(eventId: string): Promise<ApiPrintJob> {
    return httpRequest<ApiPrintJob>(`/api/print/abholliste/${eventId}/`, { method: 'POST' })
  }

  async queueTestPrint(): Promise<ApiPrintJob> {
    return httpRequest<ApiPrintJob>('/api/print/test/', {
      method: 'POST',
    })
  }

  async queueQRCodePrint(payload: ApiQRCodePrintRequest): Promise<ApiPrintJob> {
    return httpRequest<ApiPrintJob>('/api/print/qr-code/', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  async getPrintJob(jobId: string): Promise<ApiPrintJob> {
    return httpRequest<ApiPrintJob>(`/api/print/jobs/${jobId}/`)
  }

  async getPendingPrintJobs(): Promise<ApiPrintJob[]> {
    return httpRequest<ApiPrintJob[]>('/api/print/jobs/pending/')
  }

  async deletePrintJob(jobId: string): Promise<void> {
    return httpRequest<void>(`/api/print/jobs/${jobId}/`, {
      method: 'DELETE',
    })
  }
}
