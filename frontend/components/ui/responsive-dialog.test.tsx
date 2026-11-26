import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import { ResponsiveDialog, ResponsiveDialogBody } from '@/components/ui/responsive-dialog'

const mobile = vi.hoisted(() => ({ value: true }))
vi.mock('@/components/ui/use-mobile', () => ({ useIsMobile: () => mobile.value }))

const ROOT = join(__dirname, '..', '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

describe('ResponsiveDialog', () => {
  // Sweep 25.11.2026 (FE.11): eight windows built the phone sheet and the desk dialog by hand,
  // and their phone heads had drifted apart. The switch lives in ResponsiveDialog alone.
  it('is the only window that switches between a sheet and a dialog by hand', () => {
    const switches = ['app', 'components']
      .flatMap((dir) => sources(join(ROOT, dir)))
      .filter((file) => {
        const text = readFileSync(file, 'utf8')
        return /\buseIsMobile\(/.test(text) && /<SheetContent\b/.test(text) && /<DialogContent\b/.test(text)
      })
      .map((file) => relative(ROOT, file))
    expect(switches).toEqual(['components/ui/responsive-dialog.tsx'])
  })

  it('gives the phone the one sheet head, whatever the desk head is styled with', () => {
    mobile.value = true
    renderWithIntl(
      <ResponsiveDialog
        open
        onOpenChange={() => {}}
        title="Fahrer wählen"
        description="Wer fährt?"
        headerClassName="gap-1 px-6 pt-6"
        titleClassName="text-lg"
      >
        <ResponsiveDialogBody>Liste</ResponsiveDialogBody>
      </ResponsiveDialog>,
    )
    const head = screen.getByRole('dialog').querySelector('[data-slot=sheet-header]')
    // `data-frame`: SheetHeader without a className of its own – globals.css places the ✕ by it.
    expect(head).toHaveAttribute('data-frame')
    expect(screen.getByRole('heading', { name: 'Fahrer wählen' })).not.toHaveClass('text-lg')
  })
})
