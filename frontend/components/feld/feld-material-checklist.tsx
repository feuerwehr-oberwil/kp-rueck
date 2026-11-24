'use client'

/**
 * The Material section of the Schadenplatz-Rapport (plan 25, decision 14): one
 * chip per unit that was used here, a ✕ to take it out, a dashed «+ Material»
 * to add one (owner pick 1B «Compact chips», 24.11.2026).
 *
 * Two kinds of chip, one look:
 *
 * * **A unit the board sent here** (`materials`, one row per assignment). It
 *   arrives as a chip because `gebraucht` is prefilled ja (§18.32): the unit was
 *   dispatched here, so «used» is the board's own answer and the crew takes out
 *   the exceptions. The ✕ sets `used` AND `left_on_site` to false — a unit
 *   nobody used cannot have been left behind, and a hidden «vor Ort» tick would
 *   still put it on the Abholliste. The unit then shows up in «+ Material»
 *   under «Zugewiesen», which is how a removal is taken back. Two units of one
 *   name (a Tauchpumpe Gr. from the TLF and one from the Pio) each get a chip,
 *   told apart by their depot.
 * * **«Weiteres gebrauchtes Material»** (`extra_materials`, §18.35): names, not
 *   units. The picker offers the catalogue, and a typed name that is in no
 *   catalogue — the neighbouring brigade's pump — becomes «‹Name› hinzufügen».
 *   Naming a thing here already says it was used; the ✕ takes the name out.
 *
 * **«Vor Ort verblieben» is a tap on the chip.** It opens a small menu with the
 * one question nothing else in the system can answer — is the pump still
 * standing in the cellar? — and a chip that says yes carries «vor Ort» in amber
 * (DESIGN.md: Abholung is «schau hin»). Consumables have no such question
 * (decision 26): a consumable that was used is gone, it must never reach
 * «Material zurück – freigeben», so its chip opens nothing.
 *
 * **Decision 18's boundary is untouched.** Extra entries are NAMES: no id travels
 * with a pick, nothing here is resolved to a unit, and `/feld` still never
 * creates an assignment. An extra entry left on site reaches the Restliste and
 * the Abholliste, and deliberately NOT «Material zurück – freigeben», which frees
 * assignments — the hint under the chips says so.
 *
 * **`grouped` (the KP's incident detail, Feld-tab pick 1A, 24.11.2026).** The
 * same chips, split into «Noch vor Ort» and «Zurück». This block is the KP's ONE
 * place for material: a name the crew typed carries «genannt», each kind's
 * consequence is one line under the on-site chips, and `releaseSlot` – the
 * «N Geräte freigeben» action – sits under «Zurück». Tapping «vor Ort» on a chip
 * moves it between the two groups, and the focus moves with it.
 *
 * «Noch vor Ort» is the crew's answer AND the board's: a unit marked «vor Ort» whose
 * assignment is gone (`activeMaterialIds`) was collected – «Abgeholt» releases the
 * assignment and keeps the answer as history – so it reads «abgeholt» under «Zurück».
 */

/** True while a unit marked «vor Ort» is still assigned here (no set = assume it is). */
export function unitStillOnSite(row: ApiRapportMaterialRow, active: ReadonlySet<string> | undefined): boolean {
  return row.left_on_site && (!active || (row.material_id !== null && active.has(row.material_id)))
}

