"use client"

/**
 * The board's desktop footer: «Neuer Einsatz», the Bereitschaft checklist, the
 * tool pills (with whatever does not fit behind «Mehr»), the card-view menu and
 * the command hint.
 *
 * Presentational: the board page owns every value and handler and passes them
 * in under the names it uses itself, so the JSX is the page's, moved verbatim
 * (2026-09-23) together with the one component only the footer uses.
 */

import type { ComponentProps, Dispatch, SetStateAction } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { ClipboardCheck, FileText, Plus, Printer, QrCode, Sparkles, Truck, Waypoints } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CardViewMenu } from "@/components/kanban/card-view-menu"
import type { selectFiledRapports, selectOpenRapports } from "@/components/kanban/rapport-backlog-sheet"
import { ToolbarOverflow } from "@/components/kanban/toolbar-overflow"
import { EventSetupChecklist } from "@/components/event-setup-checklist"
import type { useEvent } from "@/lib/contexts/event-context"
import { cn } from "@/lib/utils"

/** The footer sheets. Only one is open at a time; `'print'` is the one
 *  print/export sheet (thermal slip, A4 status print, per-event export). */
export type FooterSheet = 'links' | 'vehicles' | 'print' | 'auftraege' | 'rapporte'

/**
 * One footer-toolbar pill: icon + label, highlighted when the sheet/dialog it
 * opens is active. Replaces ~8 hand-rolled, near-identical `<Button>` blocks
 * that only differed in icon/label/state — each with its own template-literal
 * className doing the same active/inactive ternary.
 *
 * **The label is hidden below `xl`.** The centre group grew to nine entries and
 * a row of nine labelled pills is wider than a 1280px window; because a footer
 * cannot shrink below its content, that width was pushing the whole application
 * sideways — board, sidebars and header together — rather than just itself.
 * Dropping to icons is the option that keeps every control one click away: an
 * overflow menu hides half of them behind a second click, and a scrolling bar
 * hides them behind a gesture nobody looks for in a 40px strip. The name stays
 * reachable as a tooltip and as the accessible name, which is unchanged for a
 * screen reader either way.
 */
function ToolbarToggle({
  icon: Icon,
  label,
  active,
  disabled,
  title,
  count,
  onActivate,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  disabled?: boolean
  title?: string
  /** Optional count badge. It survives the icon-only collapse below `xl`, for the
   *  same reason the Bereitschaft badge does: the number IS the information, and
   *  an icon on its own does not carry it. */
  count?: number
  onActivate: () => void
}) {
  return (
    <Button
      size="xs"
      variant="ghost"
      className={cn(
        // Explicit px: these sit in a gap-less row, so the button's own padding
        // is the only thing keeping one item's label off the next item's icon.
        "px-2.5 transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
      )}
      onPointerDown={(e) => {
        e.stopPropagation()
        onActivate()
      }}
      disabled={disabled}
      // The tooltip carries the name at every width, so the icon-only mode is
      // never a control nobody can identify.
      title={title ?? label}
      aria-label={label}
    >
      <Icon className="size-3.5" />
      <span className="hidden text-xs xl:inline">{label}</span>
      {count !== undefined && (
        <Badge variant="secondary" className="h-4 px-1.5 text-[11px] font-medium tabular-nums">
          {count}
        </Badge>
      )}
    </Button>
  )
}

type CardViewMenuProps = ComponentProps<typeof CardViewMenu>

export interface BoardFooterProps {
  applyCardViewPreset: CardViewMenuProps["onApplyPreset"]
  auftraegeSheetOpen: boolean
  cardView: CardViewMenuProps["view"]
  cardViewPreset: CardViewMenuProps["preset"]
  checklistPopoverOpen: boolean
  checklistProgress: { completed: number; total: number }
  cmdHint: string
  filedRapports: ReturnType<typeof selectFiledRapports>
  handleChecklistOpenChange: (open: boolean) => void
  linksSheetOpen: boolean
  openRapports: ReturnType<typeof selectOpenRapports>
  printSheetOpen: boolean
  rapportBacklogSheetOpen: boolean
  selectedEvent: ReturnType<typeof useEvent>["selectedEvent"]
  setActiveFooterSheet: Dispatch<SetStateAction<FooterSheet | null>>
  setAttendanceOpen: Dispatch<SetStateAction<boolean>>
  setAuftraegeFocusGroupId: Dispatch<SetStateAction<string | null>>
  setChecklistOverridesVersion: Dispatch<SetStateAction<number>>
  setDiveraMessageText: Dispatch<SetStateAction<string | null>>
  setNewEmergencyModalOpen: Dispatch<SetStateAction<boolean>>
  setRekoPickerOpen: Dispatch<SetStateAction<boolean>>
  toggleCardViewKey: CardViewMenuProps["onToggleKey"]
  vehicleStatusSheetOpen: boolean
}

