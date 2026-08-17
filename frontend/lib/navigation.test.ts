import { describe, expect, it } from 'vitest'

import { navigationUrl } from './navigation'

describe('navigating to a Schadenplatz', () => {
  it('prefers the coordinates, because that is what a field track has', () => {
    // The address is what the KP dispatched against and what a human reads, but
    // it is also what a geocoder has to guess at. A storm sends people to tracks
    // with no house number; the pin does not have to be guessed at.
    const url = navigationUrl({
      location_address: 'Waldweg, 4104 Oberwil',
      location_lat: '47.51420',
      location_lng: '7.55630',
    })

    expect(url).toContain('destination=47.5142%2C7.5563')
    expect(url).not.toContain('Waldweg')
  })

  it('falls back to the address when there is no pin', () => {
    const url = navigationUrl({ location_address: 'Hauptstrasse 12, 4104 Oberwil' })

    expect(url).toContain('destination=Hauptstrasse%2012%2C%204104%20Oberwil')
  })

  it('returns null when there is nowhere to go', () => {
    // A Schadenplatz can legitimately have neither — a crew radioed in
    // "Sammelplatz Turnhalle" and the KP typed a title. A tappable address that
    // opens an empty map is worse than plain text.
    expect(navigationUrl({})).toBeNull()
    expect(navigationUrl({ location_address: '   ' })).toBeNull()
  })

  it('ignores half a coordinate pair and unparseable ones', () => {
    // `location_lat/lng` arrive as strings from the API and either can be null
    // on its own. Half a pair is not a place.
    expect(navigationUrl({ location_address: 'Rebgasse 5', location_lat: '47.5142' })).toContain(
      'destination=Rebgasse%205'
    )
    expect(
      navigationUrl({ location_address: 'Rebgasse 5', location_lat: 'oben', location_lng: 'links' })
    ).toContain('destination=Rebgasse%205')
  })
})