import { useMemo, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { MapPin } from 'lucide-react'

import { FeldAddPicker, type FeldAddPickerItem } from '@/components/feld/feld-add-picker'
import { FeldChip, FeldChipList } from '@/components/feld/feld-chip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ApiRapportExtraMaterial, ApiRapportMaterialRow } from '@/lib/api/types'
import { addExtraMaterial, removeExtraMaterial, setExtraMaterialLeftOnSite } from '@/lib/rapport-draft'

interface FeldMaterialChecklistProps {
  rows: ApiRapportMaterialRow[]
  extraMaterials: ApiRapportExtraMaterial[]
  /**
   * Known material names from the catalogue. Offered in «+ Material» so the
   * crew does not have to spell "Tauchpumpe TP-4" from memory — names only,
   * never a unit (see above).
   */
  suggestions?: string[]
  disabled?: boolean
  onChange: (rows: ApiRapportMaterialRow[]) => void
  onExtraMaterialsChange: (entries: ApiRapportExtraMaterial[]) => void
  /** Split the chips into «Noch vor Ort» and «Zurück» (KP mount). */
  grouped?: boolean
  /** Only read with `grouped`: material ids still assigned here (see `unitStillOnSite`). */
  activeMaterialIds?: ReadonlySet<string>
  /** Only read with `grouped`: shown under «Zurück» (the KP's release action). */
  releaseSlot?: ReactNode
}

/** Picker keys: a board unit by its assignment, a catalogue name by itself. */
const UNIT_KEY = 'unit:'
const NAME_KEY = 'name:'

export function FeldMaterialChecklist({
  rows,
  extraMaterials,
  suggestions = [],
  disabled,
  onChange,
  onExtraMaterialsChange,
  grouped = false,
  activeMaterialIds,
  releaseSlot,
}: FeldMaterialChecklistProps) {
  const t = useTranslations('feld.rapport.material')

  const update = (assignmentIds: Set<string>, patch: Partial<ApiRapportMaterialRow>) => {
    onChange(rows.map(row => (assignmentIds.has(row.assignment_id) ? { ...row, ...patch } : row)))
  }

  // A unit with either answer is on the list: an old rapport can carry «vor Ort»
  // on a unit somebody marked unused, and that must stay visible, not hide.
  const shown = useMemo(() => rows.filter(row => row.used || row.left_on_site), [rows])
  // The depot only where it tells two chips apart («Tauchpumpe Gr. · TLF»).
  const namesakes = useMemo(() => {
    const count = new Map<string, number>()
    for (const row of rows) count.set(row.name, (count.get(row.name) ?? 0) + 1)
    return new Set([...count].filter(([, n]) => n > 1).map(([name]) => name))
  }, [rows])
  const unitDetail = (row: ApiRapportMaterialRow) => (namesakes.has(row.name) ? row.location : null)

  // Units taken out first (they were sent here), then the catalogue names not
  // on the list yet.
  const pickable = useMemo((): FeldAddPickerItem[] => {
    const taken = new Set(extraMaterials.map(entry => entry.name.trim().toLowerCase()))
    return [
      ...rows
        .filter(row => !row.used && !row.left_on_site)
        .map(row => {
          const detail = namesakes.has(row.name) ? row.location : null
          return {
            key: UNIT_KEY + row.assignment_id,
            name: detail ? `${row.name} · ${detail}` : row.name,
            group: t('groupAssigned'),
          }
        }),
      ...suggestions
        .filter(name => !taken.has(name.trim().toLowerCase()))
        .map(name => ({ key: NAME_KEY + name, name, group: t('groupCatalogue') })),
    ]
  }, [rows, extraMaterials, suggestions, namesakes, t])
  const takenNames = useMemo(() => extraMaterials.map(entry => entry.name), [extraMaterials])

  const add = (picked: FeldAddPickerItem[], typed: string[]) => {
    const units = new Set(picked.flatMap(item => (item.key.startsWith(UNIT_KEY) ? [item.key.slice(UNIT_KEY.length)] : [])))
    const names = picked.flatMap(item => (item.key.startsWith(NAME_KEY) ? [item.key.slice(NAME_KEY.length)] : []))
    if (units.size > 0) update(units, { used: true })
    if (names.length > 0 || typed.length > 0) onExtraMaterialsChange(addExtraMaterial(extraMaterials, [...names, ...typed]))
  }

  const unitChip = (row: ApiRapportMaterialRow) => (
    <FeldChip
      key={row.assignment_id}
      removeLabel={t('removeAria', { name: row.name })}
      onRemove={disabled ? undefined : () => update(new Set([row.assignment_id]), { used: false, left_on_site: false })}
    >
      <MaterialLabel
        chipKey={UNIT_KEY + row.assignment_id}
        name={row.name}
        detail={unitDetail(row)}
        consumable={row.consumable}
        leftOnSite={row.left_on_site}
        collected={grouped && row.left_on_site && !unitStillOnSite(row, activeMaterialIds)}
        disabled={disabled}
        onLeftOnSiteChange={left => update(new Set([row.assignment_id]), { left_on_site: left })}
      />
    </FeldChip>
  )
  const nameChip = (entry: ApiRapportExtraMaterial) => (
    <FeldChip
      key={entry.name}
      removeLabel={t('removeAria', { name: entry.name })}
      onRemove={disabled ? undefined : () => onExtraMaterialsChange(removeExtraMaterial(extraMaterials, entry.name))}
    >
      <MaterialLabel
        chipKey={NAME_KEY + entry.name}
        name={entry.name}
        named={grouped}
        leftOnSite={entry.left_on_site}
        disabled={disabled}
        onLeftOnSiteChange={left => onExtraMaterialsChange(setExtraMaterialLeftOnSite(extraMaterials, entry.name, left))}
      />
    </FeldChip>
  )
  const addPicker = !disabled && (
    <li>
      <FeldAddPicker
        label={t('add')}
        chipLabel={t('addChip')}
        searchPlaceholder={t('searchPlaceholder')}
        items={pickable}
        freeTextLabel={name => t('addTyped', { name })}
        takenNames={takenNames}
        onAdd={add}
      />
    </li>
  )
  const empty = shown.length === 0 && extraMaterials.length === 0 && (
    // The list is only as good as the material assignments (§12). An empty
    // one is not a bug, it is a board that never got the material — which
    // is what «+ Material» is for.
    <li className="text-sm text-muted-foreground">{t('empty')}</li>
  )

  if (grouped) {
    const unitsOnSite = shown.filter(row => unitStillOnSite(row, activeMaterialIds))
    const namesOnSite = extraMaterials.filter(entry => entry.left_on_site)
    const unitsBack = shown.filter(row => !unitStillOnSite(row, activeMaterialIds))
    const namesBack = extraMaterials.filter(entry => !entry.left_on_site)
    const anyOnSite = unitsOnSite.length + namesOnSite.length > 0
    return (
      <div className="space-y-3">
        {anyOnSite && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t('groupOnSite')}</p>
            <FeldChipList label={t('groupOnSite')}>
              {unitsOnSite.map(unitChip)}
              {namesOnSite.map(nameChip)}
            </FeldChipList>
            {/* Why the two kinds end differently – said once per kind present. */}
            {unitsOnSite.length > 0 && <p className="text-xs text-muted-foreground">{t('onSiteUnitHint')}</p>}
            {namesOnSite.length > 0 && <p className="text-xs text-muted-foreground">{t('onSiteNamedHint')}</p>}
          </div>
        )}
        <div className="space-y-1.5">
          {anyOnSite && <p className="text-xs font-medium text-muted-foreground">{t('groupBack')}</p>}
          <FeldChipList label={anyOnSite ? t('groupBack') : t('listLabel')}>
            {empty}
            {unitsBack.map(unitChip)}
            {namesBack.map(nameChip)}
            {addPicker}
          </FeldChipList>
          {releaseSlot}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <FeldChipList label={t('listLabel')}>
        {empty}
        {shown.map(unitChip)}
        {extraMaterials.map(nameChip)}
        {addPicker}
      </FeldChipList>
      {/* The asymmetry, said out loud instead of left to be discovered: these
          are names, not units the board dispatched, so the Abholliste fetches
          them and «Material zurück – freigeben» has nothing to free. */}
      {extraMaterials.some(entry => entry.left_on_site) && (
        <p className="text-xs text-muted-foreground">{t('extraLeftOnSiteHint')}</p>
      )}
    </div>
  )
}

