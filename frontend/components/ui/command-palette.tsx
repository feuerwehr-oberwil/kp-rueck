"use client"

import { useEffect, useState, useCallback, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandRankGroups,
  CommandSeparator,
} from "@/components/ui/command"
import { defaultFilter } from "cmdk"
import { DispatchChoice, DispatchPreview } from "@/components/ui/command-dispatch-preview"
import {
  completeDispatch,
  parseDispatch,
  targetKey,
  type DispatchCompletion,
  type DispatchPicks,
  type DispatchTarget,
  type DispatchToken,
  type ParsedDispatch,
} from "@/lib/command-dispatch"
import {
  Home,
  Map,
  Calendar,
  Plus,
  RefreshCw,
  Search,
  Users,
  Package,
  ArrowRight,
  ArrowLeft,
  Edit,
  Trash2,
  Truck,
  Bell,
  BookOpen,
  Settings,
  PanelRight,
  Footprints,
  Tag,
  Route,
  Crosshair,
  ChevronDown,
  Waypoints,
  Printer,
  Palette,
  QrCode,
  FileText,
  BookOpenText,
  NotebookPen,
  ChartColumn,
  Clock,
} from "lucide-react"
import { useCommandPaletteHandlers } from "@/lib/contexts/command-palette-context"
import { useGroups } from "@/lib/contexts/groups-context"
import { PRIORITY_ICONS, PRIORITY_TEXT_CLASSES } from "@/lib/priority"
// Hints come from the one chord table — they said «G K» for weeks after the
// chord had moved to G B.
import { gPrefixHint } from "@/lib/hooks/use-g-prefix-navigation"

/** Window event that opens the palette (for mouse entry points like the welcome card). */
export const OPEN_COMMAND_PALETTE_EVENT = "kp:open-command-palette"

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT))
}

/**
 * Rows of the type-to-dispatch block carry their rank in their value
 * (`kp-dispatch:<score>:…`) instead of being scored by cmdk: the typed text is
 * «14 tlf meier», which matches none of their labels, and the preview must
 * still stand first so ↵ does what it shows. Everything else is scored by
 * cmdk's own filter, unchanged.
 */
const DISPATCH_VALUE = "kp-dispatch:"
const PREVIEW_VALUE = `${DISPATCH_VALUE}2:preview`

function paletteFilter(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith(DISPATCH_VALUE)) return Number(value.slice(DISPATCH_VALUE.length).split(":")[0]) || 0
  return defaultFilter(value, search, keywords)
}

/**
 * How the preview ranks against the ordinary commands. A line that starts with
 * an Einsatz number is a dispatch and stands first. Without a number the text
 * may just as well be a command typed by name – «neu», «hoch», «einsätze», «hi»
 * – so a preview that could not run anyway (blocked) or only guesses at a name
 * (prefix/typo jump) goes to the bottom, and ↵ falls through to the command.
 * Only a full-name jump («schneider») outranks the list.
 *
 * «Bottom» is a score, not a DOM position: `CommandRankGroups` orders rows and
 * groups by score, so the low previews sit below any real match cmdk's
 * filter can produce (its scores do not get near `LAST`).
 */
const LAST = 0.0001
function previewScore(parsed: ParsedDispatch): number {
  const { plan } = parsed
  if (plan.kind === "dispatch") return 2
  // An Einsatz opened by a mere beginning of its address («hilf» → «Hilfikerstrasse»)
  // may as well be a command typed by name.
  if (plan.kind === "open") return plan.loose ? LAST : 2
  if (plan.kind === "blocked") {
    const numbered = plan.reason === "unknown-incident" || (plan.reason === "ambiguous" && plan.incident !== null)
    return numbered ? 2 : LAST
  }
  if (plan.kind === "jump") return plan.exact ? 2 : LAST
  return 0
}

function previewValue(parsed: ParsedDispatch): string {
  const score = previewScore(parsed)
  return score === 2 ? PREVIEW_VALUE : `${DISPATCH_VALUE}${score}:preview`
}