export function BoardFooter({
  applyCardViewPreset,
  auftraegeSheetOpen,
  cardView,
  cardViewPreset,
  checklistPopoverOpen,
  checklistProgress,
  cmdHint,
  filedRapports,
  handleChecklistOpenChange,
  linksSheetOpen,
  openRapports,
  printSheetOpen,
  rapportBacklogSheetOpen,
  selectedEvent,
  setActiveFooterSheet,
  setAttendanceOpen,
  setAuftraegeFocusGroupId,
  setChecklistOverridesVersion,
  setDiveraMessageText,
  setNewEmergencyModalOpen,
  setRekoPickerOpen,
  toggleCardViewKey,
  vehicleStatusSheetOpen,
}: BoardFooterProps) {
  const tCommon = useTranslations('kanban.common')
  const tDash = useTranslations('kanban.dashboard')
  return (
    <>
    {/* Desktop Footer.

        `z-[60]` keeps it above the footer-sheet layer (z-50), so a sheet
        slides up from behind it instead of sweeping across it. Going UNDER
        a modal dialog is no longer this element's business: it used to be a
        hand-kept list of three modals here, which left the other ~20
        dialogs with a bright, inert toolbar over a dimmed board. The rule
        now keys off the dialog overlay itself — see the
        `body:has([data-slot='dialog-overlay'])` block at the end of
        app/globals.css. */}
    <footer className="relative z-[60] bg-background/95 backdrop-blur-sm px-4 md:px-6 py-2 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] border-t border-border">
      {/* `min-w-0` on the row and on the middle group is what actually keeps
          the page from scrolling sideways. A flex item defaults to
          `min-width: auto`, i.e. it refuses to shrink below its content —
          so a toolbar wider than the window made the whole column wider
          than the window, and `<main>`'s own `overflow-auto` then scrolled
          the board, both sidebars and the header together. The label
          collapse below is what makes it fit at 1024; this is what makes it
          *impossible* for it not to.

          Labels come back in two stages, because measurement says one
          breakpoint cannot serve both cases (widths from Chrome, de-DE):

            fully labelled, training event ....... 1414px needed
            fully labelled, live event ........... 1262px needed

          A single `xl` (1280) therefore clipped every training board — the
          middle strip overflowed by 78px at 1280 and 35px at 1366 — while a
          single `2xl` (1536) would have made a 1366 and even a 1440 laptop
          icon-only on live boards that fit their labels comfortably today.
          So:

            xl  (1280) — the nine tool pills + Ansicht (unchanged)
            2xl (1536) — "Bereitschaft" and "Übungs-Steuerung"

          which leaves 1280 needing 1217px and 1536 needing 1414px. Both fit,
          with the 2xl stage sized off the real 1414 rather than off a guess. */}
      <div className="flex min-w-0 items-center justify-between gap-4">
        {/* Left: Primary action.
            "Neuer Einsatz" keeps its label at every width on purpose. It is
            the only control down here that *creates* something, it is what
            gets reached for under time pressure, and a bare "+" next to a
            board that has add affordances on every column is genuinely
            ambiguous. It costs 134px — the two labels below give back more
            than that, so the primary action never has to pay. */}
        <div className="flex shrink-0 items-center gap-3">
          <Button size="sm" className="gap-2 shadow-sm" onClick={() => setNewEmergencyModalOpen(true)}>
            <Plus className="size-3.5" />
            {tCommon('newIncident')}
          </Button>

          {/* Event Setup Checklist — shown only while setup is incomplete; disappears once done */}
          {selectedEvent && checklistProgress.total > 0 && checklistProgress.completed < checklistProgress.total && (
            <Popover open={checklistPopoverOpen} onOpenChange={handleChecklistOpenChange}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  // Icon-only below 2xl, so the tooltip has to carry the name —
                  // same contract as `ToolbarToggle`.
                  title={`${tDash('readiness')} ${checklistProgress.completed}/${checklistProgress.total}`}
                  aria-label={`${tDash('readiness')} ${checklistProgress.completed}/${checklistProgress.total}`}
                >
                  <ClipboardCheck className="size-3.5" />
                  {/* The word collapses like every other footer label; the
                      badge never does — `n/m` is the informative half, and
                      the clipboard icon alone does not carry a count. */}
                  <span className="hidden 2xl:inline">{tDash('readiness')}</span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs font-medium tabular-nums">
                    {checklistProgress.completed}/{checklistProgress.total}
                  </Badge>
                </Button>
              </PopoverTrigger>
              {/* Same offset as CardViewMenu at the other end of the row,
                  and for the same reason: the trigger sits inside the
                  toolbar, so the offset has to clear the toolbar and not
                  just the button. 10 left ~1px, and none at all while the
                  button is still badge-less ("Checkliste wird geladen…"),
                  which put the panel's bottom edge under the toolbar. */}
              <PopoverContent
                // Clamped: collision handling can shift this panel but not shrink it,
                // so a flat 600px runs off a narrow desktop window's edge.
                className="w-[min(600px,calc(100vw-2rem))] p-0"
                align="start"
                side="top"
                sideOffset={20}
              >
                <EventSetupChecklist
                  eventId={selectedEvent.id}
                  eventName={selectedEvent.name}
                  onDismiss={() => handleChecklistOpenChange(false)}
                  onAllTasksComplete={() => handleChecklistOpenChange(false)}
                  onOpenVehicles={() => setActiveFooterSheet('vehicles')}
                  onOpenAttendance={() => setAttendanceOpen(true)}
                  onSendDiveraMessage={(text) => setDiveraMessageText(text)}
                  onOpenRekoPicker={() => setRekoPickerOpen(true)}
                  onOverridesChange={() => setChecklistOverridesVersion((v) => v + 1)}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* Center: Secondary actions, in order, with whatever does not fit
            behind «Mehr».

            The strip used to rely on the label collapse alone, and the
            measurements above were the proof that one row of pills cannot be
            made to fit by choosing breakpoints: with the Meldungs-Leiste open
            at 1280 four controls fell off the end entirely and a fifth
            rendered as «Ansic». `ToolbarOverflow` measures instead of
            guessing — see the note there. The label collapse stays: it is
            still the cheapest width saving, and every control it does not
            save is reachable in the panel.

            Order is the contract. Items overflow from the end, so the pill
            an operator reaches for on a live board (Links & QR) is the
            last to go. */}
        <ToolbarOverflow
          moreLabel={tDash('more')}
          moreTitle={(count) => tDash('moreTitle', { count })}
          items={[
            {
              // Every link the board hands out, in ONE sheet (decision 29).
              // Was five pills — Check-In, Reko, Feld, Anzeige, Alarm —
              // each opening its own sheet that did the same three things.
              // Check-In and Anzeige held out for a while as pills of their
              // own (the Appell; the display picker), but the Appell is a
              // row in this sheet now and the display share is just the
              // base /display link, so one pill covers everything.
              key: 'links',
              node: (
                <ToolbarToggle
                  icon={QrCode}
                  label={tDash('linksAndQr')}
                  active={linksSheetOpen}
                  onActivate={() => setActiveFooterSheet(linksSheetOpen ? null : 'links')}
                />
              ),
            },
            {
              key: 'vehicles',
              separatorBefore: true,
              node: (
                <ToolbarToggle
                  icon={Truck}
                  label={tDash('vehicles')}
                  active={vehicleStatusSheetOpen}
                  disabled={!selectedEvent}
                  onActivate={() => {
                    if (!selectedEvent) return
                    setActiveFooterSheet(vehicleStatusSheetOpen ? null : 'vehicles')
                  }}
                />
              ),
            },
            {
              key: 'auftraege',
              node: (
                <ToolbarToggle
                  icon={Waypoints}
                  label={tDash('auftraege')}
                  active={auftraegeSheetOpen}
                  disabled={!selectedEvent}
                  onActivate={() => {
                    if (!selectedEvent) return
                    if (!auftraegeSheetOpen) setAuftraegeFocusGroupId(null)
                    setActiveFooterSheet(auftraegeSheetOpen ? null : 'auftraege')
                  }}
                />
              ),
            },
            /* Schadenplatz-Rapporte, offen und erfasst. Absent only when
               there is NEITHER: the Bereitschaft button next door sets the
               precedent — a control with nothing to say leaves the row.
               An empty backlog on its own is no longer that case, because
               the sheet's second tab still answers "was haben wir letzte
               Woche geschrieben?". The badge is omitted at zero rather
               than shown as «0»: it counts OFFEN and nothing else. */
            ...(openRapports.length > 0 || filedRapports.length > 0
              ? [{
                  key: 'rapporte',
                  node: (
                    <ToolbarToggle
                      icon={FileText}
                      label={tDash('rapporte')}
                      active={rapportBacklogSheetOpen}
                      count={openRapports.length > 0 ? openRapports.length : undefined}
                      title={tDash('rapportBacklog.toggleTitle', { count: openRapports.length })}
                      onActivate={() => setActiveFooterSheet(rapportBacklogSheetOpen ? null : 'rapporte')}
                    />
                  ),
                }]
              : []),
            /* One pill for every way onto paper. "Drucken" and "Thermo"
               used to sit here as two near-identical printer icons; they
               are now two columns inside the one sheet. */
            {
              key: 'print',
              node: (
                <ToolbarToggle
                  icon={Printer}
                  label={tDash('print')}
                  active={printSheetOpen}
                  disabled={!selectedEvent}
                  title={tDash('printTitle')}
                  onActivate={() => {
                    if (!selectedEvent) return
                    setActiveFooterSheet(printSheetOpen ? null : 'print')
                  }}
                />
              ),
            },
            ...(selectedEvent?.training_flag
              ? [{
                  key: 'training',
                  separatorBefore: true,
                  node: (
                    <Link href="/training" className="shrink-0">
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-warning-foreground hover:text-warning-foreground hover:bg-warning/10"
                        title={tDash('trainingControl')}
                        aria-label={tDash('trainingControl')}
                      >
                        <Sparkles className="size-3.5" />
                        {/* Second collapse stage, at 2xl rather than xl. This is the
                            longest label in the row (143px) and the only pill that
                            is not part of the everyday live board — dropping its
                            word first buys the most width for the least loss. */}
                        <span className="hidden font-medium 2xl:inline">{tDash('trainingControl')}</span>
                      </Button>
                    </Link>
                  ),
                }]
              : []),
            {
              key: 'cardview',
              separatorBefore: true,
              // One control where the two pills used to be. The pills only
              // ever reached two of the nine card blocks — and never the long
              // ones (Mannschaft, Fahrzeuge, Material) that decide whether
              // forty cards fit on the screen.
              node: (
                <CardViewMenu
                  view={cardView}
                  preset={cardViewPreset}
                  onApplyPreset={applyCardViewPreset}
                  onToggleKey={toggleCardViewKey}
                />
              ),
              // `data-keep-open`: this one opens a popover of its own from
              // inside the panel, so the panel must not close under it.
              panelNode: (
                <div data-keep-open>
                  <CardViewMenu
                    view={cardView}
                    preset={cardViewPreset}
                    onApplyPreset={applyCardViewPreset}
                    onToggleKey={toggleCardViewKey}
                  />
                </div>
              ),
            },
          ]}
        />

        {/* Right: Help hint */}
        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          >
            <Kbd className="h-5 text-2xs px-1.5">{cmdHint}</Kbd>
            <span className="hidden lg:inline">{tDash('commands')}</span>
          </button>
        </div>
      </div>
    </footer>
    </>
  )
}
