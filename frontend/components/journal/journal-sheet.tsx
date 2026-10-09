"use client"

/**
 * The Einsatztagebuch drawer (idea R8, 08.10.2026) — `J` on the board, «Tagebuch» in the
 * footer, «Einsatztagebuch» in the palette and in the phone's «Mehr».
 *
 * KP Front's Verlauf, simpler: one list, newest first, four filters, one line to write in.
 * No playback, no voice, no replay. The log itself is the server's (`journal_entries`):
 * the board writes its own rows as things happen, the operator adds what belongs to no
 * card. Append-only — a wrong line is corrected by a new one, and the line then says
 * «korrigiert» with the old wording one tap away, as on paper.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import { Filter, Hash, Pencil, X } from "lucide-react"

import { apiClient, type ApiJournalCategory, type ApiJournalEntry } from "@/lib/api-client"
import type { Operation } from "@/lib/contexts/operations-context"
import {
  JOURNAL_CATEGORIES,
  filterJournal,
  foldJournal,
  formatJournalTime,
  incidentQuery,
  journalCounts,
  mergedInto,
  newClientId,
  stripIncidentQuery,
  suggestIncidents,
  type IncidentChoice,
  type JournalLine,
} from "@/lib/journal"
import { useJournal } from "@/lib/hooks/use-journal"
import { getIncidentTypeLabel } from "@/lib/incident-types"
import { STATUS_LABELS } from "@/lib/types/incidents"
import { cn, formatLocationForDisplay, getGlobalHomeCity } from "@/lib/utils"
import { FooterSheet } from "@/components/ui/footer-sheet"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/ui/empty-state"
import { FormMessage, fieldMessageProps, formMessageId } from "@/components/ui/form-message"
import { LoadingStatus, ShellLoader } from "@/components/ui/shell-loader"
import { useIsMobile } from "@/components/ui/use-mobile"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const INPUT_ID = "journal-input"

/** Field facts the drawer has words for (`data.type`); anything else shows its text. */
const FIELD_TYPES = new Set([
  "field_arrived",
  "field_arrived_cleared",
  "field_complete",
  "field_complete_cleared",
  "field_pickup_requested",
  "field_pickup_cleared",
  "rapport_submitted",
  "reko_arrived",
  "reko_arrived_cleared",
])

export interface JournalSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string | null
  /** The board's Einsätze — the `#` pick-list and the names on the incident chips. */
  operations: readonly Operation[]
  isEditor: boolean
  /** Opens the Einsatz behind an incident chip. */
  onOpenIncident?: (incidentId: string) => void
}

// The number is optional until R4's operation mapping has landed, and on optimistic cards.
type NumberedOperation = Operation & Pick<IncidentChoice, "number">

function operationLabel(op: NumberedOperation): string {
  const label = (
    (op.locationDisplay ?? formatLocationForDisplay(op.location, getGlobalHomeCity())) ||
    getIncidentTypeLabel(op.incidentType)
  )
  return op.number != null ? `${op.number} · ${label}` : label
}

