'use client'

/**
 * «Person / Fahrzeug / Material hinzufügen» – the one way the Rapport's three
 * resource sections add what the board did not send (owner pick 2A, 14.11.2026).
 *
 * The dashed «+ Person» chip at the end of the section's chips opens the picker
 * (owner pick 1B, 24.11.2026): a search field, the list in groups, and
 * «Fertig (n)» in the footer – a `ResponsiveDialog`. Below 768px it is a bottom
 * sheet (the phone rules: opens without focusing the search, grip + swipe); from
 * 768px – the board's incident detail mounts the same Rapport form – a centred
 * dialog with the same content. A tap TICKS a row and the sheet stays
 * open, so three people are three taps and one «Fertig», not three trips. Text
 * that matches no row exactly becomes the first row – «‹Text› als Gast
 * hinzufügen» – when the section can store a name that is on no list
 * (`freeTextLabel`); Fahrzeuge cannot, so it passes none.
 *
 * The sheet only offers what is not in the section yet – taking a chip back out
 * is the chip's ✕, never an untick in here – so every tick is an addition and
 * the count on «Fertig» is what will be added. A chip taken out shows up here
 * again, which is how a removal is taken back. Closing the sheet any other way
 * (✕, swipe, backdrop) adds the ticks too: a swipe on a wet phone must not
 * silently drop three names somebody just picked.
 *
 * Usage: the section passes what is still addable as `items` and gets back the
 * ticked keys and the typed names in `onAdd`.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle, Circle, Plus } from 'lucide-react'

import { FELD_CHIP_CLASS } from '@/components/feld/feld-chip'
import { Button } from '@/components/ui/button'
import { EmptyState, SearchEmptyState } from "@/components/ui/empty-state"
import { SearchInput } from '@/components/ui/search-input'
import { ResponsiveDialog, ResponsiveDialogBody, ResponsiveDialogFooter, ResponsiveDialogToolbar } from '@/components/ui/responsive-dialog'
import { personMatchesQuery } from '@/lib/resource-status'
import { cn } from '@/lib/utils'

/** One row the picker can offer. `group` is a heading; rows keep their order within it.
 *  `person`: the row is a person, found like in every person picker (Grad, tags –
 *  `personMatchesQuery`), not by the name alone. */
export interface FeldAddPickerItem {
  key: string
  name: string
  group?: string
  person?: Parameters<typeof personMatchesQuery>[0]
}

export interface FeldAddPickerGroup {
  label: string | undefined
  items: FeldAddPickerItem[]
}

/**
 * What the sheet shows for a search: the rows that match (by name, any case; a person also by
 * Grad and tags), in
 * their groups, and the typed text as a free row when it names no row exactly
 * and is not already among `takenNames` (somebody already in the section).
 */
export function pickerRows(
  items: FeldAddPickerItem[],
  search: string,
  { allowFreeText, takenNames = [] }: { allowFreeText: boolean; takenNames?: string[] },
): { freeText: string | null; groups: FeldAddPickerGroup[] } {
  const typed = search.trim()
  const needle = typed.toLowerCase()
  const matching = needle
    ? items.filter(item => (item.person ? personMatchesQuery(item.person, needle) : item.name.toLowerCase().includes(needle)))
    : items

  const groups: FeldAddPickerGroup[] = []
  for (const item of matching) {
    const last = groups[groups.length - 1]
    if (last && last.label === item.group) last.items.push(item)
    else groups.push({ label: item.group, items: [item] })
  }

  const exact = (name: string) => name.trim().toLowerCase() === needle
  const freeText =
    allowFreeText && needle && !items.some(item => exact(item.name)) && !takenNames.some(exact) ? typed : null
  return { freeText, groups }
}

interface FeldAddPickerProps {
  /** The sheet's title and the add chip's accessible name: «Person hinzufügen». */
  label: string
  /** What the add chip shows after its «+»: «Person». */
  chipLabel: string
  searchPlaceholder: string
  /** What is still addable – the section leaves out whatever it already holds. */
  items: FeldAddPickerItem[]
  /** «‹Text› als Gast hinzufügen». Without it the sheet offers no free row. */
  freeTextLabel?: (text: string) => string
  /** Beside a typed name once ticked – «Gast». */
  freeTextHint?: string
  /** Names already in the section, so typing one offers no duplicate free row. */
  takenNames?: string[]
  disabled?: boolean
  onAdd: (picked: FeldAddPickerItem[], freeTexts: string[]) => void
}

