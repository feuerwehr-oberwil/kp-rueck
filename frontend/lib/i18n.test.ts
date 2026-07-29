import { describe, expect, it } from 'vitest'
import de from '@/messages/de.json'

type Messages = { [key: string]: string | string[] | Messages }

function collectLeaves(obj: Messages, prefix = ''): Array<[string, string]> {
  const leaves: Array<[string, string]> = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') leaves.push([path, value])
    else if (Array.isArray(value)) value.forEach((v, i) => leaves.push([`${path}.${i}`, v]))
    else leaves.push(...collectLeaves(value, path))
  }
  return leaves
}

const deLeaves = collectLeaves(de as Messages)

describe('messages/de.json', () => {
  it('has at least one message', () => {
    expect(deLeaves.length).toBeGreaterThan(0)
  })

  it('has no empty string values', () => {
    const empty = deLeaves.filter(([, value]) => value.trim() === '')
    expect(empty.map(([path]) => path)).toEqual([])
  })

  it('has balanced ICU braces in every value', () => {
    const broken = deLeaves.filter(([, value]) => {
      let depth = 0
      for (const ch of value) {
        if (ch === '{') depth++
        if (ch === '}') depth--
        if (depth < 0) return true
      }
      return depth !== 0
    })
    expect(broken.map(([path]) => path)).toEqual([])
  })
})

// Once fr.json exists (Phase 2): assert key parity de ⊇ fr and matching ICU
// placeholder sets per key. Kept as a reminder.