export function CommandPalette() {
  const t = useTranslations('common.commandPalette')
  // The «Färben nach» mode names — reused from the map's own Ansicht menu so
  // the palette and the dropdown can never disagree on what a mode is called.
  const tMapColorBy = useTranslations('map.colorBy')
  const [open, setOpen] = useState(false)
  const router = useRouter()

  // Get handlers from context
  const {
    onNewOperation,
    onRefresh,
    onToggleLeftSidebar,
    onToggleRightSidebar,
    onToggleVehicleStatus,
    onToggleAuftraege,
    onTogglePrint,
    onToggleLinks,
    onToggleRapporte,
    onToggleJournal,
    onWriteJournal,
    onToggleFigures,
    onToggleCrewDuty,
    onOpenAuftrag,
    onToggleNotifications,
    onToggleSidePanel,
    onSidePanelDetail,
    onSidePanelMap,
    onSearchPersonnel,
    onSearchMaterial,
    onEditIncident,
    onDeleteIncident,
    onMoveStatusForward,
    onMoveStatusBackward,
    onAssignVehicle,
    onSetPriority,
    onToggleZuFuss,
    onToggleMapLabels,
    onToggleMapLines,
    onFocusVehicle,
    onMapResetZoom,
    onSetMapColorBy,
    mapVehicleNames = [],
    onFocusIncidentSearch,
    hasSelectedIncident = false,
    getDispatchVocabulary,
    onDispatch,
    onDispatchJump,
    onOpenIncident,
  } = useCommandPaletteHandlers()

  // Type-to-dispatch. The text is controlled so the parser sees it; picks answer
  // «which Meier?» per typed word and live only as long as the palette is open.
  const [search, setSearch] = useState("")
  const [picks, setPicks] = useState<DispatchPicks>({})
  const [selectedValue, setSelectedValue] = useState("")
  useEffect(() => {
    if (open) return
    setSearch("")
    setPicks({})
  }, [open])
  const vocabulary = useMemo(
    () => (open && getDispatchVocabulary ? getDispatchVocabulary() : null),
    [open, getDispatchVocabulary],
  )
  const parsed = useMemo(
    () => (vocabulary ? parseDispatch(search, vocabulary, picks) : null),
    [vocabulary, search, picks],
  )
  const dispatchPlan = parsed?.plan.kind === "none" ? null : parsed?.plan ?? null

  // ⇥ completes the word being typed («kell» → «Keller Marco»); ⇥ again steps to the
  // next candidate, ⇧⇥ back. The cycle lives only while the text is what ⇥ put there.
  const completions = useMemo(
    () => (vocabulary ? completeDispatch(search, vocabulary) : []),
    [vocabulary, search],
  )
  const cycle = useRef<{ options: DispatchCompletion[]; index: number; applied: string } | null>(null)
  const cycling = cycle.current !== null && cycle.current.applied === search
  const lastToken = parsed?.tokens[parsed.tokens.length - 1]
  const nextCompletion: DispatchCompletion | null = cycling
    ? cycle.current!.options.length > 1
      ? cycle.current!.options[(cycle.current!.index + 1) % cycle.current!.options.length]
      : null
    : // No hint where the preview already says it — the word shown as that very chip, or
      // its candidates listed as rows right below. ⇥ completes either way.
      lastToken?.state === "ambiguous" ||
        (completions.length === 1 &&
          lastToken?.state === "match" &&
          lastToken.target &&
          targetKey(lastToken.target) === targetKey(completions[0].target))
      ? null
      : completions[0] ?? null
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Tab" || event.altKey || event.metaKey || event.ctrlKey || !vocabulary) return
    const current = cycle.current
    const options = current && current.applied === search ? current.options : completions
    if (options.length === 0) {
      // Nothing to complete: still no focus jump out of the field while a line is typed.
      if (search.trim()) event.preventDefault()
      return
    }
    event.preventDefault()
    const step = event.shiftKey ? -1 : 1
    const index =
      current && current.applied === search ? (current.index + step + options.length) % options.length : event.shiftKey ? options.length - 1 : 0
    const text = options[index].text
    cycle.current = { options, index, applied: text }
    setSearch(text)
  }
  const ambiguousTokens = (parsed?.tokens ?? []).filter(
    (token): token is DispatchToken & { choices: DispatchTarget[] } => token.state === "ambiguous" && !!token.choices,
  )

  // Aufträge (routes) are searchable by name; selecting one opens the Aufträge
  // sheet focused on that route. Only surfaced where the host page registered the
  // open handler (the Kanban dashboard) so the palette never lists dead entries.
  const { groups } = useGroups()

  // Helper: bind incident-bound handlers only when one is hovered/selected,
  // otherwise the CommandItem stays visible but `disabled` greys it out.
  const incidentOnly = (fn?: () => void) => (hasSelectedIncident ? fn : undefined)

  // Listen for Cmd/Ctrl+K and the programmatic open event
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // toLowerCase so Caps Lock / Shift (e.key === "K") still opens it.
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }
    const openFromEvent = () => setOpen(true)

    document.addEventListener("keydown", down)
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openFromEvent)
    return () => {
      document.removeEventListener("keydown", down)
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openFromEvent)
    }
  }, [])

  const runCommand = useCallback((command: () => void) => {
    setOpen(false)
    command()
  }, [])

  // ↵ on the preview. Nothing happens before it — and nothing on a plan that is
  // still asking (a «which one?», an unknown number), which keeps the palette open.
  const runPreview = () => {
    if (!dispatchPlan) return
    if (dispatchPlan.kind === "dispatch") {
      if (!onDispatch || dispatchPlan.noop) return
      runCommand(() => onDispatch(dispatchPlan))
    } else if (dispatchPlan.kind === "open") {
      const incidentId = dispatchPlan.incident.id
      if (onOpenIncident) runCommand(() => onOpenIncident(incidentId))
    } else if (dispatchPlan.kind === "jump") {
      const target = dispatchPlan.target
      if (onDispatchJump) runCommand(() => onDispatchJump(target))
    }
  }

  const pickChoice = (token: DispatchToken, choice: DispatchTarget) => {
    setPicks((current) => ({ ...current, [token.pickKey]: targetKey(choice) }))
  }
  // After a pick, back to the preview, which now says what ↵ does with it.
  const pickCount = Object.keys(picks).length
  const previewAfterPick = parsed && pickCount > 0 ? previewValue(parsed) : null
  // Only when a pick was made — not on every keystroke.
  const seenPickCount = useRef(0)
  useEffect(() => {
    if (pickCount === seenPickCount.current) return
    seenPickCount.current = pickCount
    if (previewAfterPick) setSelectedValue(previewAfterPick)
  }, [pickCount, previewAfterPick])

  // Scroll affordance: when the command list overflows (and isn't scrolled to
  // the bottom) show a bottom fade + chevron, so it's obvious more items exist
  // even when the list wraps exactly after an item.
  const listWrapperRef = useRef<HTMLDivElement>(null)
  const [canScrollDown, setCanScrollDown] = useState(false)
  useEffect(() => {
    if (!open) return
    const wrap = listWrapperRef.current
    const list = wrap?.querySelector('[data-slot="command-list"]') as HTMLElement | null
    if (!list) return
    const recompute = () =>
      setCanScrollDown(list.scrollHeight - list.scrollTop - list.clientHeight > 4)
    recompute()
    list.addEventListener("scroll", recompute)
    const ro = new ResizeObserver(recompute)
    ro.observe(list)
    if (list.firstElementChild) ro.observe(list.firstElementChild)
    return () => {
      list.removeEventListener("scroll", recompute)
      ro.disconnect()
    }
  }, [open])

  // Placed in the DOM by its rank rather than left to cmdk's sort: on top when
  // it is the thing typed, under every matching command when it only might be
  // (see `previewScore`) — so the first row, the one ↵ runs, is always right.
  const dispatchOnTop = !!parsed && previewScore(parsed) === 2
  const dispatchGroup = parsed && dispatchPlan ? (
    <CommandGroup heading={t('dispatch.group')}>
      <CommandItem value={previewValue(parsed)} onSelect={runPreview}>
        <DispatchPreview parsed={parsed} canDispatch={!!onDispatch} completion={nextCompletion} />
      </CommandItem>
      {ambiguousTokens.flatMap((token) =>
        token.choices.map((choice, index) => (
          <CommandItem
            key={`${token.pickKey}-${targetKey(choice)}`}
            // Right under the preview, wherever it ranks, best first.
            // Just under the preview, best first – a fraction of its score, so a
            // bottom-ranked preview keeps its choices at the bottom too.
            value={`${DISPATCH_VALUE}${previewScore(parsed) * (1 - (index + 1) / 100)}:${token.pickKey}:${targetKey(choice)}`}
            onSelect={() => pickChoice(token, choice)}
          >
            <DispatchChoice token={token} choice={choice} />
          </CommandItem>
        )),
      )}
    </CommandGroup>
  ) : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 shadow-lg" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <Command
          filter={paletteFilter}
          value={selectedValue}
          onValueChange={setSelectedValue}
          className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          <CommandInput
            placeholder={getDispatchVocabulary ? t('dispatch.placeholder') : t('searchPlaceholder')}
            value={search}
            onValueChange={setSearch}
            onKeyDown={onSearchKeyDown}
            showClose
          />
          <div ref={listWrapperRef} className="relative">
          <CommandList>
            <CommandEmpty>{t('noResults')}</CommandEmpty>

            {dispatchOnTop && dispatchGroup}

            <CommandGroup heading={t('groupNavigation')}>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/"))}
              >
                <Home className="mr-2 h-4 w-4" />
                <span>{t('kanbanView')}</span>
                <span className="ml-auto text-xs text-muted-foreground">{gPrefixHint("/")}</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/map"))}
              >
                <Map className="mr-2 h-4 w-4" />
                <span>{t('mapView')}</span>
                <span className="ml-auto text-xs text-muted-foreground">{gPrefixHint("/map")}</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/events"))}
              >
                <Calendar className="mr-2 h-4 w-4" />
                <span>{t('eventSelection')}</span>
                <span className="ml-auto text-xs text-muted-foreground">{gPrefixHint("/events")}</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/help"))}
              >
                <BookOpen className="mr-2 h-4 w-4" />
                <span>{t('helpDocs')}</span>
                <span className="ml-auto text-xs text-muted-foreground">{gPrefixHint("/help")}</span>
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push("/settings"))}
              >
                <Settings className="mr-2 h-4 w-4" />
                <span>{t('settings')}</span>
                <span className="ml-auto text-xs text-muted-foreground">{gPrefixHint("/settings")}</span>
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading={t('groupActions')}>
              {onNewOperation && (
                <CommandItem onSelect={() => runCommand(onNewOperation)}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span>{t('newIncident')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">N</span>
                </CommandItem>
              )}
              {onToggleVehicleStatus && (
                <CommandItem onSelect={() => runCommand(onToggleVehicleStatus)}>
                  <Truck className="mr-2 h-4 w-4" />
                  <span>{t('vehicleStatus')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">F</span>
                </CommandItem>
              )}
              {onToggleAuftraege && (
                <CommandItem onSelect={() => runCommand(onToggleAuftraege)}>
                  <Waypoints className="mr-2 h-4 w-4" />
                  <span>{t('auftraege')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">A</span>
                </CommandItem>
              )}
              {onTogglePrint && (
                <CommandItem onSelect={() => runCommand(onTogglePrint)}>
                  <Printer className="mr-2 h-4 w-4" />
                  <span>{t('print')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">D</span>
                </CommandItem>
              )}
              {onToggleLinks && (
                <CommandItem onSelect={() => runCommand(onToggleLinks)}>
                  <QrCode className="mr-2 h-4 w-4" />
                  <span>{t('linksAndQr')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">T</span>
                </CommandItem>
              )}
              {onToggleRapporte && (
                <CommandItem onSelect={() => runCommand(onToggleRapporte)}>
                  <FileText className="mr-2 h-4 w-4" />
                  <span>{t('rapporte')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">O</span>
                </CommandItem>
              )}
              {onToggleJournal && (
                <CommandItem onSelect={() => runCommand(onToggleJournal)}>
                  <BookOpenText className="mr-2 h-4 w-4" />
                  <span>{t('journal')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">J</span>
                </CommandItem>
              )}
              {onWriteJournal && (
                <CommandItem onSelect={() => runCommand(onWriteJournal)}>
                  <NotebookPen className="mr-2 h-4 w-4" />
                  <span>{t('journalEntry')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">⇧J</span>
                </CommandItem>
              )}
              {onToggleFigures && (
                <CommandItem onSelect={() => runCommand(onToggleFigures)}>
                  <ChartColumn className="mr-2 h-4 w-4" />
                  <span>{t('figures')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Z</span>
                </CommandItem>
              )}
              {onToggleCrewDuty && (
                <CommandItem onSelect={() => runCommand(onToggleCrewDuty)}>
                  <Clock className="mr-2 h-4 w-4" />
                  <span>{t('crewDuty')}</span>
                </CommandItem>
              )}
              {onRefresh && (
                <CommandItem onSelect={() => runCommand(onRefresh)}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  <span>{t('refreshData')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">R</span>
                </CommandItem>
              )}
            </CommandGroup>

            {onOpenAuftrag && groups.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('groupAuftraege')}>
                  {groups.map((group) => (
                    <CommandItem
                      key={group.id}
                      value={`auftrag ${group.name} ${group.id}`}
                      onSelect={() => runCommand(() => onOpenAuftrag(group.id))}
                    >
                      <span
                        className="mr-2 inline-block h-3 w-3 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: group.color ?? "var(--muted-foreground)" }}
                        aria-hidden
                      />
                      <span className="truncate">{group.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />

            <CommandGroup heading={t('groupView')}>
              {onToggleLeftSidebar && (
                <CommandItem onSelect={() => runCommand(onToggleLeftSidebar)}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>{t('personnelSidebar')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Q / [</span>
                </CommandItem>
              )}
              {onToggleRightSidebar && (
                <CommandItem onSelect={() => runCommand(onToggleRightSidebar)}>
                  <Package className="mr-2 h-4 w-4" />
                  <span>{t('materialSidebar')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">W / ]</span>
                </CommandItem>
              )}
              {onToggleNotifications && (
                <CommandItem onSelect={() => runCommand(onToggleNotifications)}>
                  <Bell className="mr-2 h-4 w-4" />
                  <span>{t('notifications')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">B</span>
                </CommandItem>
              )}
              {onToggleSidePanel && (
                <CommandItem onSelect={() => runCommand(onToggleSidePanel)}>
                  <PanelRight className="mr-2 h-4 w-4" />
                  <span>{t('toggleSidePanel')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">I / \</span>
                </CommandItem>
              )}
              {/* No shortcut hint on purpose: `d` used to open the panel on
                  Detail and now opens the Drucken-Sheet (see
                  `lib/hooks/use-kanban-shortcuts.ts`). Nothing binds to this
                  command any more — it lives here and nowhere else. */}
              {onSidePanelDetail && (
                <CommandItem onSelect={() => runCommand(onSidePanelDetail)}>
                  <Edit className="mr-2 h-4 w-4" />
                  <span>{t('sidePanelDetail')}</span>
                </CommandItem>
              )}
              {onSidePanelMap && (
                <CommandItem onSelect={() => runCommand(onSidePanelMap)}>
                  <Map className="mr-2 h-4 w-4" />
                  <span>{t('sidePanelMap')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">K</span>
                </CommandItem>
              )}
            </CommandGroup>

            {(onToggleMapLabels || onToggleMapLines || onFocusVehicle) && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('groupMap')}>
                  {onToggleMapLabels && (
                    <CommandItem onSelect={() => runCommand(onToggleMapLabels)}>
                      <Tag className="mr-2 h-4 w-4" />
                      <span>{t('toggleLabels')}</span>
                      <span className="ml-auto text-xs text-muted-foreground">L</span>
                    </CommandItem>
                  )}
                  {onToggleMapLines && (
                    <CommandItem onSelect={() => runCommand(onToggleMapLines)}>
                      <Route className="mr-2 h-4 w-4" />
                      <span>{t('toggleAssignmentLines')}</span>
                      <span className="ml-auto text-xs text-muted-foreground">I</span>
                    </CommandItem>
                  )}
                  {onMapResetZoom && (
                    <CommandItem onSelect={() => runCommand(onMapResetZoom)}>
                      <Crosshair className="mr-2 h-4 w-4" />
                      <span>{t('resetZoom')}</span>
                      <span className="ml-auto text-xs text-muted-foreground">Z</span>
                    </CommandItem>
                  )}
                  {/* «Färben nach» — hint letters mirror COLOR_BY_SHORTCUTS in
                      app/map/page.tsx (German mnemonics P/K/F/T/A). */}
                  {onSetMapColorBy &&
                    ([
                      ['P', 'priority'],
                      ['K', 'reko'],
                      ['F', 'vehicle'],
                      ['T', 'type'],
                      ['A', 'auftrag'],
                    ] as const).map(([key, dim]) => (
                      <CommandItem
                        key={`map-color-by-${dim}`}
                        onSelect={() => runCommand(() => onSetMapColorBy(dim))}
                      >
                        <Palette className="mr-2 h-4 w-4" />
                        <span>{t('mapColorBy', { mode: tMapColorBy(dim) })}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{key}</span>
                      </CommandItem>
                    ))}
                  {onFocusVehicle &&
                    [1, 2, 3, 4, 5].map((n) => (
                      <CommandItem
                        key={`focus-vehicle-${n}`}
                        onSelect={() => runCommand(() => onFocusVehicle?.(n))}
                      >
                        <Crosshair className="mr-2 h-4 w-4" />
                        <span>{mapVehicleNames[n - 1] ? t('showVehicleNamed', { name: mapVehicleNames[n - 1] }) : t('showVehicleNumber', { number: n })}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{n}</span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              </>
            )}

            <CommandSeparator />

            <CommandGroup heading={t('groupSearch')}>
              <CommandItem
                onSelect={() =>
                  runCommand(onFocusIncidentSearch ?? (() => document.getElementById('search-input')?.focus()))
                }
              >
                <Search className="mr-2 h-4 w-4" />
                <span>{t('searchIncidents')}</span>
                <span className="ml-auto text-xs text-muted-foreground">S / /</span>
              </CommandItem>
              {onSearchPersonnel && (
                <CommandItem onSelect={() => runCommand(onSearchPersonnel)}>
                  <Users className="mr-2 h-4 w-4" />
                  <span>{t('searchPersonnel')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">P</span>
                </CommandItem>
              )}
              {onSearchMaterial && (
                <CommandItem onSelect={() => runCommand(onSearchMaterial)}>
                  <Package className="mr-2 h-4 w-4" />
                  <span>{t('searchMaterial')}</span>
                  <span className="ml-auto text-xs text-muted-foreground">M</span>
                </CommandItem>
              )}
            </CommandGroup>

            {/* Incident-specific actions — always shown so operators see the
                full shortcut list; entries are `disabled` (greyed out) when no
                op is hovered/selected. */}
            <CommandSeparator />
            <CommandGroup heading={hasSelectedIncident ? t('groupSelectedIncident') : t('groupIncidentHover')}>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onEditIncident)?.())}
              >
                <Edit className="mr-2 h-4 w-4" />
                <span>{t('openDetails')}</span>
                <span className="ml-auto text-xs text-muted-foreground">E</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onMoveStatusForward)?.())}
              >
                <ArrowRight className="mr-2 h-4 w-4" />
                <span>{t('statusForward')}</span>
                <span className="ml-auto text-xs text-muted-foreground">&gt;</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onMoveStatusBackward)?.())}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                <span>{t('statusBackward')}</span>
                <span className="ml-auto text-xs text-muted-foreground">&lt;</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() =>
                  runCommand(() => (hasSelectedIncident ? onSetPriority?.('low') : undefined))
                }
              >
                <PRIORITY_ICONS.low className={`mr-2 h-4 w-4 ${PRIORITY_TEXT_CLASSES.low}`} />
                <span>{t('priorityLow')}</span>
                <span className="ml-auto text-xs text-muted-foreground">⇧1</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() =>
                  runCommand(() => (hasSelectedIncident ? onSetPriority?.('medium') : undefined))
                }
              >
                <PRIORITY_ICONS.medium className={`mr-2 h-4 w-4 ${PRIORITY_TEXT_CLASSES.medium}`} />
                <span>{t('priorityMedium')}</span>
                <span className="ml-auto text-xs text-muted-foreground">⇧2</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() =>
                  runCommand(() => (hasSelectedIncident ? onSetPriority?.('high') : undefined))
                }
              >
                <PRIORITY_ICONS.high className={`mr-2 h-4 w-4 ${PRIORITY_TEXT_CLASSES.high}`} />
                <span>{t('priorityHigh')}</span>
                <span className="ml-auto text-xs text-muted-foreground">⇧3</span>
              </CommandItem>
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onToggleZuFuss)?.())}
              >
                <Footprints className="mr-2 h-4 w-4" />
                <span>{t('toggleZuFuss')}</span>
                <span className="ml-auto text-xs text-muted-foreground">0</span>
              </CommandItem>
              {[1, 2, 3, 4, 5].map((n) => (
                <CommandItem
                  key={`assign-vehicle-${n}`}
                  disabled={!hasSelectedIncident}
                  onSelect={() =>
                    runCommand(() => (hasSelectedIncident ? onAssignVehicle?.(n) : undefined))
                  }
                >
                  <Truck className="mr-2 h-4 w-4" />
                  <span>{t('assignVehicle', { number: n })}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{n}</span>
                </CommandItem>
              ))}
              <CommandItem
                disabled={!hasSelectedIncident}
                onSelect={() => runCommand(() => incidentOnly(onDeleteIncident)?.())}
              >
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                <span className="text-destructive">{t('deleteIncident')}</span>
                <span className="ml-auto text-xs text-muted-foreground">Del</span>
              </CommandItem>
            </CommandGroup>

            {!dispatchOnTop && dispatchGroup}
          </CommandList>
          {canScrollDown && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-9 items-end justify-center bg-gradient-to-t from-popover via-popover/80 to-transparent">
              <ChevronDown className="mb-1 h-4 w-4 animate-bounce text-muted-foreground" />
            </div>
          )}
          </div>
          {/* ↵ runs the best match of the whole list, not of the first group. */}
          <CommandRankGroups />
        </Command>
      </DialogContent>
    </Dialog>
  )
}