export function JournalSheet({ open, onOpenChange, eventId, operations, isEditor, onOpenIncident }: JournalSheetProps) {
  const t = useTranslations("journal")
  const isMobile = useIsMobile()
  const { entries, isLoading, failed, reload, accept } = useJournal(eventId, open)
  const [ticked, setTicked] = useState<Set<ApiJournalCategory>>(new Set())

  const lines = useMemo(() => foldJournal(entries), [entries])
  const counts = useMemo(() => journalCounts(lines), [lines])
  const shown = useMemo(() => filterJournal(lines, ticked), [lines, ticked])
  const filtering = ticked.size > 0
  const tickedLabels = JOURNAL_CATEGORIES.filter((c) => ticked.has(c)).map((c) => t(`filters.${c}`)).join(" · ")

  const toggle = (c: ApiJournalCategory) =>
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  const showAll = () => setTicked(new Set())

  const labels = useMemo(() => new Map(operations.map((op) => [op.id, operationLabel(op)])), [operations])
  const merged = useMemo(() => mergedInto(entries), [entries])
  const [correcting, setCorrecting] = useState<JournalLine | null>(null)

  return (
    <FooterSheet
      open={open}
      onOpenChange={onOpenChange}
      className="flex flex-col gap-0 max-w-3xl mx-auto px-4 sm:px-6 pt-3 pb-sheet-safe sm:pb-4 modal-h-tall"
    >
      <SheetHeader className="flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 p-0 pr-14 sm:pr-0 shrink-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <SheetTitle className="text-base">{t("title")}</SheetTitle>
          <SheetDescription className="hidden truncate text-xs sm:block">{t("description")}</SheetDescription>
        </div>

        {isMobile ? (
          /* Phone: ONE square funnel, never a chip row (CLAUDE.md → phone filters). */
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={filtering ? "selected" : "outline"}
                size="icon"
                className="size-11 shrink-0"
                aria-label={filtering ? t("filterOn", { filters: tickedLabels }) : t("filter")}
                title={filtering ? t("filterOn", { filters: tickedLabels }) : t("filter")}
              >
                <Filter aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {filtering && (
                <>
                  <DropdownMenuItem onSelect={showAll} className="min-h-11">
                    <span className="flex-1">{t("showAll")}</span>
                    <span className="tabular-nums text-muted-foreground">{lines.length}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {JOURNAL_CATEGORIES.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c}
                  checked={ticked.has(c)}
                  onCheckedChange={() => toggle(c)}
                  onSelect={(event) => event.preventDefault()}
                  className="min-h-11 data-[state=checked]:sel-choice"
                >
                  <span className="flex-1">{t(`filters.${c}`)}</span>
                  <span className="tabular-nums text-muted-foreground">{counts[c]}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div role="group" aria-label={t("filter")} className="flex shrink-0 flex-wrap items-center gap-1">
            <Button
              size="xs"
              variant={filtering ? "outline" : "selected"}
              aria-pressed={!filtering}
              onClick={showAll}
            >
              {t("filters.all")}
              <span className="tabular-nums text-muted-foreground">{lines.length}</span>
            </Button>
            {JOURNAL_CATEGORIES.map((c) => (
              <Button
                key={c}
                size="xs"
                variant={ticked.has(c) ? "selected" : "outline"}
                aria-pressed={ticked.has(c)}
                onClick={() => toggle(c)}
              >
                {t(`filters.${c}`)}
                <span className="tabular-nums text-muted-foreground">{counts[c]}</span>
              </Button>
            ))}
          </div>
        )}
      </SheetHeader>

      {isMobile && filtering && (
        <div className="mt-1 flex min-h-8 min-w-0 items-center gap-2 text-xs text-muted-foreground" data-testid="journal-filter-summary">
          <span className="min-w-0 truncate">{t("filterSummary", { filters: tickedLabels })}</span>
          <button
            type="button"
            onClick={showAll}
            className="inline-flex min-h-8 shrink-0 cursor-pointer items-center underline underline-offset-2 decoration-muted-foreground/50 hover:text-foreground"
          >
            {t("showAll")}
          </button>
        </div>
      )}

      <div className="relative mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2" data-testid="journal-list">
        {isLoading && entries.length === 0 ? (
          <div className="flex justify-center py-8">
            <LoadingStatus size="surface">{t("loading")}</LoadingStatus>
          </div>
        ) : failed && entries.length === 0 ? (
          <EmptyState compact title={t("loadFailed")} action={{ label: t("retry"), onClick: reload }} />
        ) : lines.length === 0 ? (
          <EmptyState compact title={t("emptyTitle")} description={t(isEditor ? "emptyEditor" : "emptyViewer")} />
        ) : shown.length === 0 ? (
          <EmptyState
            compact
            title={t("emptyFilteredTitle")}
            description={t("emptyFiltered", { filters: tickedLabels })}
            action={{ label: t("resetFilter"), onClick: showAll }}
          />
        ) : (
          <ol className="divide-y divide-border/60">
            {shown.map((line) => (
              <JournalRow
                key={line.entry.id}
                line={line}
                incidentLabel={line.entry.incident_id ? labels.get(line.entry.incident_id) : undefined}
                mergedInto={line.entry.incident_id ? merged.get(line.entry.incident_id) : undefined}
                stacked={isMobile}
                onOpenIncident={
                  // The phone views; a tap target there is 44px, and a 44px chip in every row
                  // is a list of chips. The desktop chip opens the Einsatz.
                  !isMobile && onOpenIncident && line.entry.incident_id && labels.has(line.entry.incident_id)
                    ? () => onOpenIncident(line.entry.incident_id!)
                    : undefined
                }
                onCorrect={isEditor && line.entry.kind === "manual" ? () => setCorrecting(line) : undefined}
              />
            ))}
          </ol>
        )}
      </div>

      {isEditor && eventId && (
        <JournalComposer
          key={correcting?.entry.id ?? "new"}
          eventId={eventId}
          operations={operations}
          correcting={correcting}
          onCancelCorrection={() => setCorrecting(null)}
          onWritten={(entry) => {
            accept(entry)
            setCorrecting(null)
          }}
        />
      )}
    </FooterSheet>
  )
}

function JournalRow({
  line,
  incidentLabel,
  mergedInto,
  stacked = false,
  onOpenIncident,
  onCorrect,
}: {
  line: JournalLine
  incidentLabel?: string
  /** The card this Einsatz was merged into, when it was (and not unmerged since). */
  mergedInto?: string
  /** Phone: the Einsatz on a line of its own above the text, not a chip inside it. */
  stacked?: boolean
  onOpenIncident?: () => void
  onCorrect?: () => void
}) {
  const t = useTranslations("journal")
  const { entry } = line
  const [showOriginal, setShowOriginal] = useState(false)
  const lastCorrection = line.corrections[line.corrections.length - 1]
  // An Einsatz that left the board keeps its lines (append-only) and says why it is gone.
  const ref = incidentLabel ?? entry.incident_title
  const incidentName = !ref
    ? null
    : mergedInto !== undefined
      ? t("refMerged", { ref, target: mergedInto || t("rows.unknown") })
      : entry.incident_deleted && !incidentLabel
        ? t("refDeleted", { ref })
        : ref
  // Who wrote it — for what a PERSON said (a manual line, a Reko report). On the board's own
  // rows it would read «Demo Bearbeiter» three hundred times (the PDF dropped it for that);
  // there it is the row's tooltip instead.
  const author = entry.kind === "manual" || entry.kind === "reko" ? entry.author_name : null
  return (
    <li
      className="group flex gap-3 py-2 text-sm"
      data-kind={entry.kind}
      data-testid="journal-row"
      title={!author && entry.author_name && entry.kind !== "message" ? entry.author_name : undefined}
    >
      <time
        dateTime={entry.occurred_at}
        className="min-w-[2.75rem] shrink-0 whitespace-nowrap pt-px font-mono text-xs tabular-nums text-muted-foreground"
      >
        {formatJournalTime(entry.occurred_at)}
      </time>
      <div className="min-w-0 flex-1">
        {stacked && incidentName && (
          <p className="truncate text-xs font-medium text-muted-foreground" title={incidentName}>
            {incidentName}
          </p>
        )}
        <p className="break-words">
          {!stacked &&
            incidentName &&
            (onOpenIncident ? (
              <button
                type="button"
                onClick={onOpenIncident}
                className="mr-1.5 inline-flex max-w-full cursor-pointer items-center rounded-sm bg-muted px-1.5 align-baseline text-xs font-medium text-foreground hover:bg-muted/70"
                title={incidentName}
              >
                <span className="truncate">{incidentName}</span>
              </button>
            ) : (
              <span className="mr-1.5 inline-flex max-w-full items-center rounded-sm bg-muted px-1.5 align-baseline text-xs font-medium text-muted-foreground" title={incidentName}>
                <span className="truncate">{incidentName}</span>
              </span>
            ))}
          <JournalText entry={entry} text={line.text} />
        </p>
        {(author || lastCorrection) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {author && <span>{author}</span>}
            {lastCorrection && (
              <button
                type="button"
                onClick={() => setShowOriginal((v) => !v)}
                aria-expanded={showOriginal}
                className="cursor-pointer underline underline-offset-2 decoration-muted-foreground/50 hover:text-foreground"
              >
                {t("corrected", { time: formatJournalTime(lastCorrection.created_at), name: lastCorrection.author_name ?? "" })}
              </button>
            )}
          </p>
        )}
        {showOriginal && lastCorrection && (
          <ul className="mt-1 space-y-0.5 border-l-2 border-border pl-2 text-xs text-muted-foreground">
            {[entry, ...line.corrections.slice(0, -1)].map((version) => (
              <li key={version.id} className="break-words">
                <span className="font-mono tabular-nums">{formatJournalTime(version.created_at)}</span>{" "}
                <span className="line-through decoration-muted-foreground/60">{version.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {onCorrect && (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={onCorrect}
          aria-label={t("correct")}
          title={t("correct")}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </li>
  )
}

/** A row in the reader's language. The automatic rows carry facts, not sentences. */
export function JournalText({ entry, text }: { entry: ApiJournalEntry; text: string | null }) {
  const t = useTranslations("journal.rows")
  const tStatus = useTranslations("kanban")
  const data = (entry.data ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "")
  const status = (s: string) => (s in STATUS_LABELS ? tStatus(`statusLabels.${s}`) : s)

  switch (entry.kind) {
    case "incident": {
      const action = str("action")
      if (action === "deleted") return <span>{t("deleted")}</span>
      if (action === "restored") return <span>{t("restored")}</span>
      if (action === "merge" || action === "merged_into" || action === "unmerge") {
        return <span>{t(action === "merged_into" ? "mergedInto" : action, { other: str("other_title") || t("unknown") })}</span>
      }
      return <span>{t("created")}</span>
    }
    case "field": {
      const type = str("type")
      const label = FIELD_TYPES.has(type) ? t(`field.${type}`) : null
      if (!label) return <span>{text}</span>
      const source = str("source")
      return (
        <span>
          {label}
          {text ? `: ${text}` : ""}
          {source === "kp" || source === "gps" ? (
            <span className="text-muted-foreground"> ({t(source === "gps" ? "sourceGps" : "sourceKp")})</span>
          ) : null}
        </span>
      )
    }
    case "status":
      return (
        <span>
          <span className="text-muted-foreground">{status(str("from_status"))} → </span>
          <span className="font-medium">{status(str("to_status"))}</span>
        </span>
      )
    case "assignment":
      return (
        <span className={str("action") === "unassigned" ? "text-muted-foreground" : undefined}>
          {t(str("action") === "unassigned" ? "unassigned" : "assigned", { name: str("resource_name") })}
        </span>
      )
    case "reko":
      return <span>{text ? t("rekoWith", { text }) : t("reko")}</span>
    case "alarm":
      return (
        <span>
          {typeof data.recipients === "number" && data.recipients > 0
            ? t("alarm", { count: data.recipients })
            : t("alarmPlain")}
        </span>
      )
    case "message":
      return (
        <span>
          <span className="font-medium">
            {t(str("direction") === "to_field" ? "toField" : "fromField", { name: entry.author_name ?? t("unknown") })}
          </span>{" "}
          {text}
        </span>
      )
    default:
      return <span>{text}</span>
  }
}

function JournalComposer({
  eventId,
  operations,
  correcting,
  onCancelCorrection,
  onWritten,
}: {
  eventId: string
  operations: readonly Operation[]
  correcting: JournalLine | null
  onCancelCorrection: () => void
  onWritten: (entry: ApiJournalEntry) => void
}) {
  const t = useTranslations("journal")
  const [text, setText] = useState(correcting?.text ?? "")
  const [linked, setLinked] = useState<IncidentChoice | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)
  // One id per line until the server took it: a retry after a lost answer is the SAME line.
  const clientId = useRef(newClientId())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (correcting) inputRef.current?.focus()
  }, [correcting])

  const choices = useMemo<IncidentChoice[]>(
    () =>
      operations.map((op: NumberedOperation) => ({
        id: op.id,
        label: operationLabel(op),
        number: op.number,
        detail: getIncidentTypeLabel(op.incidentType),
        closed: op.status === "complete",
      })),
    [operations],
  )
  const query = correcting ? null : incidentQuery(text)
  const suggestions = query === null ? [] : suggestIncidents(query, choices)
  const listOpen = query !== null

  const pick = (choice: IncidentChoice) => {
    clientId.current = newClientId() // another link is another write
    setLinked(choice)
    setText((v) => stripIncidentQuery(v) + (stripIncidentQuery(v) ? " " : ""))
    setHighlight(0)
    inputRef.current?.focus()
  }

  const submit = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const entry = correcting
        ? await apiClient.correctJournal(eventId, correcting.entry.id, { client_id: clientId.current, text: body })
        : await apiClient.appendJournal(eventId, {
            client_id: clientId.current,
            text: body,
            incident_id: linked?.id ?? null,
          })
      clientId.current = newClientId()
      setText("")
      setLinked(null)
      onWritten(entry)
    } catch (e) {
      console.error("journal write failed", e)
      // The line stays in the field; sending again reuses its id, so it lands once.
      setError(t("saveFailed"))
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (listOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlight((h) => (h + 1) % suggestions.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        pick(suggestions[Math.min(highlight, suggestions.length - 1)])
        return
      }
    }
    if (e.key === "Escape" && correcting) {
      e.preventDefault()
      e.stopPropagation()
      onCancelCorrection()
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="relative shrink-0 border-t pt-2.5">
      {listOpen && (
        <div
          role="listbox"
          aria-label={t("linkTitle")}
          className="absolute inset-x-0 bottom-full mb-1 rounded-md border bg-popover p-1 shadow-md"
        >
          {suggestions.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("linkNone")}</p>
          ) : (
            suggestions.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className={cn(
                  "flex w-full min-h-9 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm",
                  i === highlight ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className={cn("shrink-0 text-xs text-muted-foreground", s.closed && "italic")}>
                  {s.closed ? t("linkClosed") : s.detail}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {(correcting || linked) && (
        <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {correcting ? (
            <span className="min-w-0 truncate">{t("correcting", { text: correcting.text ?? "" })}</span>
          ) : (
            linked && (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-sm border border-sel-edge bg-sel-wash px-1.5 py-0.5 text-sel-foreground">
                <Hash className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{linked.label}</span>
              </span>
            )
          )}
          <button
            type="button"
            onClick={() => {
              if (correcting) return onCancelCorrection()
              clientId.current = newClientId()
              setLinked(null)
            }}
            className="inline-flex min-h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm hover:bg-muted hover:text-foreground"
            aria-label={correcting ? t("cancelCorrection") : t("unlink")}
            title={correcting ? t("cancelCorrection") : t("unlink")}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Input
          ref={inputRef}
          id={INPUT_ID}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setHighlight(0)
            // A changed line is a new write. Only an UNCHANGED resend reuses the id — the
            // server answers a reused id with different text as a conflict (409).
            clientId.current = newClientId()
            if (error) setError(null)
          }}
          onKeyDown={onKeyDown}
          placeholder={t(correcting ? "placeholderCorrect" : "placeholder")}
          aria-label={t(correcting ? "placeholderCorrect" : "inputLabel")}
          autoComplete="off"
          enterKeyHint="send"
          maxLength={2000}
          className="min-w-0 flex-1"
          {...fieldMessageProps(INPUT_ID, error ? "error" : null)}
        />
        <Button type="submit" size="sm" disabled={!text.trim() || sending} className="shrink-0 gap-1.5 min-h-[var(--field-h,36px)]">
          {sending && <ShellLoader />}
          {t(correcting ? "submitCorrect" : "submit")}
        </Button>
      </form>
      <FormMessage id={formMessageId(INPUT_ID)} className="mt-1">
        {error}
      </FormMessage>
    </div>
  )
}
