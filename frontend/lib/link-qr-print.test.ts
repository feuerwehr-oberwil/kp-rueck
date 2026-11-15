import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getFeldAccess, queueQRCodePrint } = vi.hoisted(() => ({
  getFeldAccess: vi.fn(),
  queueQRCodePrint: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({ apiClient: { getFeldAccess, queueQRCodePrint } }))

import { queueLinkQrPrint } from './link-qr-print'

const slip = {
  url: 'https://kp.example/feld?token=t',
  title: 'Feld – Mannschaft',
  subtitle: 'Für alle im Einsatz',
  validUntil: '2026-11-16T06:00:00Z',
}

describe('queueLinkQrPrint', () => {
  beforeEach(() => {
    getFeldAccess.mockReset().mockResolvedValue({ code: '4711', device_count: 0 })
    queueQRCodePrint.mockReset().mockResolvedValue({ id: 'job' })
  })

  it('puts the current Feld-Code and the expiry on the Feld slip, and neither on the others', async () => {
    await queueLinkQrPrint('feld', 'ev1', slip)
    await queueLinkQrPrint('checkin', 'ev1', slip)

    expect(queueQRCodePrint.mock.calls).toEqual([
      [{ qr_content: slip.url, title: slip.title, subtitle: slip.subtitle, event_id: 'ev1', code: '4711', valid_until: slip.validUntil }],
      [{ qr_content: slip.url, title: slip.title, subtitle: slip.subtitle, event_id: 'ev1' }],
    ])
  })
})
