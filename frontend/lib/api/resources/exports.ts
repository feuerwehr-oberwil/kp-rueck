/**
 * Excel import/export and the per-event downloads (audit, report, Einsätze, Lageblatt).
 *
 * One slice of `apiClient` (`lib/api-client.ts` mixes every resource class into
 * the one client object). Methods go through the shared transport in `../http`.
 */

import { getApiUrl } from '../../env'
import type { ApiExcelImportPreview, ApiExcelImportResult, ExcelImportMode } from '../types'

export class ExportsApi {
  // Excel Import/Export
  async downloadImportTemplate(): Promise<Blob> {
    const url = `${getApiUrl()}/api/admin/import/template`
    const response = await fetch(url, {
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Failed to download template: ${response.statusText}`)
    }

    return response.blob()
  }

  /** The mode is not cosmetic here: the preview reports what the chosen mode would
   *  DELETE, so previewing 'replace' and importing 'append' (or the reverse) shows the
   *  operator the wrong number. Pass the mode the UI has selected. */
  async previewExcelImport(file: File, mode: ExcelImportMode = 'replace'): Promise<ApiExcelImportPreview> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)

    const url = `${getApiUrl()}/api/admin/import/preview`
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Preview failed: ${errorText}`)
    }

    return response.json()
  }

  /** `mode` is required on the wire – the backend refuses a request without it rather
   *  than defaulting to the destructive one. The default here only keeps the call sites
   *  compiling; it is always sent. */
  async executeExcelImport(file: File, mode: ExcelImportMode = 'replace'): Promise<ApiExcelImportResult> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)

    const url = `${getApiUrl()}/api/admin/import/execute`
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Import failed: ${errorText}`)
    }

    return response.json()
  }

  async exportAllData(): Promise<Blob> {
    const url = `${getApiUrl()}/api/admin/export/data`
    const response = await fetch(url, {
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Event Audit Export (for payment processing)
  async exportEventAudit(eventId: string): Promise<Blob> {
    const url = `${getApiUrl()}/api/exports/events/${eventId}/audit`
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Audit export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Event After-Action Report (PDF)
  async exportEventReport(eventId: string): Promise<Blob> {
    const url = `${getApiUrl()}/api/exports/events/${eventId}/report`
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Report export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Einsätze – one wide row per Schadenplatz (XLSX, plan 25 §7). Somebody
  // still retypes it into the billing system by hand; it just does not need
  // that name on it.
  async exportEventEinsaetze(eventId: string): Promise<Blob> {
    const url = `${getApiUrl()}/api/exports/events/${eventId}/einsaetze.xlsx`
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Einsaetze export failed: ${response.statusText}`)
    }

    return response.blob()
  }

  // Lageblatt – paper-fallback board snapshot (PDF, Führungsformular layout)
  async exportEventLageblatt(eventId: string): Promise<Blob> {
    const url = `${getApiUrl()}/api/exports/events/${eventId}/lageblatt`
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Lageblatt export failed: ${response.statusText}`)
    }

    return response.blob()
  }
}
