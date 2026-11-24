import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithIntl } from '@/test-utils/render-with-intl'
import type { ApiRapportExtraMaterial, ApiRapportMaterialRow } from '@/lib/api/types'

import { FeldMaterialChecklist } from '@/components/feld/feld-material-checklist'

function material(overrides: Partial<ApiRapportMaterialRow> = {}): ApiRapportMaterialRow {
  return {
    assignment_id: 'a1',
    material_id: 'm1',
    name: 'Tauchpumpe TP-4',
    location: 'Magazin A',
    consumable: false,
    used: true,
    left_on_site: false,
    on_board: true,
    ...overrides,
  }
}

function render(props: Partial<React.ComponentProps<typeof FeldMaterialChecklist>> = {}) {
  return renderWithIntl(
    <FeldMaterialChecklist
      rows={[material()]}
      extraMaterials={[]}
      onChange={vi.fn()}
      onExtraMaterialsChange={vi.fn()}
      {...props}
    />,
  )
}

const entry = (name: string, leftOnSite = false): ApiRapportExtraMaterial => ({ name, left_on_site: leftOnSite })

/** Opens «Material hinzufügen» and returns its sheet. */
async function openPicker() {
  await userEvent.click(screen.getByRole('button', { name: 'Material hinzufügen' }))
  return screen.findByRole('dialog')
}

