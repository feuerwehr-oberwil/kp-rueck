import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithIntl } from '@/test-utils/render-with-intl'

/** Each generate call hands out the next link of its kind: `/check-in?token=checkin-1`, `-2`, … */
const minted = vi.hoisted(() => ({ checkin: 0, alarm: 0, viewer: 0 }))
const api = vi.hoisted(() => ({
  generateCheckInLink: vi.fn(),
  generateAlarmLink: vi.fn(),
  generateViewerLink: vi.fn(),
  generateFeldLink: vi.fn(),
  getEventCheckInStats: vi.fn(),
  revokeShareLinks: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({ apiClient: api }))
const auth = vi.hoisted(() => ({ isEditor: true, user: { id: 'editor-1' } }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => auth }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
// The Feld-Code card has its own tests and its own requests.
vi.mock('@/components/feld/feld-access-card', () => ({
  FeldAccessCard: () => null,
  prefetchFeldAccess: vi.fn(),
}))

import { LinksQrSheet } from '@/components/kanban/links-qr-sheet'

const REGENERATE = 'Link neu erzeugen'

function openSheet() {
  return renderWithIntl(
    <LinksQrSheet open onOpenChange={() => {}} eventId="event-1" eventName="Sturm Musterdorf" />,
  )
}

/** The links the rows open, in row order: Check-in, Feld, Alarm erfassen, Wandanzeige.
 *  `hidden`: while the question is open, the sheet behind it is hidden from assistive tech. */
const rowLinks = () => screen.getAllByRole('link', { hidden: true }).map(link => link.getAttribute('href'))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(minted, { checkin: 0, alarm: 0, viewer: 0 })
  auth.isEditor = true
  api.generateCheckInLink.mockImplementation(async () => ({ link: `/check-in?token=checkin-${++minted.checkin}` }))
  api.generateAlarmLink.mockImplementation(async () => ({ link: `/alarm?token=alarm-${++minted.alarm}` }))
  api.generateViewerLink.mockImplementation(async () => ({ link: `/display?token=viewer-${++minted.viewer}` }))
  api.generateFeldLink.mockResolvedValue({ link: '/feld?token=feld-1', valid_until: null })
  api.getEventCheckInStats.mockResolvedValue({ checked_in: 17, total_available: 61 })
  api.revokeShareLinks.mockResolvedValue(undefined)
})

describe('LinksQrSheet – «Link neu erzeugen»', () => {
  it('offers it on Check-in, Alarm erfassen and Wandanzeige, not on the Feld link', async () => {
    openSheet()
    await waitFor(() => expect(rowLinks()).toHaveLength(4))
    expect(screen.getAllByRole('button', { name: REGENERATE })).toHaveLength(3)
  })

  it('is an editor action: a viewer has no such button', async () => {
    auth.isEditor = false
    openSheet()
    await waitFor(() => expect(rowLinks()).toHaveLength(4))
    expect(screen.queryByRole('button', { name: REGENERATE })).not.toBeInTheDocument()
  })

  it.each([
    { row: 0, kind: 'checkin', title: 'Check-in-Link neu erzeugen?', done: 'Check-in-Link neu erzeugt', link: 0, next: 'checkin-2' },
    { row: 1, kind: 'alarm', title: 'Alarm-Link neu erzeugen?', done: 'Alarm-Link neu erzeugt', link: 2, next: 'alarm-2' },
    { row: 2, kind: 'viewer', title: 'Wandanzeige-Link neu erzeugen?', done: 'Wandanzeige-Link neu erzeugt', link: 3, next: 'viewer-2' },
  ])('asks once, ends the old $kind links and shows the new link in the row', async ({ row, kind, title, done, link, next }) => {
    const user = userEvent.setup()
    openSheet()
    await waitFor(() => expect(rowLinks()).toHaveLength(4))
    const before = rowLinks()

    await user.click(screen.getAllByRole('button', { name: REGENERATE })[row])
    const question = await screen.findByRole('alertdialog')
    expect(within(question).getByText(title)).toBeInTheDocument()
    expect(within(question).getByText(/«Sturm Musterdorf» funktioniert danach nicht mehr/)).toBeInTheDocument()
    // Nothing is ended before the answer.
    expect(api.revokeShareLinks).not.toHaveBeenCalled()

    await user.click(within(question).getByRole('button', { name: 'Neu erzeugen' }))

    await waitFor(() => expect(rowLinks()[link]).toContain(`token=${next}`))
    expect(api.revokeShareLinks).toHaveBeenCalledExactlyOnceWith('event-1', kind)
    // Only that row changed.
    expect(rowLinks().filter((href, index) => href !== before[index])).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith(done, { description: 'Der bisherige Link gilt nicht mehr.' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('says the server\'s sentence when the Ereignis is led elsewhere, and keeps the row as it was', async () => {
    const user = userEvent.setup()
    const refusal = 'Dieses Ereignis wird auf KP Rück Online geführt. Den Link dort neu erzeugen.'
    api.revokeShareLinks.mockRejectedValue(new Error(refusal))
    openSheet()
    await waitFor(() => expect(rowLinks()).toHaveLength(4))
    const before = rowLinks()

    await user.click(screen.getAllByRole('button', { name: REGENERATE })[0])
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Neu erzeugen' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Link nicht neu erzeugt', { description: refusal }))
    expect(api.generateCheckInLink).toHaveBeenCalledTimes(1)
    expect(rowLinks()).toEqual(before)
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('when the old link has ended but the new one did not come, the row offers no dead link', async () => {
    const user = userEvent.setup()
    openSheet()
    await waitFor(() => expect(rowLinks()).toHaveLength(4))
    api.generateCheckInLink.mockRejectedValueOnce(new Error('offline'))

    await user.click(screen.getAllByRole('button', { name: REGENERATE })[0])
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Neu erzeugen' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Neuer Link nicht erzeugt', expect.anything()))
    expect(rowLinks().some(href => href?.includes('checkin-1'))).toBe(false)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('waits until the opening\'s links have come, so none of them lands after a new one', async () => {
    let finishAlarm: (value: { link: string }) => void = () => {}
    api.generateAlarmLink.mockReturnValueOnce(new Promise(resolve => { finishAlarm = resolve }))
    openSheet()
    await waitFor(() => expect(screen.getAllByRole('button', { name: REGENERATE })[0]).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: REGENERATE }).every(button => button.hasAttribute('disabled'))).toBe(true)

    finishAlarm({ link: '/alarm?token=alarm-1' })

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: REGENERATE }).some(button => button.hasAttribute('disabled'))).toBe(false),
    )
  })
})

