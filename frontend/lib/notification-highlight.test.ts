import { describe, expect, it, vi } from 'vitest'

import { onIncidentHighlight, requestIncidentHighlight } from '@/lib/notification-highlight'

describe('the highlight bridge', () => {
  it('carries the tab the caller pointed at, so the board can open the detail there', () => {
    const handler = vi.fn()
    const unsubscribe = onIncidentHighlight(handler)

    requestIncidentHighlight('incident-1', { tab: 'rapport', allowModal: true })

    expect(handler).toHaveBeenCalledWith('incident-1', { tab: 'rapport', allowModal: true })
    unsubscribe()
  })

  it('leaves the tab undefined for a caller that only points at the card', () => {
    // The material sidebar's device bindings: «this pump is on that Einsatz» is
    // a pointer at a card, not at anything inside it. The board still opens the
    // detail — on whichever tab that card was last left on.
    const handler = vi.fn()
    const unsubscribe = onIncidentHighlight(handler)

    requestIncidentHighlight('incident-1')

    expect(handler).toHaveBeenCalledWith('incident-1', { tab: undefined, allowModal: false })
    unsubscribe()
  })

  it('withholds the modal unless the caller asked for it', () => {
    // On a narrow viewport only a notification may take over the screen. A
    // binding clicked in the resource sidebar must not bury the list it came
    // from, so `allowModal` defaults to false rather than to "whatever fits".
    const handler = vi.fn()
    const unsubscribe = onIncidentHighlight(handler)

    requestIncidentHighlight('incident-1', { tab: 'overview' })

    expect(handler).toHaveBeenCalledWith('incident-1', { tab: 'overview', allowModal: false })
    unsubscribe()
  })
})