/**
 * The chip's text — and, unless the unit is a consumable or the mount is
 * read-only, the button that opens its «vor Ort verblieben» menu.
 */
function MaterialLabel({
  chipKey,
  name,
  detail,
  named = false,
  consumable = false,
  leftOnSite,
  collected = false,
  disabled,
  onLeftOnSiteChange,
}: {
  /** Finds this chip's trigger again after a «vor Ort» answer moved it to the other group. */
  chipKey: string
  name: string
  detail?: string | null
  /** A name the crew typed, not a unit the board sent – marked «genannt» (grouped KP view). */
  named?: boolean
  consumable?: boolean
  leftOnSite: boolean
  /** Marked «vor Ort», assignment released since: shows «abgeholt», not the amber «vor Ort». */
  collected?: boolean
  disabled?: boolean
  onLeftOnSiteChange: (left: boolean) => void
}) {
  const t = useTranslations('feld.rapport.material')
  const text = (
    <>
      <span className="min-w-0 break-words">
        {name}
        {detail && <span className="text-muted-foreground"> · {detail}</span>}
        {named && <span className="text-xs text-muted-foreground"> · {t('namedTag')}</span>}
      </span>
      {collected ? (
        <span className="shrink-0 text-xs text-muted-foreground">{t('collected')}</span>
      ) : leftOnSite && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-warning">
          <MapPin className="size-3" aria-hidden="true" />
          {t('leftOnSiteShort')}
        </span>
      )}
    </>
  )
  if (disabled || consumable) return text
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-material-chip={chipKey}
        className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full text-left"
      >
        {text}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-56"
        // In the grouped view the answer moves the chip to the other list, which remounts
        // its trigger – Radix would hand the focus back to a node that is gone. Find the
        // chip by its key instead (Sol review, 24.11.2026).
        onCloseAutoFocus={event => {
          const trigger = document.querySelector<HTMLElement>(`[data-material-chip="${CSS.escape(chipKey)}"]`)
          if (!trigger) return
          event.preventDefault()
          trigger.focus()
        }}
      >
        <DropdownMenuLabel className="break-words">{detail ? `${name} · ${detail}` : name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={leftOnSite} onCheckedChange={checked => onLeftOnSiteChange(checked === true)}>
          {t('leftOnSite')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
