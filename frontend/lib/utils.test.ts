import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { formatLocationForDisplay } from './utils'

/**
 * The address formatter exists twice – here and as `format_location_for_display`
 * in backend/app/services/pdf_report_service.py, which is what fills the
 * `location_display` the API serves. Both suites read the SAME table so the two
 * copies cannot drift: a case added here is a case the backend must pass too.
 *
 * The table lives under backend/tests/ because the backend runs its tests inside
 * the dev container, where only ./backend is mounted; Vitest runs from the repo
 * checkout and can reach across.
 */
type LocationCase = {
  name: string
  why: string
  address: string
  home_city: string
  expected: string
}

// Relative to the Vitest root (frontend/), not to this file: `import.meta.url` is
// not a file: URL under the test transform.
const casesPath = resolve(process.cwd(), '../backend/tests/test_services/location_display_cases.json')
const { cases } = JSON.parse(readFileSync(casesPath, 'utf8')) as { cases: LocationCase[] }

describe('formatLocationForDisplay', () => {
  it('reads the shared case table', () => {
    expect(cases.length).toBeGreaterThan(15)
  })

  it.each(cases.map((c): [string, LocationCase] => [c.name, c]))('%s', (_name, testCase) => {
    expect(formatLocationForDisplay(testCase.address, testCase.home_city)).toBe(testCase.expected)
  })

  it('never repeats the street where the city belongs', () => {
    // The B1 symptom ("Main Street 45, Main Street"), stated as a property over
    // the whole table rather than as one more example.
    for (const { address, home_city } of cases) {
      const output = formatLocationForDisplay(address, home_city)
      const [street, city] = output.split(', ')
      if (!city) continue
      expect(city, `${address} → ${output}`).not.toBe(street.replace(/ \d+$/, ''))
    }
  })
})