export function FeldAddPicker({
  label,
  chipLabel,
  searchPlaceholder,
  items,
  freeTextLabel,
  freeTextHint,
  takenNames,
  disabled,
  onAdd,
}: FeldAddPickerProps) {
  const t = useTranslations('feld.rapport.picker')
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [ticked, setTicked] = useState<string[]>([])
  const [freeTexts, setFreeTexts] = useState<string[]>([])

  const { freeText, groups } = useMemo(
    () =>
      pickerRows(items, search, {
        allowFreeText: Boolean(freeTextLabel),
        takenNames: [...(takenNames ?? []), ...freeTexts],
      }),
    [items, search, freeTextLabel, takenNames, freeTexts],
  )
  const count = ticked.length + freeTexts.length
  // A heading over the only group says nothing – the button already named what this is.
  const showHeadings = groups.length > 1

  const toggle = (key: string) =>
    setTicked(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]))

  const close = () => {
    if (count > 0) {
      const byKey = new Map(items.map(item => [item.key, item]))
      onAdd(
        ticked.flatMap(key => byKey.get(key) ?? []),
        freeTexts,
      )
    }
    setOpen(false)
    setSearch('')
    setTicked([])
    setFreeTexts([])
  }

  const handleOpenChange = (next: boolean) => (next ? setOpen(true) : close())
  const doneLabel = t('done', { count })
  const searchField = (
    <SearchInput value={search} onValueChange={setSearch} placeholder={searchPlaceholder} autoComplete="off" />
  )
  const list = (
    <>
      {freeTexts.map(name => (
        <PickRow
          key={`free-${name}`}
          name={name}
          hint={freeTextHint}
          ticked
          onClick={() => setFreeTexts(prev => prev.filter(entry => entry !== name))}
        />
      ))}
      {freeText && freeTextLabel && (
        <button
          type="button"
          onClick={() => {
            setFreeTexts(prev => [...prev, freeText])
            setSearch('')
          }}
          className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm"
        >
          <Plus className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">{freeTextLabel(freeText)}</span>
        </button>
      )}
      {groups.map(group => (
        <div key={group.label ?? ''} className="space-y-1">
          {showHeadings && group.label && (
            <p className="px-3 pt-2 pb-0.5 text-xs text-muted-foreground">{group.label}</p>
          )}
          {group.items.map(item => (
            <PickRow
              key={item.key}
              name={item.name}
              ticked={ticked.includes(item.key)}
              onClick={() => toggle(item.key)}
            />
          ))}
        </div>
      ))}
      {groups.length === 0 &&
        !freeText &&
        (search.trim() ? (
          <SearchEmptyState query={search} onClear={() => setSearch('')} />
        ) : (
          <EmptyState compact title={t('nothingLeft')} />
        ))}
    </>
  )

  return (
    <>
      {/* The dashed «+ Person» chip at the end of the section's chips. Its
          name is the full «Person hinzufügen»; the short word is what shows. */}
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        onClick={() => setOpen(true)}
        className={cn(
          FELD_CHIP_CLASS,
          'cursor-pointer border border-dashed border-border px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {chipLabel}
      </button>

      {/* A fixed height on the phone (`fill`): sized to its content, the sheet shrank with
          every letter typed and the search field slid away under the thumb. On the desk (the
          board's detail) a centred dialog, the list scrolling between the search and «Fertig». */}
      <ResponsiveDialog open={open} onOpenChange={handleOpenChange} title={label} frame="panel" fill>
        {/* `pe-10`: the search ends where the head does, clear of the ✕. */}
        <ResponsiveDialogToolbar className="pe-10">{searchField}</ResponsiveDialogToolbar>
        {/* The rows carry their own 12px inset: the frame gives the rest. */}
        <ResponsiveDialogBody className="space-y-1 px-3" sheetClassName="space-y-1 px-3">
          {list}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button type="button" onClick={close}>
            {doneLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialog>
    </>
  )
}

/** One tappable row: the name, ticked = selection wash + edge + ✓ (DESIGN.md «Colour roles»). */
function PickRow({
  name,
  hint,
  ticked,
  onClick,
}: {
  name: string
  hint?: string
  ticked: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={ticked}
      onClick={onClick}
      className={cn(
        'flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors',
        ticked ? 'border-sel-edge bg-sel-wash' : 'hover:bg-secondary/40',
      )}
    >
      {ticked ? (
        <CheckCircle className="h-5 w-5 shrink-0 text-sel-foreground" />
      ) : (
        <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 break-words">{name}</span>
      {hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{hint}</span>}
    </button>
  )
}