describe('FeldMaterialChecklist — units the board sent', () => {
  it('shows a used unit as a chip; the ✕ clears both answers', async () => {
    // A unit nobody used cannot have been left behind — and a hidden «vor Ort»
    // would still put it on the Abholliste.
    const onChange = vi.fn()
    render({ rows: [material({ left_on_site: true }), material({ assignment_id: 'a2', name: 'Motorsäge' })], onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Tauchpumpe TP-4 entfernen' }))
    expect(onChange).toHaveBeenCalledWith([
      material({ used: false, left_on_site: false }),
      material({ assignment_id: 'a2', name: 'Motorsäge' }),
    ])
  })

  it('a tap on the chip answers «vor Ort verblieben», and the chip says so', async () => {
    const onChange = vi.fn()
    const { rerender } = render({ onChange })
    expect(screen.queryByText('vor Ort')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Tauchpumpe TP-4' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'vor Ort verblieben' }))
    expect(onChange).toHaveBeenCalledWith([material({ left_on_site: true })])

    rerender(
      <FeldMaterialChecklist
        rows={[material({ left_on_site: true })]}
        extraMaterials={[]}
        onChange={onChange}
        onExtraMaterialsChange={vi.fn()}
      />,
    )
    expect(screen.getByText('vor Ort')).toBeInTheDocument()
  })

  it('gives a consumable no «vor Ort» question (decision 26)', () => {
    render({ rows: [material({ consumable: true, name: 'Ölbinder' })] })
    expect(screen.getByText('Ölbinder')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ölbinder' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ölbinder entfernen' })).toBeInTheDocument()
  })

  it('tells two units of one name apart by their depot', () => {
    render({
      rows: [
        material({ name: 'Tauchpumpe Gr.', location: 'TLF' }),
        material({ assignment_id: 'a2', name: 'Tauchpumpe Gr.', location: 'Pio' }),
        material({ assignment_id: 'a3', name: 'Motorsäge', location: 'TLF' }),
      ],
    })
    expect(screen.getByText('· TLF')).toBeInTheDocument()
    expect(screen.getByText('· Pio')).toBeInTheDocument()
    // A unique name carries no depot.
    expect(screen.getByText('Motorsäge').textContent).toBe('Motorsäge')
  })

  it('offers a removed unit again under «Zugewiesen», and adding it ticks gebraucht', async () => {
    const onChange = vi.fn()
    render({ rows: [material({ used: false })], suggestions: ['Nassauger'], onChange })
    expect(screen.getByText('Kein Material erfasst.')).toBeInTheDocument()

    const sheet = await openPicker()
    const text = sheet.textContent ?? ''
    expect(text.indexOf('Zugewiesen')).toBeLessThan(text.indexOf('Tauchpumpe TP-4'))
    expect(text.indexOf('Tauchpumpe TP-4')).toBeLessThan(text.indexOf('Nassauger'))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Tauchpumpe TP-4' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))
    expect(onChange).toHaveBeenCalledWith([material()])
  })
})

describe('FeldMaterialChecklist — Weiteres Material', () => {
  it('adds catalogue picks as names after what is there, carrying no id', async () => {
    const onExtraMaterialsChange = vi.fn()
    render({ rows: [], extraMaterials: [entry('Nassauger')], suggestions: ['Nassauger', 'Motorsäge'], onExtraMaterialsChange })

    const sheet = await openPicker()
    // Already on the list: not offered twice — taking it out is the chip's ✕.
    expect(within(sheet).queryByRole('button', { name: 'Nassauger' })).toBeNull()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Motorsäge' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))

    // A name and one tick, and nothing else (decision 18) — picking a name is
    // not picking a unit, and /feld still never writes an assignment.
    expect(onExtraMaterialsChange).toHaveBeenCalledWith([
      { name: 'Nassauger', left_on_site: false },
      { name: 'Motorsäge', left_on_site: false },
    ])
  })

  it('takes a typed name for something that is in no catalogue at all', async () => {
    const onExtraMaterialsChange = vi.fn()
    render({ rows: [], extraMaterials: [], suggestions: ['Nassauger'], onExtraMaterialsChange })

    const sheet = await openPicker()
    await userEvent.type(within(sheet).getByPlaceholderText('Material suchen …'), 'Pumpe vom Nachbarzug')
    await userEvent.click(within(sheet).getByRole('button', { name: '«Pumpe vom Nachbarzug» hinzufügen' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (1)' }))
    expect(onExtraMaterialsChange).toHaveBeenCalledWith([{ name: 'Pumpe vom Nachbarzug', left_on_site: false }])
  })

  it('takes an entry off with its ✕', async () => {
    const onExtraMaterialsChange = vi.fn()
    render({ rows: [], extraMaterials: [entry('Nassauger')], onExtraMaterialsChange })
    await userEvent.click(screen.getByRole('button', { name: 'Nassauger entfernen' }))
    expect(onExtraMaterialsChange).toHaveBeenCalledWith([])
  })

  it('gives each entry its own «vor Ort verblieben» (§18.35) and says why it is not released', async () => {
    const onExtraMaterialsChange = vi.fn()
    const { rerender } = render({
      rows: [],
      extraMaterials: [entry('Nassauger'), entry('Pumpe vom Nachbarzug')],
      onExtraMaterialsChange,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Pumpe vom Nachbarzug' }))
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'vor Ort verblieben' }))
    const next = onExtraMaterialsChange.mock.calls[0][0] as ApiRapportExtraMaterial[]
    expect(next).toEqual([entry('Nassauger'), entry('Pumpe vom Nachbarzug', true)])

    // The asymmetry of decision 18 made visible: the Abholliste fetches it,
    // «Material zurück – freigeben» has no assignment to free.
    rerender(
      <FeldMaterialChecklist rows={[]} extraMaterials={next} onChange={vi.fn()} onExtraMaterialsChange={vi.fn()} />,
    )
    expect(screen.getByText(/Abholliste/)).toBeInTheDocument()
  })

  it('offers no controls in a read-only mount', () => {
    render({ extraMaterials: [entry('Nassauger', true)], disabled: true })
    expect(screen.getByText('Nassauger')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('FeldMaterialChecklist — grouped (the KP detail, pick 1A 24.11.2026)', () => {
  it('splits the chips into «Noch vor Ort» and «Zurück», a typed name marked «genannt»', () => {
    render({
      grouped: true,
      rows: [
        material({ left_on_site: true, name: 'Tauchpumpe S-Gr.' }),
        material({ assignment_id: 'a2', name: 'Wassersauger' }),
      ],
      extraMaterials: [entry('Nassauger vom Betrieb', true)],
      releaseSlot: <button type="button">1 Gerät freigeben</button>,
    })

    const onSite = screen.getByRole('list', { name: 'Noch vor Ort' })
    expect(within(onSite).getByText('Tauchpumpe S-Gr.')).toBeInTheDocument()
    expect(within(onSite).getByText(/Nassauger vom Betrieb/)).toHaveTextContent('Nassauger vom Betrieb · genannt')
    const back = screen.getByRole('list', { name: 'Zurück' })
    expect(within(back).getByText('Wassersauger')).toBeInTheDocument()
    // One consequence line per kind on site, and the release action under «Zurück».
    expect(screen.getByText(/Zugewiesenes bleibt zugewiesen/)).toBeInTheDocument()
    expect(screen.getByText(/«genannt» ist nur ein Name/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 Gerät freigeben' })).toBeInTheDocument()
  })

  it('shows one plain list while nothing is on site', () => {
    render({ grouped: true })

    expect(screen.queryByText('Noch vor Ort')).not.toBeInTheDocument()
    expect(screen.queryByText('Zurück')).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Material' })).toBeInTheDocument()
  })
})

describe('FeldMaterialChecklist — grouped, keyboard', () => {
  /** The form's role: holds the rows, so an answer re-renders the list as in the app. */
  function Harness() {
    const [rows, setRows] = useState([material({ name: 'Tauchpumpe S-Gr.' })])
    return <FeldMaterialChecklist grouped rows={rows} extraMaterials={[]} onChange={setRows} onExtraMaterialsChange={vi.fn()} />
  }

  it('keeps the focus on a chip that its «vor Ort» answer moved to the other group', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Harness />)

    screen.getByRole('button', { name: /Tauchpumpe S-Gr\.$/ }).focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('menuitemcheckbox', { name: 'vor Ort verblieben' })
    await user.keyboard('{ArrowDown}{Enter}')

    const onSite = await screen.findByRole('list', { name: 'Noch vor Ort' })
    // The chip's menu trigger, not its ✕ («Tauchpumpe S-Gr. entfernen»).
    const moved = within(onSite).getAllByRole('button').find(button => button.hasAttribute('data-material-chip'))
    await vi.waitFor(() => expect(moved).toHaveFocus())
  })
})
