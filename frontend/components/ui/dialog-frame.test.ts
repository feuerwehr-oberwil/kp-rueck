import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import { dialogFrameClass } from '@/components/ui/dialog-frame'

// Owner pick 4A (19.11.2026): three window sizes, set by `size` – never by a call site's
// className. An un-prefixed `max-w-2xl` lost to the primitive's `sm:max-w-lg`, so «wide»
// dialogs rendered at 512 by accident; a `top-[8vh]` gave one picker a place of its own.
const ROOT = join(__dirname, '..', '..')
const DIRS = ['app', 'components']

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

/** The opening tag of every `<DialogContent` / `<AlertDialogContent` in a file. */
function openingTags(text: string): string[] {
  const tags: string[] = []
  for (const match of text.matchAll(/<(?:Alert)?DialogContent\b/g)) {
    let depth = 0
    let end = match.index
    for (; end < text.length; end++) {
      const char = text[end]
      if (char === '{') depth++
      else if (char === '}') depth--
      else if (char === '>' && depth === 0 && text[end - 1] !== '=') break
    }
    tags.push(text.slice(match.index, end + 1))
  }
  return tags
}

// A width, a place or a translate of the call site's own – the frame's job (dialog-frame.ts).
const GEOMETRY = /(?:^|[\s"'`:!])(?:max-w-|w-\[|w-full|w-screen|top-|left-|right-|bottom-|inset-|translate-)/

describe('dialog sizes', () => {
  it('no DialogContent / AlertDialogContent sets its own width or position', () => {
    const offenders = DIRS.flatMap((dir) => sources(join(ROOT, dir))).flatMap((file) =>
      openingTags(readFileSync(file, 'utf8'))
        .map((tag) => tag.match(/className=(?:"([^"]*)"|\{([^}]*)\})/))
        .filter((m): m is RegExpMatchArray => m !== null && GEOMETRY.test(m[1] ?? m[2] ?? ''))
        .map((m) => `${relative(ROOT, file)}: ${m[0]}`),
    )
    expect(offenders).toEqual([])
  })

  // Feedback 19.11.2026: the Appell (M, modal-h-tall) ended 2vh above the screen's edge under a
  // 10vh top line. S and M cap their height so the gap below equals the gap above.
  it.each(['sm', 'md'] as const)('%s leaves the same gap below as above', (size) => {
    const frame = dialogFrameClass(size)
    const top = Number(frame.match(/md:top-\[(\d+)vh\]/)?.[1])
    const room = frame.match(/md:\[--modal-room:calc\(100dvh_-_(\d+)vh\)\]/)?.[1]
    expect(Number(room)).toBe(2 * top)
  })
})
