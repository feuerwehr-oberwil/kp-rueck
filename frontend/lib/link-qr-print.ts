import { apiClient } from '@/lib/api-client'
import type { ApiPrintJob } from '@/lib/api-client'

/** The links the board hands out as a printed QR slip. */
export type LinkKind = 'checkin' | 'feld' | 'alarm' | 'display'

interface LinkSlip {
  /** The full URL the QR opens. */
  url: string
  title: string
  subtitle: string
  /** The link's own expiry (ISO), as the mint returned it. Printed on the Feld slip. */
  validUntil?: string | null
}

/**
 * Queues the thermal QR slip for one of the board's links. Every «QR drucken» goes through
 * here (the setup checklist and the «Links & QR» sheet), so the Feld slip always carries the
 * Feld-Code and the expiry: the scanned page asks for the four digits next, and the code
 * screen deliberately gives no hint where they live – the answer is «on this slip». The code
 * is read fresh at print time, so a slip printed after a rotation shows the current one; if
 * it cannot be read, nothing is printed rather than a slip that strands whoever scans it.
 */
export async function queueLinkQrPrint(
  kind: LinkKind,
  eventId: string,
  slip: LinkSlip,
): Promise<ApiPrintJob> {
  const feld =
    kind === 'feld'
      ? {
          code: (await apiClient.getFeldAccess(eventId)).code,
          valid_until: slip.validUntil ?? undefined,
        }
      : {}
  return apiClient.queueQRCodePrint({
    qr_content: slip.url,
    title: slip.title,
    subtitle: slip.subtitle,
    event_id: eventId,
    ...feld,
  })
}
