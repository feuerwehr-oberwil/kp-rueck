'use client'

/**
 * «Person / Fahrzeug / Material hinzufügen» – the one way the Rapport's three
 * resource sections add what the board did not send (owner pick 2A, 14.11.2026).
 *
 * One button in the section opens the picker: a search field, the list in
 * groups, and «Fertig (n)» in the footer. Below 768px it is a bottom sheet (the
 * phone rules: opens without focusing the search, grip + swipe); from 768px –
 * the board's incident detail mounts the same Rapport form – a centred dialog
 * with the same content, the split `new-emergency-modal.tsx` makes. A tap TICKS a row and the sheet stays
 * open, so three people are three taps and one «Fertig», not three trips. Text
 * that matches no row exactly becomes the first row – «‹Text› als Gast
 * hinzufügen» – when the section can store a name that is on no list
 * (`freeTextLabel`); Fahrzeuge cannot, so it passes none.
 *
 * The sheet only offers what is not in the section yet – taking a row back out
 * is the section's ✕, never an untick in here – so every tick is an addition and
 * the count on «Fertig» is what will be added. Closing the sheet any other way
 * (✕, swipe, backdrop) adds the ticks too: a swipe on a wet phone must not
 * silently drop three names somebody just picked.
 *
 * Usage: the section passes what is still addable as `items` and gets back the
 * ticked keys and the typed names in `onAdd`.
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle, Circle, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, SearchEmptyState } from "@/components/ui/empty-state"
import { SearchInput } from '@/components/ui/search-input'
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/components/ui/use-mobile'
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
  /** The button and the sheet's title: «Person hinzufügen». */
  label: string
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
  searchPlaceholder,
  items,
  freeTextLabel,
  freeTextHint,
  takenNames,
  disabled,
  onAdd,
}: FeldAddPickerProps) {
  const t = useTranslations('feld.rapport.picker')
  const isMobile = useIsMobile()
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
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" />
        {label}
      </Button>

      {isMobile ? (
        <Sheet open={open} onOpenChange={handleOpenChange}>
          {/* A fixed height (`h-[88dvh]`, the `modal-h-tall` cap), like the
              assignment and Appell sheets: sized to its content, the sheet shrank
              with every letter typed and the search field slid away under the
              thumb. With the keyboard up globals.css fits it to the visible band. */}
          <SheetContent
            side="bottom"
            className="mx-auto h-[88dvh] modal-h-tall max-w-md gap-0 rounded-t-2xl p-0"
            aria-describedby={undefined}
          >
            <SheetHeader className="gap-3 px-4 pt-5 pb-3 pr-12">
              <SheetTitle className="text-lg">{label}</SheetTitle>
              {searchField}
            </SheetHeader>
            <SheetBody className="space-y-1 px-2 pb-3">{list}</SheetBody>
            <SheetFooter className="mt-0 border-t px-4 pt-3 pb-sheet-safe">
              <Button type="button" size="lg" className="w-full" onClick={close}>
                {doneLabel}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          {/* The board's detail is desktop: a centred dialog with the list scrolling
              between the search and «Fertig», not a strip along the screen's foot. */}
          <DialogContent
            className="flex modal-h-tall flex-col gap-0 overflow-hidden p-0"
            aria-describedby={undefined}
          >
            <DialogHeader className="gap-3 px-5 pt-5 pb-3 pr-12">
              <DialogTitle>{label}</DialogTitle>
              {searchField}
            </DialogHeader>
            <div className="relative min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 pb-3">{list}</div>
            <DialogFooter className="border-t px-5 py-3">
              <Button type="button" onClick={close}>
                {doneLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
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
